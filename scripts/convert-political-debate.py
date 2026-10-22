"""Export mlburnham/Political_DEBATE_large_v1.0 to the ONNX layout Transformers.js expects.

Usage:
    python -m venv .convert-venv
    .convert-venv\\Scripts\\pip install torch --index-url https://download.pytorch.org/whl/cpu
    .convert-venv\\Scripts\\pip install "optimum[onnxruntime]" transformers sentencepiece onnx huggingface_hub
    .convert-venv\\Scripts\\python scripts\\convert-political-debate.py out\\political-debate
    # Optional: publish (requires `huggingface-cli login` or HF_TOKEN with write access)
    .convert-venv\\Scripts\\python scripts\\convert-political-debate.py out\\political-debate \\
        --push Appleinteligence/Political_DEBATE_large_v1.0-onnx

The output folder can also be selected directly in Tagline (Settings > Integrations).
"""

import argparse
import json
import shutil
import sys
from pathlib import Path

SOURCE = "mlburnham/Political_DEBATE_large_v1.0"
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
    args = parser.parse_args()

    from onnxruntime.quantization import QuantType, quantize_dynamic
    from optimum.exporters.onnx import main_export

    output: Path = args.output.resolve()
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
    for required in (
        "config.json",
        "tokenizer.json",
        "tokenizer_config.json",
        "onnx/model_quantized.onnx",
    ):
        if not (output / required).is_file():
            print(f"Missing exported file: {required}", file=sys.stderr)
            return 1
    print(f"Exported to {output}")

    if args.push:
        from huggingface_hub import HfApi

        api = HfApi()
        api.create_repo(
            args.push, repo_type="model", private=args.private, exist_ok=True
        )
        api.upload_folder(
            repo_id=args.push,
            folder_path=str(output),
            repo_type="model",
            commit_message=f"ONNX export of {args.source}",
        )
        print(f"Uploaded to https://huggingface.co/{args.push}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
