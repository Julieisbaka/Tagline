"""Retrieval labels and metrics, independent of the ML runtime."""

from __future__ import annotations

from collections import defaultdict
from collections.abc import Iterable, Sequence

from .data import Pair, fingerprint, text_field
from .queries import make_pair


def validate_pairs(rows: Iterable[dict]) -> list[Pair]:
    pairs = []
    ids: dict[str, tuple[str, str]] = {}
    for row in rows:
        card_id = text_field(row.get("card_id"), "card_id")
        source_id = text_field(row.get("source_id"), "source_id")
        document = text_field(row.get("document"), "document")
        if not document.startswith("search_document: ") or not document[17:].strip():
            raise ValueError(
                "Documents must start with search_document: and contain evidence"
            )
        expected = make_pair(
            {
                "id": card_id,
                "source_id": source_id,
                "text": document[17:],
                "metadata": {},
            },
            {key: row.get(key) for key in ("argument_type", "topic", "component")},
        )
        if row.get("query") != expected["query"]:
            raise ValueError(f"{card_id}: query does not match its structured fields")
        identity = (source_id, document)
        if card_id in ids and ids[card_id] != identity:
            raise ValueError(f"{card_id}: conflicting card contents or source")
        ids[card_id] = identity
        pairs.append(expected)
    if not pairs:
        raise ValueError("No query/document pairs")
    return pairs


def retrieval_labels(
    pairs: list[Pair],
) -> tuple[list[str], list[str], list[set[int]]]:
    # Exact same query can have multiple known-positive cards. Do not score them as negatives.
    documents = sorted({pair["document"] for pair in pairs})
    indices = {document: index for index, document in enumerate(documents)}
    by_query: dict[str, set[int]] = defaultdict(set)
    for pair in pairs:
        by_query[pair["query"]].add(indices[pair["document"]])
    queries = sorted(by_query)
    return queries, documents, [by_query[query] for query in queries]


def metrics(
    rankings: Sequence[Sequence[int]],
    relevant: Sequence[set[int]],
    ks: Sequence[int],
) -> dict[str, float]:
    if not rankings or len(rankings) != len(relevant):
        raise ValueError("Need matching, nonempty rankings and relevance labels")
    if not ks or any(k < 1 for k in ks):
        raise ValueError("Recall cutoffs must be positive")
    sums = {f"recall@{k}": 0.0 for k in ks}
    sums["mrr"] = 0.0
    for ranking, positives in zip(rankings, relevant):
        if not positives or len(set(ranking)) != len(ranking):
            raise ValueError("Need nonempty positives and a ranking without duplicates")
        for k in ks:
            sums[f"recall@{k}"] += len(set(ranking[:k]) & positives) / len(positives)
        sums["mrr"] += next(
            (1 / rank for rank, doc in enumerate(ranking, 1) if doc in positives),
            0.0,
        )
    return {key: value / len(rankings) for key, value in sums.items()}


def unique_training_pairs(pairs: list[Pair]) -> list[Pair]:
    # NO_DUPLICATES sampling prevents same-query/card false negatives within a batch.
    seen = set()
    result = []
    for pair in pairs:
        key = (pair["query"], fingerprint(pair["document"]))
        if key not in seen:
            seen.add(key)
            result.append(pair)
    if (
        len({pair["query"] for pair in result}) < 2
        or len({fingerprint(pair["document"]) for pair in result}) < 2
    ):
        raise ValueError("MNRL requires at least two distinct queries and documents")
    return result
