#!/usr/bin/env python3
"""Compare current code with a Git revision using new private copies of an offline SQLite backup."""

import argparse
import json
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from scripts.database_review.runner import review  # noqa: E402


def pdf_mode(value):
    if value == "all" or value.isdigit() and int(value) > 0:
        return value
    raise argparse.ArgumentTypeError("PDF覆盖须为正整数样本数或all，不能静默跳过")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--database", required=True, type=Path, help="无未合并WAL/journal的稳定离线备份，输入只读")
    parser.add_argument("--baseline-ref", required=True, help="明确指定已提交的Git基准，例如已发布tag或HEAD")
    parser.add_argument("--output", required=True, type=Path, help="仓库外的新隔离证据目录；拒绝覆盖已有目录")
    parser.add_argument("--pdf-samples", type=pdf_mode, default="3", help="代表PDF样本数，默认3；all表示全部账单")
    parser.add_argument("--timeout", type=int, default=900, help="每个代码版本核查超时秒数，默认900")
    args = parser.parse_args()
    if args.timeout <= 0:
        parser.error("timeout必须为正数")
    os.umask(0o077)
    try:
        result = review(
            args.database,
            args.output,
            Path(__file__).resolve().parent.parent,
            args.baseline_ref,
            pdf_samples=args.pdf_samples,
            timeout=args.timeout,
        )
    except (ValueError, OSError) as exc:
        print(json.dumps({"status": "rejected", "error": str(exc)}, ensure_ascii=False))
        return 2
    print(
        json.dumps(
            {
                "status": result["status"],
                "report": str(args.output.resolve() / "report.json"),
                "inputUnchanged": result["inputUnchanged"],
                "summary": result.get("summary"),
            },
            ensure_ascii=False,
        )
    )
    return 0 if result["status"] in ("passed", "passed_with_warnings") else 1


if __name__ == "__main__":
    sys.exit(main())
