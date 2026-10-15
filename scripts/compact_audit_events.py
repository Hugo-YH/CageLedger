#!/usr/bin/env python3
"""Losslessly compress or expand audit JSON in a new offline database copy."""

import argparse
import hashlib
import json
import sqlite3
import sys
from contextlib import closing
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from scripts.check_billing_consistency import fingerprint  # noqa: E402
from server_app.persistence.audit_storage import ensure_schema  # noqa: E402
from server_app.repositories.audit_storage import compact_event, expand_event, read_payload  # noqa: E402


def event_digests(conn, ids):
    return {identity: hashlib.sha256(read_payload(conn, identity).encode()).hexdigest() for identity in ids}


def convert_copy(source, output, *, mode="compact", vacuum=False):
    source, output = Path(source).resolve(), Path(output).resolve()
    if mode not in ("compact", "expand") or not source.is_file() or source == output or output.exists():
        raise ValueError("输入必须存在，输出必须为不同的新文件，转换模式必须有效")
    before = fingerprint(source)
    if before[source.name + "-wal"] and before[source.name + "-wal"]["bytes"]:
        raise ValueError("请使用没有未合并WAL的稳定离线备份")
    output.parent.mkdir(parents=True, exist_ok=True)
    with output.open("xb"):
        pass
    with closing(sqlite3.connect(source.as_uri() + "?mode=ro&immutable=1", uri=True)) as original:
        with closing(sqlite3.connect(output)) as target:
            original.backup(target)
    with closing(sqlite3.connect(output)) as conn:
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA foreign_keys=ON")
        if conn.execute("PRAGMA integrity_check").fetchone()[0] != "ok":
            raise ValueError("输入SQLite完整性检查失败")
        ensure_schema(conn)
        ids = [row[0] for row in conn.execute("SELECT id FROM audit_events ORDER BY rowid")]
        digests = event_digests(conn, ids)
        changed = 0
        with conn:
            conn.execute("BEGIN IMMEDIATE")
            for identity in ids:
                changed += (compact_event if mode == "compact" else expand_event)(conn, identity)
            if digests != event_digests(conn, ids):
                raise ValueError("审计原始JSON在转换中变化")
            if conn.execute("PRAGMA foreign_key_check").fetchall():
                raise ValueError("外键检查失败")
        if vacuum:
            conn.execute("VACUUM")
        if digests != event_digests(conn, ids) or conn.execute("PRAGMA integrity_check").fetchone()[0] != "ok":
            raise ValueError("输出审计内容或SQLite完整性校验失败")
        if conn.execute("PRAGMA wal_checkpoint(TRUNCATE)").fetchone()[0]:
            raise ValueError("输出副本仍被占用")
        if before != fingerprint(source):
            raise ValueError("输入在转换期间变化，转换结果无效")
        return {
            "mode": mode,
            "events": len(ids),
            "convertedEvents": changed,
            "output": str(output),
            "inputBytes": source.stat().st_size,
            "outputBytes": output.stat().st_size,
            "inputUnchanged": True,
            "allOriginalJsonDigestsEqual": True,
        }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--database", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--mode", choices=("compact", "expand"), default="compact")
    parser.add_argument("--vacuum", action="store_true")
    args = parser.parse_args()
    try:
        print(
            json.dumps(
                convert_copy(args.database, args.output, mode=args.mode, vacuum=args.vacuum),
                ensure_ascii=False,
                indent=2,
            )
        )
    except (ValueError, sqlite3.Error, OSError) as exc:
        parser.exit(1, f"审计存储转换失败：{exc}\n")


if __name__ == "__main__":
    main()
