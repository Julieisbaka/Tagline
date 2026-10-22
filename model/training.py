"""Model loading, Matryoshka MNRL fine-tuning, and held-out evaluation."""

from __future__ import annotations

import json
from pathlib import Path

from .data import Pair, assert_disjoint, fingerprint, read_jsonl
from .retrieval import metrics, retrieval_labels, unique_training_pairs, validate_pairs

BASE_MODEL = "nomic-ai/nomic-embed-text-v1.5"
CONTEXT_LENGTH = 8192
EMBEDDING_DIMENSION = 384


def load_pairs(data: Path) -> dict[str, list[Pair]]:
    splits = {
        split: validate_pairs(read_jsonl(data / f"{split}.pairs.jsonl"))
        for split in ("train", "test")
    }
    assert_disjoint(splits["train"], splits["test"], "document")
    for split, pairs in splits.items():
        cards = {card["id"]: card for card in read_jsonl(data / f"{split}.cards.jsonl")}
        paired_ids = set()
        for pair in pairs:
            card = cards.get(pair["card_id"])
            if (
                card is None
                or pair["source_id"] != card["source_id"]
                or (pair["document"] != f"search_document: {card['text']}")
            ):
                raise ValueError(
                    f"{split}: pair does not match prepared card {pair['card_id']}"
                )
            paired_ids.add(pair["card_id"])
        if paired_ids != set(cards):
            raise ValueError(f"{split}: not every prepared card has a query")
    return splits


def load_model(
    name: str,
    device: str | None,
    trust_remote_code: bool,
    revision: str | None = None,
):
    from sentence_transformers import SentenceTransformer, models

    if Path(name).is_dir():
        model = SentenceTransformer(
            name, device=device, trust_remote_code=trust_remote_code
        )
    else:
        # Portable PyTorch path: no FlashAttention/CUDA extension build required.
        transformer = models.Transformer(
            name,
            max_seq_length=CONTEXT_LENGTH,
            model_args={"trust_remote_code": trust_remote_code, "revision": revision},
            tokenizer_args={
                "trust_remote_code": trust_remote_code,
                "revision": revision,
            },
            config_args={
                "trust_remote_code": trust_remote_code,
                "revision": revision,
                "rotary_scaling_factor": 2,
                "use_flash_attn": False,
                "fused_bias_fc": False,
                "fused_dropout_add_ln": False,
            },
        )
        dimension = transformer.get_word_embedding_dimension()
        model = SentenceTransformer(
            modules=[
                transformer,
                models.Pooling(dimension, pooling_mode="mean"),
                models.LayerNorm(dimension),
                models.Normalize(),
            ],
            device=device,
        )
    dimension = model.get_sentence_embedding_dimension()
    if dimension is None or dimension < EMBEDDING_DIMENSION:
        raise ValueError(
            f"Model must provide at least {EMBEDDING_DIMENSION} dimensions"
        )
    model.max_seq_length = CONTEXT_LENGTH
    model.tokenizer.model_max_length = CONTEXT_LENGTH
    # Text already contains the required task prefixes.
    model.default_prompt_name = None
    return model


def check_lengths(model, texts: list[str]) -> None:
    for start in range(0, len(texts), 64):
        encoded = model.tokenizer(
            texts[start : start + 64],
            truncation=False,
            padding=False,
            return_length=True,
            add_special_tokens=True,
        )
        for offset, length in enumerate(encoded["length"]):
            if length > CONTEXT_LENGTH:
                raise ValueError(
                    f"Input {start + offset} has {length} tokens including prefix/special "
                    f"tokens; limit is {CONTEXT_LENGTH}. Split the source card explicitly."
                )


def train(
    data: Path,
    output: Path,
    epochs: float = 1,
    batch_size: int = 8,
    learning_rate: float = 2e-5,
    device: str | None = None,
    trust_remote_code: bool = False,
    revision: str | None = None,
    seed: int = 42,
) -> None:
    from datasets import Dataset
    from sentence_transformers import (
        SentenceTransformerTrainer,
        SentenceTransformerTrainingArguments,
        losses,
    )
    from sentence_transformers.training_args import BatchSamplers
    from transformers import set_seed

    if output.exists():
        raise FileExistsError(f"Refusing to overwrite {output}")
    if epochs <= 0 or batch_size < 2 or learning_rate <= 0:
        raise ValueError("Need positive epochs/learning rate and batch_size >= 2")
    splits = load_pairs(data)
    pairs = unique_training_pairs(splits["train"])
    if (
        min(
            len({pair["query"] for pair in pairs}),
            len({fingerprint(pair["document"]) for pair in pairs}),
        )
        < batch_size
    ):
        raise ValueError("Not enough distinct queries/documents for one full batch")
    set_seed(seed)
    model = load_model(BASE_MODEL, device, trust_remote_code, revision)
    check_lengths(model, [pair[key] for pair in pairs for key in ("query", "document")])
    dataset = Dataset.from_dict(
        {
            "query": [pair["query"] for pair in pairs],
            "document": [pair["document"] for pair in pairs],
        }
    )
    dimension = model.get_sentence_embedding_dimension()
    loss = losses.MatryoshkaLoss(
        model,
        losses.MultipleNegativesRankingLoss(model),
        matryoshka_dims=sorted({dimension, EMBEDDING_DIMENSION}, reverse=True),
    )
    arguments = SentenceTransformerTrainingArguments(
        output_dir=str(output),
        num_train_epochs=epochs,
        per_device_train_batch_size=batch_size,
        learning_rate=learning_rate,
        warmup_ratio=0.1,
        batch_sampler=BatchSamplers.NO_DUPLICATES,
        dataloader_drop_last=True,
        dataloader_num_workers=0,
        save_strategy="epoch",
        logging_steps=1,
        report_to="none",
        seed=seed,
        data_seed=seed,
        fp16=False,
        bf16=False,
        use_cpu=str(model.device) == "cpu",
    )
    trainer = SentenceTransformerTrainer(
        model=model,
        args=arguments,
        train_dataset=dataset,
        loss=loss,
    )
    trainer.train()
    final = output / "final"
    model.save_pretrained(str(final))
    config = {
        "base_model": BASE_MODEL,
        "revision": revision,
        "dimension": EMBEDDING_DIMENSION,
        "max_seq_length": CONTEXT_LENGTH,
        "seed": seed,
        "query_prefix": "search_query: ",
        "document_prefix": "search_document: ",
        "epochs": epochs,
        "batch_size": batch_size,
        "learning_rate": learning_rate,
        "training_pairs": len(pairs),
        "postprocessing": "saved LayerNorm, truncate to 384, L2 normalize",
    }
    (final / "embedding_config.json").write_text(
        json.dumps(config, indent=2), encoding="utf-8"
    )


def encode(model, texts: list[str], batch_size: int = 8):
    """Return normalized 384D embeddings without silently truncating any input."""
    check_lengths(model, texts)
    return model.encode(
        texts,
        batch_size=batch_size,
        truncate_dim=EMBEDDING_DIMENSION,
        normalize_embeddings=True,
        convert_to_numpy=True,
        show_progress_bar=True,
        prompt="",
    )


def evaluate(
    data: Path,
    model_name: str,
    output: Path,
    ks: list[int],
    batch_size: int = 8,
    device: str | None = None,
    trust_remote_code: bool = False,
    revision: str | None = None,
) -> dict:
    import numpy as np

    if output.exists():
        raise FileExistsError(f"Refusing to overwrite {output}")
    if batch_size < 1 or not ks or any(k < 1 for k in ks):
        raise ValueError("Batch size and recall cutoffs must be positive")
    splits = load_pairs(data)
    queries, documents, relevant = retrieval_labels(splits["test"])
    model = load_model(model_name, device, trust_remote_code, revision)
    query_vectors = encode(model, queries, batch_size)
    document_vectors = encode(model, documents, batch_size)
    # One score vector at a time bounds memory; full rankings give uncapped MRR.
    totals = {f"recall@{k}": 0.0 for k in ks}
    totals["mrr"] = 0.0
    for vector, positives in zip(query_vectors, relevant):
        scores = document_vectors @ vector
        ranking = np.argsort(-scores, kind="stable").tolist()
        for key, value in metrics([ranking], [positives], ks).items():
            totals[key] += value
    report = {
        "model": model_name,
        "revision": revision,
        "split": "test",
        "dimension": EMBEDDING_DIMENSION,
        "queries": len(queries),
        "corpus_documents": len(documents),
        "metrics": {key: value / len(queries) for key, value in totals.items()},
        "relevance": "All generated positives sharing an identical query; not exhaustive human labels",
    }
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(report, indent=2), encoding="utf-8")
    print(json.dumps(report, indent=2))
    return report
