import sqlite3
import unittest
from unittest.mock import patch

import server
from server_app.domains import dashboard_overview


class DashboardOverviewCacheTests(unittest.TestCase):
    def setUp(self):
        self.conn = sqlite3.connect(":memory:")
        self.conn.row_factory = sqlite3.Row
        server.initialize_schema(self.conn)
        dashboard_overview.invalidate_dashboard_overview_cache()

    def tearDown(self):
        dashboard_overview.invalidate_dashboard_overview_cache()
        self.conn.close()

    def test_reuses_dashboard_payload_until_an_explicit_invalidation(self):
        with patch(
            "server_app.domains.dashboard_overview._intake_overview", wraps=dashboard_overview._intake_overview
        ) as intake:
            first = dashboard_overview.dashboard_overview_payload(self.conn, "2026-07", rooms=[])
            second = dashboard_overview.dashboard_overview_payload(self.conn, "2026-07", rooms=[])
            dashboard_overview.invalidate_dashboard_overview_cache()
            third = dashboard_overview.dashboard_overview_payload(self.conn, "2026-07", rooms=[])

        self.assertEqual(first, second)
        self.assertEqual(second, third)
        self.assertEqual(intake.call_count, 2)

    def test_dashboard_cache_uses_a_one_minute_ttl(self):
        with patch(
            "server_app.domains.dashboard_overview.cache_set", side_effect=lambda _key, value, **_kwargs: value
        ) as cache_set:
            dashboard_overview.dashboard_overview_payload(self.conn, "2026-07", rooms=[])

        self.assertEqual(cache_set.call_args.kwargs["ttl_seconds"], 60)
        self.assertEqual(dashboard_overview.DASHBOARD_CACHE_TTL_SECONDS, 60)


if __name__ == "__main__":
    unittest.main()
