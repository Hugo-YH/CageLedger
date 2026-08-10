import sqlite3
import unittest

import server


class PerformanceIndexTests(unittest.TestCase):
    def test_dashboard_quantity_sheet_index_is_created_idempotently(self):
        with sqlite3.connect(":memory:") as conn:
            conn.row_factory = sqlite3.Row
            server.initialize_schema(conn)
            server.initialize_schema(conn)
            index = conn.execute(
                "SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'idx_quantity_sheets_month_room'"
            ).fetchone()

        self.assertEqual(index[0], "idx_quantity_sheets_month_room")


if __name__ == "__main__":
    unittest.main()
