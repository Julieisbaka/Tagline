"""Export mlburnham/Political_DEBATE_large_v1.0 to the ONNX layout Transformers.js expects.

Usage:
    python -m venv .convert-venv
    .convert-venv\\Scripts\\pip install torch --index-url https://download.pytorch.org/whl/cpu
    .convert-venv\\Scripts\\pip install "optimum[onnxruntime]" transformers sentencepiece onnx huggingface_hub
    .convert-venv\\Scripts\\python scripts\\convert-political-debate.py out\\political-debate
    # Optional: publish. Needs a write token: HF_TOKEN in the repo-root .env file,
    # the HF_TOKEN environment variable, or `huggingface-cli login`.
    .convert-venv\\Scripts\\python scripts\\convert-political-debate.py out\\political-debate \\
        --push Appleinteligence/Political_DEBATE_large_v1.0-onnx
    # Publish an existing converted folder without re-exporting (only needs huggingface_hub):
    python scripts\\convert-political-debate.py out\\political-debate --upload-only \\
        --push Appleinteligence/Political_DEBATE_large_v1.0-onnx

The output folder can also be selected directly in Tagline (Settings > Integrations).
"""

import argparse
import json
import os
import shutil
import sys
from pathlib import Path

SOURCE = "mlburnham/Political_DEBATE_large_v1.0"
TOKEN_PLACEHOLDER = "hf_your_write_token_here"
REQUIRED_FILES = (
    "config.json",
    "tokenizer.json",
    "tokenizer_config.json",
    "onnx/model_quantized.onnx",
)


def load_env_token() -> None:
    """Set HF_TOKEN from the repo-root .env unless it is already set or still the placeholder."""
    if os.environ.get("HF_TOKEN"):
        return
    env_file = Path(__file__).resolve().parent.parent / ".env"
    if not env_file.is_file():
        return
    for line in env_file.read_text(encoding="utf-8").splitlines():
        key, sep, value = line.strip().partition("=")
        if sep and key.strip() == "HF_TOKEN":
            value = value.strip().strip("'\"")
            if value and value != TOKEN_PLACEHOLDER:
                os.environ["HF_TOKEN"] = value
            return


EXPECTED_LABELS = {"0": "entailment", "1": "not_entailment"}

CARD = f"""---
license: mit
base_model: {SOURCE}
library_name: transformers.js
pipeline_tag: zero-shot-classification
language: en
tags: [onnx, deberta-v2, politics, nli]
---

# Political_DEBATE_large_v1.0 (ONNX)

ONNX export of [{SOURCE}](https://huggingface.co/{SOURCE}) (MIT) for
[Transformers.js](https://huggingface.co/docs/transformers.js). Weights are unchanged apart from
format conversion; `onnx/model_quantized.onnx` is dynamic int8 quantization of `onnx/model.onnx`.

The model is a natural-language-inference classifier: the document is the premise and a short
hypothesis (for example "The author of this text believes {{}}.") is scored as `entailment` or
`not_entailment`. See the original model card and paper (arXiv:2409.02078) for intended use,
evaluation, and limitations. Please cite the original authors.
"""


def main() -> int:
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    parser.add_argument("output", type=Path)
    parser.add_argument("--source", default=SOURCE)
    parser.add_argument(
        "--push",
        metavar="REPO_ID",
        help="Upload the result to this Hugging Face model repo.",
    )
    parser.add_argument(
        "--private", action="store_true", help="Create the pushed repo as private."
    )
    parser.add_argument(
        "--upload-only",
        action="store_true",
        help="Skip conversion and upload an existing converted output folder (requires --push).",
    )
    args = parser.parse_args()
    output: Path = args.output.resolve()

    if args.upload_only:
        if not args.push:
            parser.error("--upload-only requires --push REPO_ID")
        missing = [name for name in REQUIRED_FILES if not (output / name).is_file()]
        if missing:
            print(
                f"Not a converted folder (missing {', '.join(missing)}): {output}",
                file=sys.stderr,
            )
            return 1
        return push(args, output)

    from onnxruntime.quantization import QuantType, quantize_dynamic
    from optimum.exporters.onnx import main_export

    if output.exists() and any(output.iterdir()):
        print(f"Output folder is not empty: {output}", file=sys.stderr)
        return 1
    staging = output / "_export"
    main_export(
        args.source,
        output=staging,
        task="text-classification",
        opset=18,
        do_validation=True,
    )

    config = json.loads((staging / "config.json").read_text(encoding="utf-8"))
    if config.get("id2label") != EXPECTED_LABELS:
        print(
            f"Unexpected labels {config.get('id2label')}; Tagline expects {EXPECTED_LABELS}.",
            file=sys.stderr,
        )
        return 1

    onnx_dir = output / "onnx"
    onnx_dir.mkdir(parents=True)
    for item in staging.iterdir():
        if item.suffix in (".onnx", ".onnx_data"):
            shutil.move(str(item), onnx_dir / item.name)
        else:
            shutil.move(str(item), output / item.name)
    staging.rmdir()

    quantize_dynamic(
        str(onnx_dir / "model.onnx"),
        str(onnx_dir / "model_quantized.onnx"),
        weight_type=QuantType.QInt8,
    )
    (output / "README.md").write_text(CARD, encoding="utf-8")
    for required in REQUIRED_FILES:
        if not (output / required).is_file():
            print(f"Missing exported file: {required}", file=sys.stderr)
            return 1
    print(f"Exported to {output}")

    return push(args, output) if args.push else 0


def push(args: argparse.Namespace, output: Path) -> int:
    from huggingface_hub import HfApi

    load_env_token()
    api = HfApi()
    api.create_repo(args.push, repo_type="model", private=args.private, exist_ok=True)
    api.upload_folder(
        repo_id=args.push,
        folder_path=str(output),
        repo_type="model",
        commit_message=f"ONNX export of {args.source}",
        ignore_patterns=["_export/*"],
    )
    print(f"Uploaded to https://huggingface.co/{args.push}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
