import sqlite3
import unittest
from contextlib import closing

import server


class PerformanceIndexTests(unittest.TestCase):
    def test_quantity_sheet_indexes_are_created_idempotently(self):
        with closing(sqlite3.connect(":memory:")) as conn:
            conn.row_factory = sqlite3.Row
            server.initialize_schema(conn)
            server.initialize_schema(conn)
            indexes = {
                row[0]
                for row in conn.execute(
                    "SELECT name FROM sqlite_master WHERE type = 'index' AND name IN (?, ?, ?, ?)",
                    (
                        "idx_quantity_sheets_month_room",
                        "idx_quantity_sheets_month_iacuc_updated",
                        "idx_reimbursement_records_month_latest",
                        "idx_reimbursement_records_status_month_latest",
                    ),
                )
            }

        self.assertEqual(
            indexes,
            {
                "idx_quantity_sheets_month_room",
                "idx_quantity_sheets_month_iacuc_updated",
                "idx_reimbursement_records_month_latest",
                "idx_reimbursement_records_status_month_latest",
            },
        )


if __name__ == "__main__":
    unittest.main()
