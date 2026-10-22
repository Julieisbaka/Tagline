"""Run with python -m model from the repository root."""

from __future__ import annotations

import argparse
from pathlib import Path

from .data import load_directory, normalize_sources, prepare, read_jsonl
from .queries import generate
from .training import BASE_MODEL, evaluate, train


def main() -> None:
    parser = argparse.ArgumentParser(description="Policy debate embedding pipeline")
    commands = parser.add_subparsers(dest="command", required=True)
    preparation = commands.add_parser("prepare", help="Split sources, then extract cards")
    source = preparation.add_mutually_exclusive_group(required=True)
    source.add_argument("--input", type=Path, help="Source JSONL or directory of md/txt/docx")
    source.add_argument("--hf-dataset", help="Hugging Face dataset repository")
    preparation.add_argument("--hf-config")
    preparation.add_argument("--hf-split", default="train",
                             help="Raw source split to resplit by document group")
    preparation.add_argument("--hf-revision")
    preparation.add_argument("--text-column", default="text")
    preparation.add_argument("--source-column", default="source_id")
    preparation.add_argument("--output", type=Path, required=True)
    preparation.add_argument("--test-fraction", type=float, default=0.2)
    preparation.add_argument("--seed", type=int, default=42)

    generation = commands.add_parser("generate", help="Generate queries for ONE prepared split")
    generation.add_argument("--data", type=Path, required=True)
    generation.add_argument("--split", choices=["train", "test"], required=True)
    generation.add_argument("--endpoint", default="http://127.0.0.1:8000/v1/chat/completions")
    generation.add_argument("--llm", required=True, help="Model served by the chat API")
    generation.add_argument("--allow-remote", action="store_true",
                            help="Consent to transmitting evidence to a remote HTTPS endpoint")

    training = commands.add_parser("train", help="Train only on training pairs")
    training.add_argument("--data", type=Path, required=True)
    training.add_argument("--output", type=Path, required=True)
    training.add_argument("--epochs", type=float, default=1)
    training.add_argument("--batch-size", type=int, default=8)
    training.add_argument("--learning-rate", type=float, default=2e-5)
    training.add_argument("--seed", type=int, default=42)
    training.add_argument("--revision", help="Pin the base model revision")
    training.add_argument("--device", help="cpu, cuda, cuda:0, etc.")
    training.add_argument("--trust-remote-code", action="store_true",
                          help="Allow execution of Hugging Face model code; review/pin it first")

    evaluation = commands.add_parser("evaluate", help="Evaluate held-out retrieval at 384D")
    evaluation.add_argument("--data", type=Path, required=True)
    evaluation.add_argument("--model", default=BASE_MODEL, help="HF model id or trained final folder")
    evaluation.add_argument("--output", type=Path, required=True)
    evaluation.add_argument("--k", type=int, nargs="+", default=[1, 5, 10, 100])
    evaluation.add_argument("--batch-size", type=int, default=8)
    evaluation.add_argument("--device")
    evaluation.add_argument("--revision")
    evaluation.add_argument("--trust-remote-code", action="store_true")
    args = parser.parse_args()
    if args.command == "prepare":
        if args.hf_dataset:
            from datasets import load_dataset

            rows = load_dataset(
                args.hf_dataset, name=args.hf_config, split=args.hf_split,
                revision=args.hf_revision,
            )
            sources = normalize_sources(rows, args.text_column, args.source_column)
        elif args.input.is_dir():
            sources = load_directory(args.input)
        else:
            sources = normalize_sources(
                read_jsonl(args.input), args.text_column, args.source_column,
            )
        prepare(sources, args.output, args.test_fraction, args.seed)
    elif args.command == "generate":
        generate(
            args.data / f"{args.split}.cards.jsonl",
            args.data / f"{args.split}.pairs.jsonl",
            args.endpoint, args.llm, args.allow_remote,
        )
    elif args.command == "train":
        train(
            args.data, args.output, args.epochs, args.batch_size,
            args.learning_rate, args.device, args.trust_remote_code,
            args.revision, args.seed,
        )
    elif args.command == "evaluate":
        evaluate(
            args.data, args.model, args.output, args.k, args.batch_size,
            args.device, args.trust_remote_code, args.revision,
        )


if __name__ == "__main__":
    main()
