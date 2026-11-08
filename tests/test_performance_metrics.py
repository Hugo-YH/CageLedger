import sqlite3
import unittest
from contextlib import closing

from server_app.db import ObservedConnection
from server_app.performance import (
    performance_snapshot,
    record_cache,
    record_database_operation,
    record_request,
    record_stage,
    request_observability,
    reset_performance_metrics,
)
from server_app.repositories.application_context import applications_for_iacucs


class PerformanceMetricsTests(unittest.TestCase):
    def setUp(self):
        reset_performance_metrics()

    def tearDown(self):
        reset_performance_metrics()

    def test_snapshot_reports_latency_percentiles_and_cache_hit_rate(self):
        for elapsed_ms in (10, 20, 30, 40, 500):
            record_request(elapsed_ms, slow=elapsed_ms >= 500)
        record_cache("hit")
        record_cache("hit")
        record_cache("miss")
        record_cache("expired")
        record_cache("eviction")
        record_database_operation(5)
        record_database_operation(150, slow=True, locked=True)

        snapshot = performance_snapshot(cache_entries=3, cache_capacity=512)

        self.assertEqual(snapshot["requests"]["total"], 5)
        self.assertEqual(snapshot["requests"]["slow"], 1)
        self.assertEqual(snapshot["requests"]["p50Ms"], 30.0)
        self.assertEqual(snapshot["requests"]["p95Ms"], 500.0)
        self.assertEqual(snapshot["requests"]["breakdown"][0]["route"], "/")
        self.assertEqual(snapshot["cache"]["hitRate"], 0.5)
        self.assertEqual(snapshot["cache"]["evictions"], 1)
        self.assertEqual(snapshot["database"]["slowOperations"], 1)
        self.assertEqual(snapshot["database"]["lockErrors"], 1)

    def test_request_breakdown_aggregates_without_sensitive_path_values(self):
        record_request(
            700,
            slow=True,
            application_ms=120,
            category="api",
            route="/api/quantity-sheets",
            response_bytes=2048,
            status=200,
        )
        record_request(
            20,
            application_ms=15,
            category="download",
            route="下载",
            response_bytes=4096,
            status=200,
        )

        breakdown = performance_snapshot()["requests"]["breakdown"]
        api = next(item for item in breakdown if item["route"] == "/api/quantity-sheets")
        self.assertEqual(api["slow"], 1)
        self.assertEqual(api["applicationP95Ms"], 120.0)
        self.assertEqual(api["responseBytes"], 2048)
        self.assertEqual(request_observability("/api/users/alice@example.test"), ("api", "/api/users"))
        self.assertEqual(request_observability("/api/public/cage-card/private-qr"), ("api", "/api/public/cage-card"))
        self.assertEqual(request_observability("/assets/index-secret.js"), ("static", "/assets"))

    def test_stages_are_bounded_and_do_not_accept_business_keys(self):
        for _ in range(600):
            record_stage("payload.decode", 2, rows=3, size_bytes=4)
        record_stage("patient@example.invalid", 9000)
        stages = performance_snapshot()["stages"]
        self.assertEqual(list(stages), ["payload.decode"])
        self.assertEqual(
            stages["payload.decode"],
            {
                "operations": 600,
                "rows": 1800,
                "bytes": 2400,
                "sampleCount": 512,
                "p50Ms": 2.0,
                "p95Ms": 2.0,
                "maxMs": 2.0,
            },
        )

    def test_fetchall_iteration_and_explicit_cursor_report_rows_separately(self):
        with closing(sqlite3.connect(":memory:", factory=ObservedConnection)) as conn:
            conn.execute("CREATE TABLE sample(id INTEGER)")
            conn.executemany("INSERT INTO sample VALUES (?)", [(i,) for i in range(300)])
            conn.commit()
            reset_performance_metrics()
            self.assertEqual(len(conn.execute("SELECT id FROM sample").fetchall()), 300)
            self.assertEqual(len(list(conn.execute("SELECT id FROM sample"))), 300)
            cursor = conn.cursor()
            cursor.execute("SELECT id FROM sample")
            self.assertEqual(len(cursor.fetchmany(size=5)), 5)
            self.assertEqual(cursor.fetchone(), (5,))
            cursor.close()
            snapshot = performance_snapshot()
        self.assertEqual(snapshot["database"]["operations"], 3)
        self.assertEqual(snapshot["stages"]["database.fetch"]["rows"], 606)

    def test_target_projection_flushes_fetch_tail_when_it_stops_before_exhaustion(self):
        with closing(sqlite3.connect(":memory:", factory=ObservedConnection)) as conn:
            conn.execute("CREATE TABLE experiment_applications(payload TEXT)")
            conn.executemany(
                "INSERT INTO experiment_applications VALUES (?)", [('{"iacuc":"Z1"}',), ('{"iacuc":"Z2"}',)]
            )
            reset_performance_metrics()
            self.assertEqual(applications_for_iacucs(conn, ["Z1"]), {"Z1": {"iacuc": "Z1"}})
            self.assertEqual(performance_snapshot()["stages"]["database.fetch"]["rows"], 2)


if __name__ == "__main__":
    unittest.main()
