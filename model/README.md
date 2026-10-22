# Debate embedding pipeline

Standalone Python code for preparing policy debate evidence, generating shorthand
queries, fine-tuning `nomic-ai/nomic-embed-text-v1.5`, and evaluating held-out
retrieval. This does not change the Electron application's search model.
No dataset or trained model is uploaded automatically.

## Setup

Run all commands from the repository root. Python 3.11+ is recommended.
Use an isolated environment; training full-length evidence is best done on a GPU.
The default install works without compiled FlashAttention extensions.

```powershell
python -m venv model\.venv
.\model\.venv\Scripts\python.exe -m pip install -r model\requirements.txt
.\model\.venv\Scripts\python.exe -m model --help
```

The commands below assume that environment is activated:

```powershell
.\model\.venv\Scripts\Activate.ps1
```

## 1. Prepare and split sources

Input can be a directory of `.md`, `.txt`, or `.docx` documents, or UTF-8 JSONL
with one source record per line:

```json
{"id":"case-1","source_id":"original-file-1","text":"# Cap K\n## Communism Alt\nFull citation and evidence here.","tags":["cap k"],"blocks":["alternatives"],"pockets":["negative"]}
```

`text` is required. `id` defaults to a content hash. `source_id` defaults to `id`;
**supply the same `source_id` for every card/version from the same original file**.
Metadata can be in a `metadata` object or top-level
`tags`, `blocks`, `pockets`, `tag`, `block`, `pocket`, and `title` fields.

```powershell
python -m model prepare --input "C:\evidence" --output model\data\debate --test-fraction 0.2 --seed 42
# Alternatively:
python -m model prepare --input model\data\sources.jsonl --output model\data\debate
```

An existing Hugging Face dataset can be loaded instead:

```powershell
python -m model prepare --hf-dataset OWNER/DATASET --hf-split train --text-column text --source-column source_id --output model\data\debate
```

Use `--hf-config` and `--hf-revision` where needed. This reads the chosen raw
partition and creates a new source-grouped train/test split; it does not preserve
an existing benchmark's official split.

Preparation splits raw source groups **before query generation**. Exact normalized
document copies join the same group transitively. The test fraction applies to
groups, not card counts. Markdown/Word headings define evidence sections, retaining
ancestor headings and OpenCaseList metadata as query-generation context. Plain
text without headings is treated as a single card. This is a conservative parser,
not a scraper or a universal parser for all OpenCaseList formats. Export additional
format-specific metadata into the JSONL schema first.

Exact cross-split duplicate card bodies are rejected before output is written.
Assign copied/related source files the same `source_id` and rerun preparation.
Near-duplicate evidence still requires upstream deduplication/human review.
Output includes split source records, extracted cards, and a split manifest.
Commands refuse to overwrite existing prepared data, generated pairs, training
directories, and evaluation reports.

## 2. Generate queries

Start a local OpenAI-compatible chat-completions server with a suitable instruction
model. The server must support JSON-object responses and enough context for the
entire evidence card plus prompt. No evidence is shortened before sending it.
Choose its actual served model name for `--llm`.

```powershell
python -m model generate --data model\data\debate --split train --llm YOUR_LOCAL_MODEL
python -m model generate --data model\data\debate --split test --llm YOUR_LOCAL_MODEL
```

Default endpoint: `http://127.0.0.1:8000/v1/chat/completions`.
Override it with `--endpoint`. A remote HTTPS endpoint additionally requires
`--allow-remote`, which explicitly permits transmitting the evidence. Credentials,
if needed, are read from `LLM_API_KEY`, not committed configuration.

The LLM returns separate `argument_type`, `topic`, and `component` fields. Code
validates and assembles them in that order, e.g.:

- `search_query: cap k communism alt`
- `search_query: econ adv nuclear war impact`
- `search_query: pt da transition tax link`
- `search_query: states cp 50 state solvency`

Every pair also contains `search_document: ` followed by the complete evidence
body, plus its card/source identifiers and query fields. Invalid responses and
API errors stop the command without writing a success-shaped dataset. Review
generated queries for semantic correctness before training; structural validation
cannot establish that the LLM understood the evidence. Freeze the prompt and test
set before training; do not tune on held-out test metrics.

## 3. Train

```powershell
python -m model train --data model\data\debate --output model\output\debate --epochs 1 --batch-size 8 --device cuda --trust-remote-code
```

The flag permits loading the base model's custom Hugging Face code. Review that
code and pin `--revision` to a reviewed model revision for reproducible runs.
Hugging Face authentication uses the usual local HF configuration/environment.
No credentials are needed for the public base model.

Training uses only training pairs and never evaluates on the test set during
training. Both splits' provenance and disjointness are validated on disk.
MultipleNegativesRankingLoss is wrapped in MatryoshkaLoss at the full embedding
dimension and **384 dimensions**. No-duplicate batches avoid putting identical
queries or evidence into the same in-batch-negative set. Full batches are required;
use a smaller batch size if needed (minimum 2). Gradient accumulation would not
increase MNRL's effective negative pool. Semantically similar, nonidentical
queries/cards can still be false negatives and need data curation.

The model uses mean pooling, a saved LayerNorm initialized to the Nomic
postprocessing transform, and L2 normalization. It configures the Nomic rotary
scaling for an **8,192-token** maximum. Prefixes and special tokens count toward
that limit. Over-length cards/queries fail explicitly rather than being silently
truncated. Split oversized cards intentionally and regenerate their queries.
Batch size 8 at 8,192 tokens can require substantial VRAM; lower it as needed.

The checkpoint is saved under `model\output\debate\final`, together with
`embedding_config.json`. Matryoshka truncation reduces stored **embedding** size,
not model weight size. The checkpoint retains the full encoder dimension;
the provided `encode` helper and evaluation always truncate and renormalize to 384:

```python
from model.training import encode, load_model

model = load_model(r"model\output\debate\final", "cpu", trust_remote_code=True)
vectors = encode(model, ["search_query: states cp 50 state solvency"])
assert vectors.shape == (1, 384)
```

## 4. Evaluate

Evaluate the base model and trained model against exactly the same held-out pairs:

```powershell
python -m model evaluate --data model\data\debate --output model\output\baseline.json --k 1 5 10 100 --trust-remote-code
python -m model evaluate --data model\data\debate --model model\output\debate\final --output model\output\finetuned.json --k 1 5 10 100 --trust-remote-code
```

Reports contain Recall@k and full, uncapped MRR at 384 dimensions. The retrieval
corpus consists of unique test evidence bodies. Identical generated queries are
merged and all their known-positive documents count as relevant. Recall@k is the
fraction of known relevant documents found in the first k results, macro-averaged
over unique queries. MRR uses the first relevant document's rank. Ties are resolved
deterministically by sorted document order. Scoring holds corpus embeddings in
memory, but only one query's score vector at a time.

These are synthetic-query metrics, not exhaustive human relevance judgments;
human-written queries and adjudicated positives should be a subsequent benchmark.
No quality improvement is asserted until real data has been trained and evaluated.

## Tests

```powershell
# Standard-library tests, including a local mock chat server:
python -m unittest model.tests.test_pipeline -v
# Includes a real train/save/reload/evaluate CPU round trip with a tiny random model:
python -m unittest discover -s model\tests -v
```

The integration test downloads no model or dataset. The eventual dataset/model
repositories can be chosen later: preparation already accepts HF dataset IDs,
and the final checkpoint is in Sentence Transformers `save_pretrained` format.
Publishing and application/ONNX integration are intentionally not performed here.
