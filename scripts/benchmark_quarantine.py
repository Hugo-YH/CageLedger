"""Compare actual quarantine pool queries on disposable, deterministic data."""

import json
import sqlite3
import statistics
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from server_app.domains.quarantine import repository as repo  # noqa: E402


def main():
    conn = sqlite3.connect(":memory:")
    conn.row_factory = sqlite3.Row
    repo.ensure_schema(conn)
    conn.execute("CREATE TABLE intake_batches(id TEXT PRIMARY KEY, intake_date TEXT, payload TEXT)")
    count = 2000
    for index in range(count):
        item = {"id": str(index), "intakeDate": "2026-09-09", "status": "received"}
        conn.execute("INSERT INTO intake_batches VALUES(?,?,?)", (item["id"], item["intakeDate"], json.dumps(item)))
    for index in range(300):
        repo.save(
            conn,
            "batches",
            {
                "id": f"batch-{index}",
                "name": str(index),
                "updatedAt": "2026-09-09",
                "sources": [{"intakeId": str(index * 4 + n)} for n in range(4)] + [{"notes": "哨兵鼠"}],
            },
            create=True,
        )
    times, statements = [], []
    conn.set_trace_callback(statements.append)
    for _ in range(5):
        start = time.perf_counter()
        page = repo.list_page(conn, "sources", {"state": "pending"})
        times.append((time.perf_counter() - start) * 1000)
        assert page["page"]["total"] == 800
        assert all(int(item["id"]) >= 1200 for item in page["items"])
    sql = next(sql for sql in statements if sql.startswith("SELECT COUNT"))
    plan = [row[3] for row in conn.execute("EXPLAIN QUERY PLAN " + sql)]
    print(
        json.dumps(
            {
                "intakes": count,
                "batches": 300,
                "sources": 1500,
                "p50_ms": round(statistics.median(times), 2),
                "max_ms": round(max(times), 2),
                "query_plan": plan,
            },
            ensure_ascii=False,
            indent=2,
        )
    )
    conn.close()


if __name__ == "__main__":
    main()
