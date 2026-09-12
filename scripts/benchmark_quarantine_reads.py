"""Compare quarantine read paths with a Git baseline using disposable SQLite data."""

import argparse
import hashlib
import json
import sqlite3
import statistics
import subprocess
import sys
import time
import types
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from server_app.domains.quarantine import history, service  # noqa: E402
from server_app.domains.quarantine import repository as repo  # noqa: E402


def seed_batch(conn, batch_id, supplier, *, samples=20, projects=20):
    sources = [
        {
            "id": f"source-{index}",
            "supplier": supplier,
            "species": "小鼠",
            "intakeDate": "2026-09-01",
            "intakeId": f"intake-{batch_id}-{index}",
        }
        for index in range(samples)
    ]
    batch = {
        "id": batch_id,
        "name": batch_id,
        "sources": sources,
        "conclusion": "",
        "handling": "",
        "updatedAt": "2026-09-01",
    }
    repo.save(conn, "batches", batch, create=True)
    sample_ids = [f"sample-{index}" for index in range(samples)]
    for method in ("parasite", "pcr", "elisa_mouse"):
        test = {
            "id": f"{batch_id}-{method}",
            "batchId": batch_id,
            "method": method,
            "testDate": "2026-09-03",
            "state": "issued",
            "updatedAt": "2026-09-03",
            "samples": [
                {"id": sid, "sourceIds": [sources[index]["id"]], "poolCount": 1, "portionCount": 1}
                for index, sid in enumerate(sample_ids)
            ],
            "projects": [
                {"id": f"project-{index}", "sampleIds": sample_ids, "results": dict.fromkeys(sample_ids, "negative")}
                for index in range(projects)
            ],
        }
        repo.save(conn, "tests", test, create=True)


def seed_history(conn, batches=600):
    for index in range(batches):
        seed_batch(conn, f"history-{index:04d}", f"供应商-{index % 60:02d}")


def load_baseline(ref, name):
    path = f"server_app/domains/quarantine/{name}.py"
    source = subprocess.check_output(["git", "show", f"{ref}:{path}"], cwd=ROOT, text=True)
    module = types.ModuleType(f"server_app.domains.quarantine._benchmark_before_{name}")
    module.__package__ = "server_app.domains.quarantine"
    exec(compile(source, f"{ref}:{path}", "exec"), module.__dict__)
    return module


def measure(conn, before, after, repeats):
    expected = before()
    assert after() == expected, "Baseline and current response differ"
    measurements = {"before": [], "after": []}
    counts = {}
    plans = {}
    for label, operation in (("before", before), ("after", after)):
        statements = []
        conn.set_trace_callback(statements.append)
        operation()
        conn.set_trace_callback(None)
        counts[label] = len(statements)
        test_query = next((sql for sql in statements if "FROM quarantine_tests" in sql), None)
        plans[label] = [row[3] for row in conn.execute("EXPLAIN QUERY PLAN " + test_query)] if test_query else []
    for index in range(repeats):
        operations = (("before", before), ("after", after))
        for label, operation in operations if index % 2 == 0 else reversed(operations):
            start = time.perf_counter()
            result = operation()
            measurements[label].append((time.perf_counter() - start) * 1000)
            assert result == expected, "Repeated response differs"
    return {
        "equivalent": True,
        "response_sha256": hashlib.sha256(json.dumps(expected, sort_keys=True).encode()).hexdigest(),
        **{
            label: {
                "p50_ms": round(statistics.median(values), 2),
                "max_ms": round(max(values), 2),
                "queries": counts[label],
                "test_query_plan": plans[label],
            }
            for label, values in measurements.items()
        },
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--baseline-ref", default="HEAD")
    parser.add_argument("--repeats", type=int, default=5)
    args = parser.parse_args()
    if args.repeats < 1:
        parser.error("--repeats must be positive")
    old_service = load_baseline(args.baseline_ref, "service")
    old_history = load_baseline(args.baseline_ref, "history")
    with sqlite3.connect(":memory:") as conn:
        conn.row_factory = sqlite3.Row
        repo.ensure_schema(conn)
        seed_history(conn)
        seed_batch(conn, "large-detail", "供应商-详情", samples=200, projects=100)
        conn.commit()
        history_cases = {
            "history_supplier": {"supplier": "供应商-03"},
            "history_date_empty": {"dateFrom": "2026-09-02"},
            "history_all": {},
        }
        results = {
            "baseline_ref": args.baseline_ref,
            "baseline_commit": subprocess.check_output(
                ["git", "rev-parse", args.baseline_ref], cwd=ROOT, text=True
            ).strip(),
            "repeats": args.repeats,
            "data": {
                "history_batches": 600,
                "history_tests": 1800,
                "history_suppliers": 60,
                "samples_per_history_test": 20,
                "projects_per_history_test": 20,
                "detail_tests": 3,
                "samples_per_detail_test": 200,
                "projects_per_detail_test": 100,
            },
            "detail": measure(
                conn,
                lambda: old_service.batch_detail(conn, "large-detail"),
                lambda: service.batch_detail(conn, "large-detail"),
                args.repeats,
            ),
        }
        for label, filters in history_cases.items():
            results[label] = measure(
                conn,
                lambda filters=filters: old_history.supplier_history(conn, filters),
                lambda filters=filters: history.supplier_history(conn, filters),
                args.repeats,
            )
        print(json.dumps(results, indent=2, ensure_ascii=False))


if __name__ == "__main__":
    main()
