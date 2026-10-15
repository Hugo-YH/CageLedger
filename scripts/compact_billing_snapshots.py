#!/usr/bin/env python3
"""Convert an offline database copy; never edit or overwrite the input file."""

import argparse
import hashlib
import json
import sqlite3
import sys
from contextlib import closing
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from server_app.persistence.billing_snapshot_storage import ensure_schema  # noqa: E402
from server_app.repositories.billing_snapshot_storage import compact_version, expand_version, read_records  # noqa: E402


def record_digest(records):
    return hashlib.sha256(json.dumps(records, ensure_ascii=False, separators=(",", ":")).encode()).hexdigest()


def convert_copy(source, output, *, mode="compact", vacuum=False):
    source, output = Path(source).resolve(), Path(output).resolve()
    if mode not in ("compact", "expand"):
        raise ValueError("Unknown snapshot conversion mode")
    if not source.is_file() or source == output or output.exists():
        raise ValueError("Input must exist and output must be a new, separate file")
    wal = Path(str(source) + "-wal")
    if wal.exists() and wal.stat().st_size:
        raise ValueError("Use an offline SQLite backup with no pending WAL before conversion")
    before_hash = hashlib.sha256(source.read_bytes()).hexdigest()
    output.parent.mkdir(parents=True, exist_ok=True)
    with output.open("xb"):
        pass
    with closing(sqlite3.connect(source.as_uri() + "?mode=ro&immutable=1", uri=True)) as original:
        with closing(sqlite3.connect(output)) as target:
            original.backup(target)
    conn = sqlite3.connect(output)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys=ON")
    try:
        if conn.execute("PRAGMA integrity_check").fetchone()[0] != "ok":
            raise ValueError("Input database integrity check failed")
        ensure_schema(conn)
        versions = [row[0] for row in conn.execute("SELECT id FROM billing_statement_versions ORDER BY id")]
        before = {version: record_digest(read_records(conn, version)) for version in versions}
        changed = 0
        with conn:
            conn.execute("BEGIN IMMEDIATE")
            for version in versions:
                changed += (compact_version if mode == "compact" else expand_version)(conn, version)
            if any(record_digest(read_records(conn, version)) != before[version] for version in versions):
                raise ValueError("Snapshot content/order changed during conversion")
            if conn.execute("PRAGMA foreign_key_check").fetchall():
                raise ValueError("Database foreign key check failed")
        if vacuum:
            conn.execute("VACUUM")
        if any(record_digest(read_records(conn, version)) != before[version] for version in versions):
            raise ValueError("Snapshot content/order changed after database compaction")
        if conn.execute("PRAGMA integrity_check").fetchone()[0] != "ok":
            raise ValueError("Output database integrity check failed")
        if conn.execute("PRAGMA wal_checkpoint(TRUNCATE)").fetchone()[0]:
            raise ValueError("Output copy is still in use; checkpoint did not complete")
        if (wal.exists() and wal.stat().st_size) or hashlib.sha256(source.read_bytes()).hexdigest() != before_hash:
            raise ValueError("Input changed during conversion; use a stable offline backup")
        return {
            "mode": mode,
            "output": str(output),
            "versions": len(versions),
            "converted_versions": changed,
            "input_bytes": source.stat().st_size,
            "output_bytes": output.stat().st_size,
            "input_sha256": before_hash,
            "input_unchanged": True,
            "all_snapshot_digests_equal": True,
        }
    finally:
        conn.close()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--database", required=True, type=Path, help="Offline input database copy")
    parser.add_argument("--output", required=True, type=Path, help="New output file; existing files are refused")
    parser.add_argument("--mode", choices=("compact", "expand"), default="compact")
    parser.add_argument("--vacuum", action="store_true", help="Reclaim space in the output copy only")
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
        parser.exit(1, f"Snapshot conversion failed: {exc}\n")


if __name__ == "__main__":
    main()
