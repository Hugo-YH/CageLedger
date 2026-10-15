#!/usr/bin/env python3
"""Mark historical reference issues in a NEW database copy, retaining evidence and audit."""

import argparse
import hashlib
import json
import os
import sqlite3
import sys
from contextlib import closing
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from scripts.check_billing_consistency import fingerprint  # noqa: E402
from server_app.domains.data_quality.service import archive_issues  # noqa: E402

REGISTRY_TABLES = {"data_quality_scans", "data_quality_issues", "data_quality_observations"}


def quote_identifier(value):
    return '"' + value.replace('"', '""') + '"'


def original_inventory(conn, scope=None):
    """Compare every old field/row, permitting only the appended review audit event."""
    if scope is None:
        scope = {}
        for (name,) in conn.execute("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'"):
            if name in REGISTRY_TABLES:
                continue
            columns = [row[1] for row in conn.execute(f"PRAGMA table_info({quote_identifier(name)})")]
            scope[name] = {
                "columns": columns,
                "maxRowid": conn.execute(f"SELECT MAX(rowid) FROM {quote_identifier(name)}").fetchone()[0],
            }
    result = {}
    for table, meta in scope.items():
        columns = ",".join(quote_identifier(column) for column in meta["columns"])
        h = hashlib.sha256()
        count = 0
        # Only audit_events may append; other original tables must remain exactly identical.
        where = " WHERE rowid<=?" if table == "audit_events" else ""
        params = (meta["maxRowid"] if meta["maxRowid"] is not None else -1,) if where else ()
        for row in conn.execute(f"SELECT rowid,{columns} FROM {quote_identifier(table)}{where} ORDER BY rowid", params):
            h.update(repr(tuple(row)).encode())
            h.update(b"\n")
            count += 1
        result[table] = {"count": count, "sha256": h.hexdigest()}
    return scope, result


def archive_copy(source, output, report_path, *, actor_name):
    source, output, report_path = (Path(path).resolve() for path in (source, output, report_path))
    protected = {Path(str(path) + suffix) for path in (source, output) for suffix in ("", "-wal", "-shm", "-journal")}
    if (
        not source.is_file()
        or output == source
        or output in {Path(str(source) + s) for s in ("-wal", "-shm", "-journal")}
    ):
        raise ValueError("输入必须是离线数据库，输出必须为不同的新文件")
    if report_path in protected or any(path.exists() for path in (output, report_path)):
        raise ValueError("输出库和报告必须是新文件，不能覆盖数据库及附属文件")
    if any(Path(str(output) + suffix).exists() for suffix in ("-wal", "-shm", "-journal")):
        raise ValueError("输出路径有遗留的SQLite附属文件，请换一个新路径")
    if not actor_name or not actor_name.strip():
        raise ValueError("必须填写核查操作者名称")
    before = fingerprint(source)
    if before[source.name + "-wal"] and before[source.name + "-wal"]["bytes"]:
        raise ValueError("请使用SQLite备份生成的完整离线副本，不能忽略非空WAL")
    created = []
    try:
        for path in (output, report_path):
            path.parent.mkdir(parents=True, exist_ok=True)
            with path.open("xb"):
                pass
            created.append(path)
            os.chmod(path, 0o600)
        with closing(sqlite3.connect(source.as_uri() + "?mode=ro&immutable=1", uri=True)) as original:
            with closing(sqlite3.connect(output)) as target:
                original.backup(target)
        with closing(sqlite3.connect(output)) as conn:
            conn.execute("PRAGMA foreign_keys=ON")
            if conn.execute("PRAGMA integrity_check").fetchone()[0] != "ok":
                raise ValueError("SQLite完整性检查失败")
            scope, inventory = original_inventory(conn)
            with conn:
                result = archive_issues(
                    conn,
                    source_sha256=before[source.name]["sha256"],
                    actor={"id": "offline-data-review", "username": "offline-data-review", "displayName": actor_name},
                )
                if original_inventory(conn, scope)[1] != inventory:
                    raise ValueError("标记过程改变了原有业务或审计记录，已回滚")
                if conn.execute("PRAGMA foreign_key_check").fetchall():
                    raise ValueError("外键检查失败，已回滚")
                if fingerprint(source) != before:
                    raise ValueError("输入在核查期间变化，请使用稳定离线备份")
            if conn.execute("PRAGMA wal_checkpoint(TRUNCATE)").fetchone()[0]:
                raise ValueError("输出副本仍被占用")
        if fingerprint(source) != before:
            raise ValueError("输入在核查期间变化，本次留档无效")
        result.update(
            {
                "inputFiles": before,
                "inputUnchanged": True,
                "originalRowsUnchanged": True,
                "database": str(source),
                "output": str(output),
            }
        )
        report_path.write_text(json.dumps(result, ensure_ascii=False, indent=2, allow_nan=False) + "\n")
        return result
    except BaseException:
        for path in created:
            path.unlink(missing_ok=True)
            if path == output:
                for suffix in ("-wal", "-shm", "-journal"):
                    Path(str(path) + suffix).unlink(missing_ok=True)
        raise


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--database", type=Path, required=True, help="稳定的完整离线备份")
    parser.add_argument("--output", type=Path, required=True, help="保存标记和证据的新SQLite副本")
    parser.add_argument("--report", type=Path, required=True, help="新JSON留档清单（含业务数据，妥善保管）")
    parser.add_argument("--actor-name", required=True, help="核查操作者名称；写入审计")
    args = parser.parse_args()
    try:
        result = archive_copy(args.database, args.output, args.report, actor_name=args.actor_name)
        print(
            json.dumps(
                {
                    k: result[k]
                    for k in (
                        "scanId",
                        "output",
                        "latestBusinessAt",
                        "summary",
                        "inputUnchanged",
                        "originalRowsUnchanged",
                    )
                },
                ensure_ascii=False,
                indent=2,
            )
        )
    except (ValueError, sqlite3.Error, OSError) as exc:
        parser.exit(1, f"问题标记留档失败：{exc}\n")


if __name__ == "__main__":
    main()
