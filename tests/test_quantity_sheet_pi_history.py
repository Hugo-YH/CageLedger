import sqlite3
import unittest

from server_app.repositories.quantity_sheets import find_latest_quantity_sheet_pi


class QuantitySheetPiHistoryTests(unittest.TestCase):
    def setUp(self):
        self.conn = sqlite3.connect(":memory:")
        self.conn.row_factory = sqlite3.Row
        self.conn.execute(
            """
            CREATE TABLE quantity_sheets (
                id TEXT PRIMARY KEY,
                month TEXT NOT NULL,
                iacuc TEXT NOT NULL,
                room_id TEXT,
                room_name TEXT,
                manager TEXT,
                project TEXT,
                pi TEXT,
                owner TEXT,
                funding TEXT,
                updated_at TEXT NOT NULL,
                payload TEXT NOT NULL
            )
            """
        )
        self.conn.commit()

    def tearDown(self):
        self.conn.close()

    def _insert(self, sheet_id, month, iacuc, pi, updated_at):
        self.conn.execute(
            """
            INSERT INTO quantity_sheets
              (id, month, iacuc, room_id, room_name, manager, project, pi, owner, funding, updated_at, payload)
            VALUES (?, ?, ?, NULL, '', '', '', ?, '', '', ?, ?)
            """,
            (sheet_id, month, iacuc, pi, updated_at, f'{{"id": "{sheet_id}", "month": "{month}", "pi": "{pi}"}}'),
        )

    def test_returns_most_recent_prior_month_pi(self):
        self._insert("s-2026-04", "2026-04", "Z2026001", "张三/李四", "2026-04-10T00:00:00+00:00")
        self._insert("s-2026-05", "2026-05", "Z2026001", "张三", "2026-05-10T00:00:00+00:00")
        self._insert("s-2026-06", "2026-06", "Z2026001", "李四", "2026-06-10T00:00:00+00:00")
        result = find_latest_quantity_sheet_pi(self.conn, "Z2026001", "2026-07")
        self.assertEqual(result, {"month": "2026-06", "pi": "李四"})

    def test_skips_current_month_and_later(self):
        self._insert("s-2026-05", "2026-05", "Z2026002", "张三", "2026-05-10T00:00:00+00:00")
        self._insert("s-2026-07", "2026-07", "Z2026002", "王五", "2026-07-10T00:00:00+00:00")
        result = find_latest_quantity_sheet_pi(self.conn, "Z2026002", "2026-07")
        self.assertEqual(result, {"month": "2026-05", "pi": "张三"})

    def test_returns_none_without_prior_data(self):
        self._insert("s-2026-05", "2026-05", "Z2026003", "张三", "2026-05-10T00:00:00+00:00")
        self.assertIsNone(find_latest_quantity_sheet_pi(self.conn, "Z2026003", "2026-04"))
        self.assertIsNone(find_latest_quantity_sheet_pi(self.conn, "OTHER", "2026-07"))


if __name__ == "__main__":
    unittest.main()
