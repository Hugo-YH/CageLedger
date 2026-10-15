#!/usr/bin/env python3
"""Exercise an offline SQLite + files backup without touching the supplied originals."""

import argparse
import json
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from scripts.restore_drill.runner import drill  # noqa: E402
from scripts.verify_database_copy import pdf_mode  # noqa: E402


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--database", required=True, type=Path, help="稳定的完整离线SQLite备份；拒绝非空WAL/journal")
    parser.add_argument(
        "--files", required=True, type=Path, help="与数据库同批备份的完整data/files目录；即使无附件也须显式提供空目录"
    )
    parser.add_argument("--output", required=True, type=Path, help="仓库外的新私有证据目录；拒绝覆盖和输入重叠")
    parser.add_argument("--pdf-samples", type=pdf_mode, default="3", help="PDF样本数，默认3；all覆盖全部账单PDF")
    parser.add_argument("--timeout", type=int, default=900, help="每个独立库的核验超时秒数，默认900")
    args = parser.parse_args()
    if args.timeout <= 0:
        parser.error("timeout必须为正数")
    os.umask(0o077)
    try:
        report = drill(
            args.database,
            args.files,
            args.output,
            Path(__file__).resolve().parent.parent,
            pdf_samples=args.pdf_samples,
            timeout=args.timeout,
        )
    except (ValueError, OSError) as exc:
        print(json.dumps({"status": "rejected", "error": str(exc)}, ensure_ascii=False))
        return 2
    print(
        json.dumps(
            {
                "status": report["status"],
                "report": str(args.output.resolve() / "report.md"),
                "databaseUnchanged": report["databaseUnchanged"],
                "filesUnchanged": report["filesUnchanged"],
                "summary": report.get("summary"),
            },
            ensure_ascii=False,
        )
    )
    return 0 if report["status"] in ("passed", "passed_with_warnings") else 1


if __name__ == "__main__":
    sys.exit(main())
