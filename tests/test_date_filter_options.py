import json
import sqlite3
import unittest
from datetime import date, datetime, timedelta

from server_app.domains.reimbursement_ledger.listing import LEGACY_LIST_COLUMNS, list_column_options, list_column_where
from server_app.repositories.billing_candidate_queries import list_billing_candidate_scalar_filter_options
from server_app.repositories.billing_workflow_queries import list_billing_workflow_filter_options
from server_app.repositories.entities import intake_batch_where, list_intake_batch_filter_options
from server_app.repositories.filter_options import filtered_where
from server_app.repositories.quantity_sheets import list_quantity_sheet_filter_options, quantity_sheet_where


class DateFilterOptionsTests(unittest.TestCase):
    def setUp(self):
        self.conn = sqlite3.connect(":memory:")
        self.conn.row_factory = sqlite3.Row

    def tearDown(self):
        self.conn.close()

    def test_intake_dates_are_not_limited_and_blank_combines_with_a_date(self):
        self.conn.execute("CREATE TABLE intake_batches (intake_date TEXT, supplier TEXT)")
        start = date(2024, 1, 1)
        dates = [(start + timedelta(days=index)).isoformat() for index in range(503)]
        self.conn.executemany(
            "INSERT INTO intake_batches VALUES (?, ?)",
            [(value, "same") for value in dates] + [("", "same")],
        )
        options = list_intake_batch_filter_options(self.conn, {"columnFilters": {}}, filtered_where, "intakeDate")[
            "items"
        ]
        self.assertEqual(len(options), 504)
        where, params = intake_batch_where({"columnFilters": {"intakeDate": ["", dates[1]]}}, filtered_where)
        self.assertEqual(
            self.conn.execute(f"SELECT COUNT(*) FROM intake_batches WHERE {where}", params).fetchone()[0], 2
        )

    def test_quantity_date_options_are_complete_but_text_options_remain_bounded(self):
        self.conn.execute(
            "CREATE TABLE quantity_sheets (month TEXT, iacuc TEXT, room_name TEXT, manager TEXT, pi TEXT, updated_at TEXT)"
        )
        start = datetime(2026, 1, 1)
        timestamps = [(start + timedelta(seconds=index)).isoformat(timespec="seconds") for index in range(503)]
        self.conn.executemany(
            "INSERT INTO quantity_sheets VALUES (?, ?, '', '', '', ?)",
            [
                (f"{2000 + index // 12:04d}-{index % 12 + 1:02d}", f"Z{index:03d}", timestamps[index])
                for index in range(503)
            ]
            + [("", "blank", "")],
        )
        filters = {"columnFilters": {}}
        self.assertEqual(
            len(list_quantity_sheet_filter_options(self.conn, filters, filtered_where, "month")["items"]), 504
        )
        self.assertEqual(
            len(list_quantity_sheet_filter_options(self.conn, filters, filtered_where, "updatedAt")["items"]), 504
        )
        self.assertEqual(
            len(list_quantity_sheet_filter_options(self.conn, filters, filtered_where, "iacuc")["items"]), 500
        )
        where, params = quantity_sheet_where({"columnFilters": {"month": ["", "2000-02"]}}, filtered_where)
        self.assertEqual(
            self.conn.execute(f"SELECT COUNT(*) FROM quantity_sheets WHERE {where}", params).fetchone()[0], 2
        )
        where, params = quantity_sheet_where({"columnFilters": {"updatedAt": ["", timestamps[1]]}}, filtered_where)
        self.assertEqual(
            self.conn.execute(f"SELECT COUNT(*) FROM quantity_sheets WHERE {where}", params).fetchone()[0], 2
        )

    def test_billing_and_ledger_month_options_are_not_limited(self):
        self.conn.executescript(
            """
            CREATE TABLE billing_candidate_snapshots (
                source_type TEXT, month TEXT, pi TEXT, iacucs_text TEXT, total_amount REAL, error_message TEXT,
                is_stale INTEGER, updated_at TEXT, source_fingerprint TEXT
            );
            CREATE TABLE billing_workflows (
                id TEXT, source_type TEXT, month TEXT, iacuc TEXT, workflow_status TEXT, payload TEXT
            );
            CREATE TABLE reimbursement_records (payload TEXT);
            """
        )
        months = [f"{2000 + index // 12:04d}-{index % 12 + 1:02d}" for index in range(503)]
        self.conn.executemany(
            "INSERT INTO billing_candidate_snapshots VALUES ('quantity_sheet', ?, ?, '', 1, '', 0, '', '')",
            [(month, f"PI{index}") for index, month in enumerate(months)],
        )
        self.conn.executemany(
            "INSERT INTO billing_workflows VALUES (?, 'quantity_sheet', ?, 'pi::x', 'statement_sent', ?)",
            [(str(index), month, json.dumps({"pi": "x", "manager": "m"})) for index, month in enumerate(months)],
        )
        self.conn.executemany(
            "INSERT INTO reimbursement_records VALUES (?)",
            [(json.dumps({"month": month}),) for month in months] + [(json.dumps({"month": ""}),)],
        )
        filters = {"columnFilters": {}}
        self.assertEqual(
            len(list_billing_candidate_scalar_filter_options(self.conn, "quantity_sheet", filters, "month")), 503
        )
        self.assertEqual(len(list_billing_workflow_filter_options(self.conn, filters, "month")), 503)
        ledger_options = list_column_options(self.conn, "reimbursement_records", LEGACY_LIST_COLUMNS, filters, "month")[
            "items"
        ]
        self.assertEqual(len(ledger_options), 504)
        self.assertIn("", [item["value"] for item in ledger_options])
        where, params = list_column_where({"columnFilters": {"month": ["", months[1]]}}, LEGACY_LIST_COLUMNS)
        self.assertEqual(
            self.conn.execute(
                f"SELECT COUNT(*) FROM reimbursement_records WHERE {' AND '.join(where)}", params
            ).fetchone()[0],
            2,
        )


if __name__ == "__main__":
    unittest.main()
