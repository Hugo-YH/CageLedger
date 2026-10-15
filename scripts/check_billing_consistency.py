#!/usr/bin/env python3
"""Check an offline SQLite backup through a temporary copy; never repair data."""

import argparse
import hashlib
import json
import sqlite3
import sys
import tempfile
from contextlib import closing
from datetime import UTC, datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from server_app.domains.reimbursement_ledger.consistency import check_consistency  # noqa: E402


def fingerprint(source):
    result = {}
    for path in (source, Path(str(source) + "-wal"), Path(str(source) + "-shm")):
        if path.exists():
            with path.open("rb") as stream:
                result[path.name] = {
                    "bytes": path.stat().st_size,
                    "sha256": hashlib.file_digest(stream, "sha256").hexdigest(),
                }
        else:
            result[path.name] = None
    return result


def review_database(source):
    source = Path(source).resolve()
    if not source.is_file():
        raise ValueError("数据库文件不存在")
    before = fingerprint(source)
    if before[source.name + "-wal"] and before[source.name + "-wal"]["bytes"]:
        raise ValueError("输入有未合并的WAL，请使用SQLite备份生成的离线副本")
    with tempfile.TemporaryDirectory(prefix="cageledger-billing-check-") as directory:
        copied = Path(directory) / "review.sqlite"
        with closing(sqlite3.connect(source.as_uri() + "?mode=ro&immutable=1", uri=True)) as original:
            with closing(sqlite3.connect(copied)) as target:
                original.backup(target)
        with closing(sqlite3.connect(copied.as_uri() + "?mode=ro", uri=True)) as conn:
            conn.execute("PRAGMA query_only=ON")
            report = check_consistency(conn)
    if before != fingerprint(source):
        raise ValueError("输入文件在检查期间变化，本次报告无效；请使用稳定离线副本")
    report.update(
        {
            "checkedAt": datetime.now(UTC).isoformat(timespec="seconds"),
            "database": str(source),
            "inputFiles": before,
            "inputUnchanged": True,
        }
    )
    return report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--database", required=True, type=Path, help="稳定的离线SQLite副本")
    parser.add_argument("--report", required=True, type=Path, help="新JSON报告；不覆盖已有文件")
    args = parser.parse_args()
    try:
        output = args.report.resolve()
        if output.exists() or output in {
            Path(str(args.database.resolve()) + suffix) for suffix in ("", "-wal", "-shm", "-journal")
        }:
            raise ValueError("报告必须是新文件，不能覆盖数据库及其附属文件")
        report = review_database(args.database)
        output.parent.mkdir(parents=True, exist_ok=True)
        with output.open("x", encoding="utf-8") as stream:
            json.dump(report, stream, ensure_ascii=False, indent=2, allow_nan=False)
            stream.write("\n")
        print(json.dumps({"report": str(output), "status": report["status"], **report["summary"]}, ensure_ascii=False))
        return 1 if report["summary"]["errors"] or report["summary"]["incomplete"] else 0
    except (ValueError, sqlite3.Error, OSError) as exc:
        parser.exit(2, f"账务一致性检查失败：{exc}\n")


if __name__ == "__main__":
    sys.exit(main())
