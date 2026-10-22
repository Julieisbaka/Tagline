"""Input normalization, source-level splitting, and structural card extraction."""

from __future__ import annotations

import hashlib
import json
import random
import re
import zipfile
from collections import defaultdict
from collections.abc import Iterable
from pathlib import Path
from typing import TypedDict
from xml.etree import ElementTree


class Source(TypedDict):
    id: str
    source_id: str
    text: str
    metadata: dict


class Card(TypedDict):
    id: str
    source_id: str
    text: str
    metadata: dict


class Pair(TypedDict):
    card_id: str
    source_id: str
    argument_type: str
    topic: str
    component: str
    query: str
    document: str


def text_field(value: object, name: str) -> str:
    if not isinstance(value, str) or not value.strip():
        raise ValueError(f"{name} must be a nonempty string")
    return value.strip()


def fingerprint(text: str) -> str:
    normalized = re.sub(r"\s+", " ", text).strip().casefold()
    return hashlib.sha256(normalized.encode("utf-8")).hexdigest()


def read_jsonl(path: Path) -> list[dict]:
    rows = []
    with path.open(encoding="utf-8-sig") as stream:
        for number, line in enumerate(stream, 1):
            if not line.strip():
                continue
            row = json.loads(line)
            if not isinstance(row, dict):
                raise ValueError(f"{path}:{number}: expected a JSON object")
            rows.append(row)
    if not rows:
        raise ValueError(f"{path}: no records")
    return rows


def write_jsonl(path: Path, rows: Iterable[dict]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8", newline="\n") as stream:
        for row in rows:
            stream.write(json.dumps(row, ensure_ascii=True) + "\n")


def normalize_sources(
    rows: Iterable[dict], text_column: str = "text", source_column: str = "source_id"
) -> list[Source]:
    sources: list[Source] = []
    seen = set()
    for row in rows:
        text = text_field(row.get(text_column), text_column)
        identifier = str(row.get("id") or fingerprint(text))
        if identifier in seen:
            raise ValueError(f"Duplicate source record id: {identifier}")
        seen.add(identifier)
        # Without an explicit source key, each record is an independent document.
        group = str(row.get(source_column) or identifier)
        metadata = row.get("metadata", {})
        if not isinstance(metadata, dict):
            raise ValueError(f"{identifier}: metadata must be an object")
        metadata = dict(metadata)
        for key in ("tags", "blocks", "pockets", "tag", "block", "pocket", "title"):
            if key in row:
                metadata[key] = row[key]
        sources.append(Source(id=identifier, source_id=group, text=text, metadata=metadata))
    if not sources:
        raise ValueError("No input documents")
    return sources


def read_document(path: Path) -> str:
    if path.suffix.lower() != ".docx":
        return path.read_text(encoding="utf-8-sig")
    namespace = {"w": "http://schemas.openxmlformats.org/wordprocessingml/2006/main"}
    with zipfile.ZipFile(path) as archive:
        root = ElementTree.fromstring(archive.read("word/document.xml"))
    paragraphs = []
    for paragraph in root.findall(".//w:p", namespace):
        text = "".join(node.text or "" for node in paragraph.findall(".//w:t", namespace))
        style = paragraph.find("w:pPr/w:pStyle", namespace)
        name = style.get(f"{{{namespace['w']}}}val", "") if style is not None else ""
        heading = re.fullmatch(r"heading([1-6])", name, re.IGNORECASE)
        if heading:
            text = "#" * int(heading.group(1)) + " " + text
        if text.strip():
            paragraphs.append(text)
    return "\n\n".join(paragraphs)


def load_directory(directory: Path) -> list[Source]:
    rows = []
    for path in sorted(directory.rglob("*")):
        if path.is_file() and path.suffix.lower() in {".md", ".txt", ".docx"}:
            identifier = str(path.relative_to(directory))
            rows.append({"id": identifier, "source_id": identifier, "text": read_document(path)})
    return normalize_sources(rows)


def split_sources(
    sources: list[Source], test_fraction: float = 0.2, seed: int = 42
) -> dict[str, list[Source]]:
    if not 0 < test_fraction < 1:
        raise ValueError("test_fraction must be between 0 and 1")
    parent = {source["source_id"]: source["source_id"] for source in sources}

    def find(key: str) -> str:
        while parent[key] != key:
            parent[key] = parent[parent[key]]
            key = parent[key]
        return key

    # Join source groups transitively when raw documents are exact normalized copies.
    owners: dict[str, str] = {}
    for source in sources:
        digest = fingerprint(source["text"])
        group = source["source_id"]
        if digest in owners:
            parent[find(group)] = find(owners[digest])
        owners[digest] = group
    groups: dict[str, list[Source]] = defaultdict(list)
    for source in sources:
        groups[find(source["source_id"])].append(source)
    keys = sorted(groups)
    if len(keys) < 2:
        raise ValueError("Need at least two independent source groups for train/test")
    random.Random(seed).shuffle(keys)
    count = max(1, min(len(keys) - 1, round(len(keys) * test_fraction)))
    test_keys = set(keys[:count])
    splits: dict[str, list[Source]] = {"train": [], "test": []}
    for key in keys:
        splits["test" if key in test_keys else "train"].extend(groups[key])
    return splits


def extract_cards(source: Source) -> list[Card]:
    # Leaf Markdown/Word headings are card boundaries; ancestors become block context.
    sections: list[tuple[list[str], str]] = []
    headings: list[tuple[int, str]] = []
    body: list[str] = []
    for line in source["text"].splitlines():
        match = re.match(r"^(#{1,6})\s+(.+?)\s*#*\s*$", line)
        if match:
            if any(part.strip() for part in body):
                sections.append(([title for _, title in headings], "\n".join(body).strip()))
            body = []
            level = len(match.group(1))
            headings = [(depth, title) for depth, title in headings if depth < level]
            headings.append((level, match.group(2)))
        else:
            body.append(line)
    if any(part.strip() for part in body):
        sections.append(([title for _, title in headings], "\n".join(body).strip()))
    cards = []
    for index, (titles, text) in enumerate(sections):
        metadata = dict(source["metadata"])
        if titles:
            metadata["headings"] = titles
            metadata["tag"] = titles[-1]
            metadata["blocks"] = titles[:-1]
        cards.append(Card(
            id=f"{source['id']}::{index}", source_id=source["source_id"],
            text=text, metadata=metadata,
        ))
    if not cards:
        raise ValueError(f"{source['id']}: no evidence body found")
    return cards


def assert_disjoint(train: Iterable[dict], test: Iterable[dict], text_key: str) -> None:
    train, test = list(train), list(test)
    if {row["source_id"] for row in train} & {row["source_id"] for row in test}:
        raise ValueError("Train/test source groups overlap")
    if {fingerprint(row[text_key]) for row in train} & {
        fingerprint(row[text_key]) for row in test
    }:
        raise ValueError(
            "Train/test evidence overlaps. Give related/copied documents the same "
            "source_id and prepare again; no leaking dataset was written."
        )


def prepare(sources: list[Source], output: Path, test_fraction: float, seed: int) -> None:
    splits = split_sources(sources, test_fraction, seed)
    cards = {
        split: [card for source in records for card in extract_cards(source)]
        for split, records in splits.items()
    }
    assert_disjoint(cards["train"], cards["test"], "text")
    output.mkdir(parents=True, exist_ok=False)
    for split in ("train", "test"):
        write_jsonl(output / f"{split}.sources.jsonl", splits[split])
        write_jsonl(output / f"{split}.cards.jsonl", cards[split])
    manifest = {
        "seed": seed, "test_fraction": test_fraction,
        "source_counts": {key: len(value) for key, value in splits.items()},
        "card_counts": {key: len(value) for key, value in cards.items()},
        "source_ids": {key: sorted({row["source_id"] for row in value})
                       for key, value in splits.items()},
    }
    (output / "split.json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")
