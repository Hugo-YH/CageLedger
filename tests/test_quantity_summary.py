import json
import sqlite3
import unittest
from unittest.mock import patch

from server_app.cache import invalidate_data_cache_prefixes
from server_app.domains.quantity.facade import list_quantity_sheets_page
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

    def test_ids_projection_has_same_filter_order_and_pagination_without_decoding_payload(self):
        self.conn.commit()
        for number, pi in enumerate(("乙/甲", "丙", "甲", "乙/甲")):
            self.conn.execute(
                "INSERT INTO quantity_sheets SELECT ?,month,iacuc,room_id,room_name,manager,project,?,owner,"
                "funding,?,payload FROM quantity_sheets WHERE id='sheet'",
                (f"extra-{number}", pi, f"v{number + 2}"),
            )
        self.conn.commit()
        filters = {
            "limit": 2,
            "offset": 1,
            "sortKey": "updatedAt",
            "sortDir": "desc",
            "columnFilters": {"pi": ["甲"]},
            "personFilterMode": "individual",
        }
        summary = list_quantity_sheets_page(self.conn, filters)
        ids = list_quantity_sheets_page(self.conn, filters, ids_only=True)
        self.assertEqual(ids, {"items": [{"id": row["id"]} for row in summary["items"]], "page": summary["page"]})
        self.assertEqual(ids["page"]["total"], 3)
        # This request must not parse row JSON, even if detail contains legacy invalid bytes.
        self.conn.execute("UPDATE quantity_sheets SET payload='not json'")
        self.conn.commit()
        invalidate_data_cache_prefixes("quantity_sheets")
        self.assertEqual(list_quantity_sheets_page(self.conn, filters, ids_only=True), ids)

    def test_ids_http_view_retains_login_guard_and_rejects_unknown_view(self):
        class Handler(read_quantity_actions.ReadQuantityActionsMixin):
            path = "/api/quantity-sheets?view=ids"
            authenticated = True
            response = None

            def require_user(self):
                return {"id": "manager", "role": "manager"} if self.authenticated else None

            def list_filters(self):
                return {"limit": 1, "offset": 0}

            def send_json(self, payload, status=200):
                self.response = (payload, status)

        handler = Handler()
        with patch.object(read_quantity_actions, "connect_db", return_value=self.conn) as connect:
            handler.authenticated = False
            handler.get_quantity_sheets("/api/quantity-sheets")
            connect.assert_not_called()
            handler.authenticated = True
            handler.get_quantity_sheets("/api/quantity-sheets")
            self.assertEqual(handler.response[0]["items"], [{"id": "sheet"}])
            handler.path = "/api/quantity-sheets?view=bad"
            handler.get_quantity_sheets("/api/quantity-sheets")
            self.assertEqual(handler.response[1], 400)
