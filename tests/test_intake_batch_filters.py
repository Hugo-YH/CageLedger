import json
import sqlite3
import unittest
from unittest.mock import patch
from urllib.parse import urlencode

from server_app.repositories.entities import intake_batch_where
from server_app.repositories.filter_options import filtered_where
from server_app.web.handler_support import HandlerSupportMixin


class IntakeBatchFilterTests(unittest.TestCase):
    def test_list_filters_keeps_only_explicit_empty_date_values(self):
        class Handler(HandlerSupportMixin):
            path = "/api/intake-batches?" + urlencode(
                {"columnFilters": json.dumps({"intakeDate": [""], "month": [""], "updatedAt": [""], "supplier": [""]})}
            )

        with patch("server_app.web.handler_support.app_ports") as app_ports:
            app_ports.return_value.bounded_int.side_effect = lambda value, default, *_: int(value) if value else default
            self.assertEqual(
                Handler().list_filters()["columnFilters"],
                {"intakeDate": [""], "month": [""], "updatedAt": [""]},
            )

    def test_intake_date_empty_filter_sql_matches_only_empty_dates_and_composes_with_normal_dates(self):
        conn = sqlite3.connect(":memory:")
        self.addCleanup(conn.close)
        conn.execute("CREATE TABLE intake_batches (id TEXT, intake_date TEXT)")
        conn.executemany(
            "INSERT INTO intake_batches (id, intake_date) VALUES (?, ?)",
            [("pending-date", ""), ("scheduled-date", "2026-10-21"), ("other-date", "2026-10-22")],
        )

        def matched_ids(column_filters):
            where, params = intake_batch_where({"columnFilters": column_filters}, filtered_where)
            where_clause = f" WHERE {where}" if where else ""
            return [row[0] for row in conn.execute(f"SELECT id FROM intake_batches{where_clause} ORDER BY id", params)]

        self.assertEqual(matched_ids({"intakeDate": [""]}), ["pending-date"])
        self.assertEqual(matched_ids({"intakeDate": ["2026-10-21"]}), ["scheduled-date"])
        self.assertEqual(matched_ids({"intakeDate": ["", "2026-10-21"]}), ["pending-date", "scheduled-date"])
        self.assertEqual(matched_ids({}), ["other-date", "pending-date", "scheduled-date"])

    def test_month_filter_uses_an_indexable_date_range(self):
        where, params = intake_batch_where({"month": "2026-07"}, filtered_where)

        self.assertEqual(where, "intake_date >= ? AND intake_date < ?")
        self.assertEqual(params, ("2026-07-01", "2026-08-01"))

    def test_invalid_month_does_not_add_a_date_filter(self):
        where, params = intake_batch_where({"month": "all"}, filtered_where)

        self.assertEqual(where, "")
        self.assertEqual(params, ())


if __name__ == "__main__":
    unittest.main()
