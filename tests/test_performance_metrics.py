import unittest

from server_app.performance import (
    performance_snapshot,
    record_cache,
    record_database_operation,
    record_request,
    request_observability,
    reset_performance_metrics,
)


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


if __name__ == "__main__":
    unittest.main()
