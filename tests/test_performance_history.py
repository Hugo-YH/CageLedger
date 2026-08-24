import unittest

from server_app.domains.administration.performance_history import _counter_interval, _history_item


class PerformanceHistoryTests(unittest.TestCase):
    def test_counter_interval_uses_increment_since_previous_sample(self):
        current = {"requests": {"total": 17, "slow": 3}}
        previous = {"requests": {"total": 11, "slow": 1}}
        self.assertEqual(
            _counter_interval(current["requests"], previous, "requests", "total", "slow"), {"total": 6, "slow": 2}
        )

    def test_counter_interval_never_records_a_negative_value_after_restart(self):
        current = {"requests": {"total": 2}}
        previous = {"requests": {"total": 11}}
        self.assertEqual(_counter_interval(current["requests"], previous, "requests", "total"), {"total": 0})

    def test_history_item_does_not_expose_internal_payload(self):
        item = _history_item(
            {
                "observedAt": "2026-08-24T01:00:00+00:00",
                "intervalSeconds": 300,
                "appVersion": "1.0.21",
                "processStartedAt": "2026-08-24T00:00:00+00:00",
                "metrics": {
                    "requests": {"total": 9, "slow": 1},
                    "database": {"operations": 30, "lockErrors": 0},
                    "requestP95Ms": 120.0,
                    "databaseP95Ms": 20.0,
                    "cacheHitRate": 0.9,
                    "pdf": {"activeJobs": 0},
                    "databaseSizeBytes": 1024,
                },
            }
        )
        self.assertEqual(item["requestCount"], 9)
        self.assertNotIn("metrics", item)
