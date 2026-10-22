"""CPU integration test with a tiny, randomly initialized local model (no downloads)."""

import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import numpy as np
from sentence_transformers import SentenceTransformer, models
from transformers import BertConfig, BertModel, BertTokenizerFast

from model.data import prepare
from model.tests.test_pipeline import example_sources, fill_pairs
from model.training import encode, evaluate, load_model, train


class TrainingTests(unittest.TestCase):
    def test_training_save_reload_and_384d_evaluation(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            source = root / "tiny"
            source.mkdir()
            vocabulary = [
                "[PAD]",
                "[UNK]",
                "[CLS]",
                "[SEP]",
                "[MASK]",
                "search",
                "_",
                "query",
                "document",
                ":",
                "econ",
                "adv",
                "topic",
                "impact",
                "evidence",
                "body",
                "number",
                *map(str, range(10)),
            ]
            (source / "vocab.txt").write_text("\n".join(vocabulary), encoding="utf-8")
            BertTokenizerFast(vocab_file=str(source / "vocab.txt")).save_pretrained(
                source
            )
            BertModel(
                BertConfig(
                    vocab_size=len(vocabulary),
                    hidden_size=768,
                    num_hidden_layers=1,
                    num_attention_heads=12,
                    intermediate_size=64,
                    max_position_embeddings=128,
                )
            ).save_pretrained(source)
            transformer = models.Transformer(str(source), max_seq_length=128)
            model = SentenceTransformer(
                modules=[
                    transformer,
                    models.Pooling(768),
                    models.LayerNorm(768),
                    models.Normalize(),
                ],
                device="cpu",
            )
            prepared = root / "data"
            prepare(example_sources(), prepared, 0.3, 42)
            fill_pairs(prepared)
            output = root / "trained"
            with patch("model.training.load_model", return_value=model):
                train(prepared, output, batch_size=2, device="cpu")
            self.assertTrue((output / "final" / "embedding_config.json").is_file())
            reloaded = load_model(str(output / "final"), "cpu", False)
            embeddings = encode(reloaded, ["search_query: econ adv topic impact"])
            self.assertEqual(embeddings.shape, (1, 384))
            np.testing.assert_allclose(
                np.linalg.norm(embeddings, axis=1), [1], atol=1e-6
            )
            report = evaluate(
                prepared,
                str(output / "final"),
                root / "metrics.json",
                [1, 2],
                device="cpu",
            )
            self.assertEqual(report["dimension"], 384)
            self.assertEqual(report["corpus_documents"], 2)
            self.assertEqual(report["metrics"]["recall@2"], 1)
            self.assertTrue(0 < report["metrics"]["mrr"] <= 1)


if __name__ == "__main__":
    unittest.main()
