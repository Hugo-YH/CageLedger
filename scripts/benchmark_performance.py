#!/usr/bin/env python3
"""Generate a disposable scale database and benchmark CageLedger list queries."""

from __future__ import annotations

import argparse
import json
import math
import os
from pathlib import Path
import sqlite3
import statistics
import tempfile
import time
from concurrent.futures import ThreadPoolExecutor


def percentile(values: list[float], ratio: float) -> float:
    ordered = sorted(values)
    if not ordered:
        return 0.0
    index = min(math.ceil(len(ordered) * ratio) - 1, len(ordered) - 1)
    return ordered[max(index, 0)]


def connect(path: Path) -> sqlite3.Connection:
    conn = sqlite3.connect(path)
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA synchronous=NORMAL")
    conn.execute("PRAGMA temp_store=MEMORY")
    conn.execute("PRAGMA busy_timeout=5000")
    return conn


def create_schema(conn: sqlite3.Connection) -> None:
    conn.executescript(
        """
        CREATE TABLE cage_slots (
            id TEXT PRIMARY KEY, rack_id TEXT, row_no INTEGER, col_no INTEGER,
            code TEXT, status TEXT, payload TEXT NOT NULL
        );
        CREATE TABLE quantity_sheets (
            id TEXT PRIMARY KEY, month TEXT NOT NULL, iacuc TEXT NOT NULL,
            room_id TEXT, room_name TEXT, manager TEXT, project TEXT, pi TEXT,
            owner TEXT, funding TEXT, updated_at TEXT NOT NULL, payload TEXT NOT NULL
        );
        CREATE TABLE intake_batches (
            id TEXT PRIMARY KEY, batch_no TEXT NOT NULL, iacuc TEXT, supplier TEXT,
            pi TEXT, owner TEXT, quantity INTEGER, card_count INTEGER, room_name TEXT,
            intake_date TEXT, status TEXT NOT NULL, updated_at TEXT NOT NULL, payload TEXT NOT NULL
        );
        CREATE INDEX idx_quantity_sheets_month_updated ON quantity_sheets(month DESC, updated_at DESC);
        CREATE INDEX idx_quantity_sheets_iacuc_month ON quantity_sheets(iacuc, month DESC);
        CREATE INDEX idx_quantity_sheets_pi_month ON quantity_sheets(pi, month DESC);
        CREATE INDEX idx_quantity_sheets_room_month ON quantity_sheets(room_name, month DESC);
        CREATE INDEX idx_intake_batches_status_date ON intake_batches(status, intake_date DESC);
        CREATE INDEX idx_intake_batches_pi_date ON intake_batches(pi, intake_date DESC);
        CREATE INDEX idx_intake_batches_owner_date ON intake_batches(owner, intake_date DESC);
        CREATE INDEX idx_intake_batches_room_date ON intake_batches(room_name, intake_date DESC);
        CREATE INDEX idx_intake_batches_updated ON intake_batches(updated_at DESC);
        """
    )


def populate(conn: sqlite3.Connection, slots: int, records: int) -> None:
    conn.executemany(
        "INSERT INTO cage_slots VALUES (?, ?, ?, ?, ?, ?, ?)",
        (
            (
                f"slot-{index:05d}",
                f"rack-{index // 100:03d}",
                index % 10 + 1,
                index % 20 + 1,
                f"S{index:05d}",
                "active" if index % 3 else "empty",
                "{}",
            )
            for index in range(slots)
        ),
    )
    quantity_count = records // 2
    intake_count = records - quantity_count
    conn.executemany(
        """
        INSERT INTO quantity_sheets
        (id, month, iacuc, room_id, room_name, manager, project, pi, owner, funding, updated_at, payload)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            (
                f"sheet-{index:06d}",
                f"2026-{index % 12 + 1:02d}",
                f"IACUC-2026-{index % 4000:04d}",
                f"room-{index % 50:02d}",
                f"饲养间 {index % 50:02d}",
                f"管理员 {index % 20:02d}",
                f"项目 {index % 4000:04d}",
                f"负责人 {index % 500:03d}",
                f"实验员 {index % 1200:04d}",
                f"经费-{index % 300:03d}",
                f"2026-{index % 12 + 1:02d}-{index % 28 + 1:02d}T12:{index % 60:02d}:00",
                '{"billingUnit":"cage_day"}',
            )
            for index in range(quantity_count)
        ),
    )
    conn.executemany(
        """
        INSERT INTO intake_batches
        (id, batch_no, iacuc, supplier, pi, owner, quantity, card_count, room_name, intake_date, status, updated_at, payload)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            (
                f"batch-{index:06d}",
                f"BATCH-2026-{index:06d}",
                f"IACUC-2026-{index % 4000:04d}",
                f"供应商 {index % 40:02d}",
                f"负责人 {index % 500:03d}",
                f"实验员 {index % 1200:04d}",
                index % 24 + 1,
                index % 24 + 1,
                f"饲养间 {index % 50:02d}",
                f"2026-{index % 12 + 1:02d}-{index % 28 + 1:02d}",
                ("received", "printed", "draft")[index % 3],
                f"2026-{index % 12 + 1:02d}-{index % 28 + 1:02d}T12:{index % 60:02d}:00",
                json.dumps({"confirmedCardCount": index % 24 + 1}, ensure_ascii=False),
            )
            for index in range(intake_count)
        ),
    )
    conn.commit()
    conn.execute("ANALYZE")


QUERIES = {
    "quantity_default": ("SELECT id FROM quantity_sheets ORDER BY month DESC, updated_at DESC LIMIT 20", ()),
    "quantity_pi": ("SELECT id FROM quantity_sheets WHERE pi = ? ORDER BY month DESC LIMIT 20", ("负责人 042",)),
    "quantity_deep_page": ("SELECT id FROM quantity_sheets ORDER BY month DESC, updated_at DESC LIMIT 20 OFFSET 10000", ()),
    "quantity_filter_options": ("SELECT pi, COUNT(*) FROM quantity_sheets GROUP BY pi ORDER BY pi LIMIT 500", ()),
    "intake_status": ("SELECT id FROM intake_batches WHERE status = ? ORDER BY intake_date DESC LIMIT 20", ("received",)),
    "intake_pi": ("SELECT id FROM intake_batches WHERE pi = ? ORDER BY intake_date DESC LIMIT 20", ("负责人 042",)),
    "intake_owner": ("SELECT id FROM intake_batches WHERE owner = ? ORDER BY intake_date DESC LIMIT 20", ("实验员 0042",)),
}


def run_query(path: Path, sql: str, params: tuple[object, ...]) -> float:
    conn = connect(path)
    started = time.perf_counter()
    conn.execute(sql, params).fetchall()
    elapsed = (time.perf_counter() - started) * 1000
    conn.close()
    return elapsed


def benchmark(path: Path, iterations: int) -> dict[str, dict[str, float]]:
    results: dict[str, dict[str, float]] = {}
    for name, (sql, params) in QUERIES.items():
        samples = [run_query(path, sql, params) for _ in range(iterations)]
        results[name] = {
            "p50_ms": round(statistics.median(samples), 2),
            "p95_ms": round(percentile(samples, 0.95), 2),
            "max_ms": round(max(samples), 2),
        }
    sql, params = QUERIES["intake_status"]
    with ThreadPoolExecutor(max_workers=20) as pool:
        samples = list(pool.map(lambda _: run_query(path, sql, params), range(max(iterations, 20))))
    results["intake_status_20_concurrent"] = {
        "p50_ms": round(statistics.median(samples), 2),
        "p95_ms": round(percentile(samples, 0.95), 2),
        "max_ms": round(max(samples), 2),
    }
    return results


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--slots", type=int, default=10_000)
    parser.add_argument("--records", type=int, default=100_000)
    parser.add_argument("--iterations", type=int, default=40)
    parser.add_argument("--keep", action="store_true")
    args = parser.parse_args()

    temp_dir = Path(tempfile.mkdtemp(prefix="cageledger-benchmark-"))
    db_path = temp_dir / "benchmark.sqlite"
    started = time.perf_counter()
    conn = connect(db_path)
    create_schema(conn)
    populate(conn, args.slots, args.records)
    conn.close()
    results = benchmark(db_path, args.iterations)
    payload = {
        "database": str(db_path) if args.keep else "temporary",
        "slots": args.slots,
        "records": args.records,
        "build_seconds": round(time.perf_counter() - started, 2),
        "queries": results,
    }
    print(json.dumps(payload, ensure_ascii=False, indent=2))
    if not args.keep:
        for suffix in ("", "-wal", "-shm"):
            try:
                os.remove(f"{db_path}{suffix}")
            except FileNotFoundError:
                pass
        temp_dir.rmdir()


if __name__ == "__main__":
    main()
