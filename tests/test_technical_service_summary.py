import sqlite3
import unittest
from unittest.mock import patch

from server_app.domains.technical_services import repository as repo
from server_app.persistence.bootstrap import initialize_schema


class TechnicalServiceSummaryTests(unittest.TestCase):
    def setUp(self):
        self.conn = sqlite3.connect(":memory:")
        self.conn.row_factory = sqlite3.Row
        with patch("server_app.persistence.bootstrap.ensure_seed_images"):
            initialize_schema(self.conn)
        self.item = {
            "id": "sheet-1",
            "month": "2026-10",
            "iacuc": "Z1",
            "pi": "负责人",
            "facility": "zhujiang",
            "serviceId": "service-1",
            "serviceName": "技术服务",
            "customerType": "internal",
            "unit": "次",
            "unitPrice": 12,
            "totalAmount": 24,
            "totalQuantity": 2,
            "serviceDayCount": 1,
            "project": "项目",
            "owner": "实验负责人",
            "funding": "经费",
            "manager": "管理员",
            "notes": "备注",
            "updatedAt": "2026-10-01",
            "priceSnapshot": {"id": "service-1", "version": "v1"},
            "rows": [{"date": "2026-10-01", "quantity": 2, "amount": 24}],
        }
        repo.put(self.conn, self.item, "signature", "admin")

    def tearDown(self):
        self.conn.close()

    def test_summary_matches_legacy_fields_without_large_detail_and_preserves_order(self):
        with patch.object(repo, "protected_ids", return_value={"sheet-1"}):
            legacy = repo.list_sheets(self.conn, {"limit": 10})
            with patch.object(repo.json, "loads", side_effect=AssertionError("summary should not decode payload")):
                summary = repo.list_sheets(self.conn, {"limit": 10, "view": "summary"})
        self.assertEqual(summary["page"], legacy["page"])
        self.assertEqual(summary["items"][0], {key: legacy["items"][0][key] for key in summary["items"][0]})
        self.assertTrue(summary["items"][0]["protected"])
        self.assertNotIn("rows", summary["items"][0])
        self.assertNotIn("priceSnapshot", summary["items"][0])
        self.assertEqual(legacy["items"][0]["priceSnapshot"], self.item["priceSnapshot"])

    def test_summary_keeps_filters_pagination_and_original_version(self):
        summary = repo.list_sheets(self.conn, {"view": "summary", "columnFilters": {"facility": ["zhujiang"]}})
        self.assertEqual(summary["page"]["total"], 1)
        self.assertEqual(summary["items"][0]["updatedAt"], self.item["updatedAt"])
        self.assertEqual(repo.list_sheets(self.conn, {"view": "summary", "offset": 1})["items"], [])


if __name__ == "__main__":
    unittest.main()
