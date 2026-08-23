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

    def test_dashboard_cache_uses_a_one_minute_ttl_for_a_month(self):
        with patch(
            "server_app.domains.dashboard_overview.cache_set", side_effect=lambda _key, value, **_kwargs: value
        ) as cache_set:
            dashboard_overview.dashboard_overview_payload(self.conn, "2026-07", rooms=[])

        self.assertEqual(cache_set.call_args.kwargs["ttl_seconds"], 60)
        self.assertEqual(dashboard_overview.DASHBOARD_CACHE_TTL_SECONDS, 60)

    def test_dashboard_history_cache_uses_a_five_minute_ttl(self):
        with patch(
            "server_app.domains.dashboard_overview.cache_set", side_effect=lambda _key, value, **_kwargs: value
        ) as cache_set:
            dashboard_overview.dashboard_overview_payload(self.conn, "all", rooms=[])

        self.assertEqual(cache_set.call_args.kwargs["ttl_seconds"], 300)
        self.assertEqual(dashboard_overview.DASHBOARD_HISTORY_CACHE_TTL_SECONDS, 300)

    def test_available_months_groups_intake_dates_in_sql(self):
        self.conn.execute(
            """
            INSERT INTO intake_batches
            (id, batch_no, status, intake_date, updated_at, payload)
            VALUES ('batch-1', 'B-1', 'received', '2026-07-01', '2026-07-01T00:00:00', '{}')
            """
        )
        self.conn.execute(
            """
            INSERT INTO intake_batches
            (id, batch_no, status, intake_date, updated_at, payload)
            VALUES ('batch-2', 'B-2', 'received', '2026-07-31', '2026-07-31T00:00:00', '{}')
            """
        )
        self.conn.commit()

        self.assertEqual(dashboard_overview._available_months(self.conn), ["2026-07"])


if __name__ == "__main__":
    unittest.main()
