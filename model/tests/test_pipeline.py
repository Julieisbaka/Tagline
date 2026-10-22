import json
import tempfile
import threading
import unittest
import zipfile
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path
from unittest.mock import patch

from model.data import (
    assert_disjoint,
    extract_cards,
    load_directory,
    normalize_sources,
    prepare,
    read_jsonl,
    split_sources,
    write_jsonl,
)
from model.queries import check_endpoint, generate, make_pair
from model.retrieval import (
    metrics,
    retrieval_labels,
    unique_training_pairs,
    validate_pairs,
)
from model.training import check_lengths, load_pairs


def example_sources(count=6):
    return normalize_sources(
        [
            {
                "id": str(i),
                "source_id": f"file-{i}",
                "text": f"Evidence body number {i}",
                "tags": [f"topic {i}"],
            }
            for i in range(count)
        ]
    )


def fill_pairs(directory):
    for split in ("train", "test"):
        pairs = [
            make_pair(
                card,
                {
                    "argument_type": "econ adv",
                    "topic": f"topic {i}",
                    "component": "impact",
                },
            )
            for i, card in enumerate(read_jsonl(directory / f"{split}.cards.jsonl"))
        ]
        write_jsonl(directory / f"{split}.pairs.jsonl", pairs)


class DataTests(unittest.TestCase):
    def test_source_groups_and_raw_duplicates_never_cross_split(self):
        rows = [
            {"id": "a", "source_id": "one", "text": "shared text"},
            {"id": "b", "source_id": "two", "text": " SHARED \n TEXT "},
            {"id": "c", "source_id": "two", "text": "second card"},
            {"id": "d", "source_id": "three", "text": "other evidence"},
        ]
        sources = normalize_sources(rows)
        splits = split_sources(sources, 0.5)
        self.assertEqual(splits, split_sources(sources, 0.5))
        assert_disjoint(splits["train"], splits["test"], "text")
        owner = {row["id"]: key for key, records in splits.items() for row in records}
        self.assertEqual(owner["a"], owner["b"])
        self.assertEqual(owner["b"], owner["c"])

    def test_heading_context_and_no_truncation(self):
        text = "# Cap K\n## Communism\n### Alt\n" + "Full evidence. " * 9000
        source = normalize_sources([{"text": text, "pockets": ["negative"]}])[0]
        cards = extract_cards(source)
        self.assertEqual(len(cards), 1)
        self.assertEqual(cards[0]["text"], ("Full evidence. " * 9000).strip())
        self.assertEqual(
            cards[0]["metadata"]["headings"], ["Cap K", "Communism", "Alt"]
        )
        self.assertEqual(cards[0]["metadata"]["pockets"], ["negative"])

    def test_parse_docx_and_text_directory(self):
        xml = (
            '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">'
            '<w:body><w:p><w:pPr><w:pStyle w:val="Heading2"/></w:pPr>'
            "<w:r><w:t>Impact</w:t></w:r></w:p>"
            "<w:p><w:r><w:t>Nuclear war evidence</w:t></w:r></w:p></w:body></w:document>"
        )
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            (root / "card.txt").write_text("Plain text evidence", encoding="utf-8")
            with zipfile.ZipFile(root / "case.docx", "w") as archive:
                archive.writestr("word/document.xml", xml)
            sources = load_directory(root)
            self.assertEqual(len(sources), 2)
            card = extract_cards(sources[1])[0]
            self.assertEqual(card["text"], "Nuclear war evidence")
            self.assertEqual(card["metadata"]["tag"], "Impact")

    def test_duplicate_card_detection_before_output(self):
        sources = normalize_sources(
            [
                {"text": "# One\nShared evidence body"},
                {"text": "# Two\nShared evidence body"},
            ]
        )
        with tempfile.TemporaryDirectory() as temp:
            output = Path(temp) / "prepared"
            with self.assertRaisesRegex(ValueError, "evidence overlaps"):
                prepare(sources, output, 0.5, 42)
            self.assertFalse(output.exists())

    def test_prepare_and_pair_provenance(self):
        with tempfile.TemporaryDirectory() as temp:
            output = Path(temp) / "prepared"
            prepare(example_sources(), output, 0.3, 42)
            fill_pairs(output)
            splits = load_pairs(output)
            self.assertEqual(len(splits["train"]) + len(splits["test"]), 6)
            with self.assertRaises(FileExistsError):
                prepare(example_sources(), output, 0.3, 42)
            pairs = read_jsonl(output / "test.pairs.jsonl")
            pairs[0]["document"] = "search_document: tampered evidence"
            write_jsonl(output / "test.pairs.jsonl", pairs)
            with self.assertRaisesRegex(ValueError, "does not match prepared"):
                load_pairs(output)

    def test_invalid_sources_and_split(self):
        with self.assertRaises(ValueError):
            normalize_sources([{"text": ""}])
        with self.assertRaises(ValueError):
            split_sources(example_sources(), 1)
        with self.assertRaises(ValueError):
            split_sources(example_sources(1))
        with self.assertRaises(ValueError):
            normalize_sources(
                [{"id": "same", "text": "a"}, {"id": "same", "text": "b"}]
            )


class QueryTests(unittest.TestCase):
    def test_all_requested_query_examples(self):
        card = extract_cards(example_sources(1)[0])[0]
        for argument, topic, component in [
            ("cap k", "communism", "alt"),
            ("econ adv", "nuclear war", "impact"),
            ("pt da", "transition tax", "link"),
            ("states cp", "50 state", "solvency"),
            ("t", "25 percent", "definition"),
        ]:
            pair = make_pair(
                card,
                {
                    "argument_type": argument,
                    "topic": topic,
                    "component": component,
                },
            )
            self.assertEqual(
                pair["query"], f"search_query: {argument} {topic} {component}"
            )
            self.assertEqual(validate_pairs([pair]), [pair])

    def test_invalid_query_and_endpoint(self):
        card = extract_cards(example_sources(1)[0])[0]
        fields = {"argument_type": "cap k", "topic": "communism", "component": "alt"}
        for replacement in [
            {"component": "blah"},
            {"topic": "why?"},
            {"topic": "one\ntwo"},
            {"argument_type": "unknown"},
            {"topic": ""},
            {"extra": "field"},
        ]:
            with self.assertRaises(ValueError):
                make_pair(card, fields | replacement)
        check_endpoint("http://127.0.0.1:8000/v1/chat/completions", False)
        with self.assertRaisesRegex(ValueError, "allow-remote"):
            check_endpoint("https://example.com/v1/chat/completions", False)
        with self.assertRaisesRegex(ValueError, "HTTPS"):
            check_endpoint("http://example.com", True)

    def test_generation_uses_chat_api_and_preserves_full_evidence(self):
        received = []

        class Handler(BaseHTTPRequestHandler):
            def do_POST(self):
                received.append(
                    json.loads(self.rfile.read(int(self.headers["Content-Length"])))
                )
                fields = {
                    "argument_type": "cap k",
                    "topic": "communism",
                    "component": "alt",
                }
                response = {"choices": [{"message": {"content": json.dumps(fields)}}]}
                self.send_response(200)
                self.end_headers()
                self.wfile.write(json.dumps(response).encode())

            def log_message(self, *args):
                pass

        server = HTTPServer(("127.0.0.1", 0), Handler)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            with tempfile.TemporaryDirectory() as temp:
                source, output = Path(temp) / "cards.jsonl", Path(temp) / "pairs.jsonl"
                card = extract_cards(example_sources(1)[0])[0]
                write_jsonl(source, [card])
                generate(
                    source, output, f"http://127.0.0.1:{server.server_port}", "local"
                )
                pair = read_jsonl(output)[0]
                self.assertEqual(pair["query"], "search_query: cap k communism alt")
                payload = json.loads(received[0]["messages"][1]["content"])
                self.assertEqual(payload["evidence"], card["text"])
                with self.assertRaises(FileExistsError):
                    generate(
                        source,
                        output,
                        f"http://127.0.0.1:{server.server_port}",
                        "local",
                    )
        finally:
            server.shutdown()
            server.server_close()
            thread.join()


class RetrievalTests(unittest.TestCase):
    def test_exact_recall_and_uncapped_mrr(self):
        result = metrics([[0, 1, 2], [2, 0, 1]], [{0, 2}, {1}], [1, 2, 3])
        self.assertAlmostEqual(result["recall@1"], 0.25)
        self.assertAlmostEqual(result["recall@2"], 0.25)
        self.assertEqual(result["recall@3"], 1)
        self.assertAlmostEqual(result["mrr"], (1 + 1 / 3) / 2)

    def test_multi_positive_queries(self):
        pairs = [
            make_pair(
                extract_cards(source)[0],
                {
                    "argument_type": "econ adv",
                    "topic": "nuclear war",
                    "component": "impact",
                },
            )
            for source in example_sources(2)
        ]
        queries, documents, relevant = retrieval_labels(pairs + pairs)
        self.assertEqual(len(queries), 1)
        self.assertEqual(len(documents), 2)
        self.assertEqual(relevant, [{0, 1}])
        with self.assertRaisesRegex(ValueError, "two distinct"):
            unique_training_pairs(pairs)

    def test_context_limit_includes_prefix_and_special_tokens(self):
        model = unittest.mock.Mock()
        model.tokenizer.return_value = {"length": [8192]}
        check_lengths(model, ["search_document: full evidence"])
        self.assertFalse(model.tokenizer.call_args.kwargs["truncation"])
        model.tokenizer.return_value = {"length": [8193]}
        with self.assertRaisesRegex(ValueError, "8193 tokens"):
            check_lengths(model, ["search_document: oversized evidence"])

    def test_pair_and_metric_validation(self):
        with self.assertRaises(ValueError):
            validate_pairs([])
        with self.assertRaises(ValueError):
            metrics([[0, 0]], [{0}], [1])
        with self.assertRaises(ValueError):
            metrics([[0]], [{0}], [0])


if __name__ == "__main__":
    unittest.main()
