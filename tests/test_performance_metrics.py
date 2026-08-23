import unittest

from server_app.performance import (
    performance_snapshot,
    record_cache,
    record_database_operation,
    record_request,
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
        self.assertEqual(snapshot["cache"]["hitRate"], 0.5)
        self.assertEqual(snapshot["cache"]["evictions"], 1)
        self.assertEqual(snapshot["database"]["slowOperations"], 1)
        self.assertEqual(snapshot["database"]["lockErrors"], 1)


if __name__ == "__main__":
    unittest.main()
