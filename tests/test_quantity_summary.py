import json
import sqlite3
import unittest
from unittest.mock import patch

from server_app.cache import invalidate_data_cache_prefixes
from server_app.web import read_quantity_actions


class QuantitySummaryTests(unittest.TestCase):
    def setUp(self):
        self.conn = sqlite3.connect(":memory:")
        self.conn.row_factory = sqlite3.Row
        self.conn.execute("""CREATE TABLE quantity_sheets (
            id TEXT, month TEXT, iacuc TEXT, room_id TEXT, room_name TEXT, manager TEXT,
            project TEXT, pi TEXT, owner TEXT, funding TEXT, updated_at TEXT, payload TEXT)""")
        payload = {
            "contact": "联系人",
            "roomManager": "管理员",
            "billingUnit": "cage_day",
            "rows": [{"secret": "large detail"}],
        }
        self.conn.execute(
            "INSERT INTO quantity_sheets VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
            (
                "sheet",
                "2026-10",
                "Z1",
                "room",
                "8014",
                "登记人",
                "项目",
                "负责人",
                "实验人",
                "经费",
                "v1",
                json.dumps(payload),
            ),
        )
        invalidate_data_cache_prefixes("quantity_sheets")

    def tearDown(self):
        self.conn.close()
        invalidate_data_cache_prefixes("quantity_sheets")

    def test_summary_and_unqualified_legacy_projection_are_identical(self):
        class Handler(read_quantity_actions.ReadQuantityActionsMixin):
            path = "/api/quantity-sheets?limit=10&offset=0"
            response = None

            def require_user(self):
                return {"id": "admin"}

            def list_filters(self):
                return {"limit": 10, "offset": 0}

            def send_json(self, payload, status=200):
                self.response = (payload, status)

        handler = Handler()
        with patch.object(read_quantity_actions, "connect_db", return_value=self.conn):
            handler.get_quantity_sheets("/api/quantity-sheets")
            legacy = handler.response
            handler.path += "&view=summary"
            handler.get_quantity_sheets("/api/quantity-sheets")
            summary = handler.response
        self.assertEqual(summary, legacy)
        self.assertEqual(summary[0]["items"][0]["updatedAt"], "v1")
        self.assertNotIn("rows", summary[0]["items"][0])
