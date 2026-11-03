import json
import sqlite3
import unittest

from server_app.cache import invalidate_data_cache_prefixes
from server_app.repositories.entities import list_intake_batch_filter_options, list_intake_batches_page
from server_app.repositories.filter_options import filtered_where
from server_app.shared.intake_batch_number import parse_intake_batch_number
from server_app.web.entity_contracts import ENTITY_ORDER_BY


class IntakeBatchNumberTests(unittest.TestCase):
    def test_parser_keeps_sequence_and_checks_real_calendar_dates(self):
        for value in (
            "（Z2025137）2026101406",
            "(Z2025137)2026101406",
            "(z2025137）2026101406",
            "（Z2025137)2026101406",
        ):
            self.assertEqual(
                parse_intake_batch_number(value),
                {
                    "status": "parsed",
                    "iacuc": "Z2025137",
                    "approvalDate": "2026-10-14",
                    "sequence": "06",
                },
            )
        self.assertEqual(parse_intake_batch_number("（ZW2025137）202402290006")["sequence"], "0006")
        self.assertEqual(parse_intake_batch_number("（Z2025137）20261014100")["sequence"], "100")
        for value in (
            "（Z2025137）2026022906",
            "（Z2025137）2026043106",
            "（Z2025137）0000101406",
            "（Z2025137）2026130106",
            "（Z2025137）20261014",
            "ABC 123",
            "(Z20251372026101406",
        ):
            with self.subTest(value=value):
                info = parse_intake_batch_number(value)
                self.assertEqual(info["status"], "unparseable")
                self.assertIsNone(info["approvalDate"])
        self.assertEqual(parse_intake_batch_number("")["status"], "missing")

    def setUp(self):
        invalidate_data_cache_prefixes("")
        self.addCleanup(invalidate_data_cache_prefixes, "")
        self.conn = sqlite3.connect(":memory:")
        self.conn.row_factory = sqlite3.Row
        self.addCleanup(self.conn.close)
        self.conn.execute(
            "CREATE TABLE intake_batches (id TEXT PRIMARY KEY, batch_no TEXT, batch_no_key TEXT, iacuc TEXT, room_name TEXT, intake_date TEXT, status TEXT, updated_at TEXT, payload TEXT)"
        )
        numbers = [f"（A2025001）20260101{index:03d}" for index in range(505)] + [
            "（Z2025137）2026101406",
            "(Z2025137）2026101506",
            "（Z2025137）2026022906",
            "legacy ABC%_123",
        ]
        for index, number in enumerate(numbers):
            item = {
                "id": str(index),
                "batchNo": number,
                "iacuc": "OTHER",
                "roomName": "test",
                "intakeDate": "2026-11-03",
                "status": "pending_print",
                "updatedAt": "version-1",
            }
            self.conn.execute(
                "INSERT INTO intake_batches VALUES (?,?,?,?,?,?,?,?,?)",
                (
                    item["id"],
                    number,
                    number.replace("（", "(").replace("）", ")"),
                    "OTHER",
                    "test",
                    "2026-11-03",
                    "pending_print",
                    "version-1",
                    json.dumps(item),
                ),
            )
        self.conn.commit()
        self.before = list(self.conn.iterdump())
        self.conn.execute("PRAGMA query_only=ON")

    def listing(self, filters, offset=0, limit=1, summary=True):
        return list_intake_batches_page(
            self.conn,
            {"columnFilters": filters, "offset": offset, "limit": limit, "view": "summary" if summary else ""},
            filtered_where,
            ENTITY_ORDER_BY,
        )

    def test_filters_search_entire_database_before_pagination_and_preserve_legacy(self):
        options = list_intake_batch_filter_options(self.conn, {}, filtered_where, "batchNo")["items"]
        self.assertEqual(len(options), 500)
        self.assertFalse(any("Z2025137" in item["value"] for item in options))
        filters = {"batchNumberIacuc": ["z2025137"], "batchSequence": ["6"]}
        for summary in (True, False):
            first = self.listing(filters, summary=summary)
            second = self.listing(filters, offset=1, summary=summary)
            self.assertEqual(first["page"]["total"], 2)
            self.assertTrue(first["page"]["hasMore"])
            self.assertFalse(second["page"]["hasMore"])
            self.assertNotEqual(first["items"][0]["id"], second["items"][0]["id"])
            specific = self.listing({**filters, "batchApprovalDate": ["2026-10-14"]}, summary=summary)
            self.assertEqual(specific["items"][0]["id"], "505")
            self.assertEqual(specific["items"][0]["intakeDate"], "2026-11-03")
            self.assertEqual(specific["items"][0]["iacuc"], "OTHER")
        for value in (
            "（Z2025137）2026101406",
            "(Z2025137)2026101406",
            "（z2025137)2026101406",
            "(Z2025137）2026101406",
            "2026101406",
        ):
            self.assertEqual(self.listing({"batchNumberSearch": [value]})["items"][0]["id"], "505")
        invalid = self.listing({"batchNumberSearch": ["2026022906"]})["items"][0]
        self.assertEqual(invalid["batchNumberInfo"]["status"], "unparseable")
        self.assertEqual(self.listing({"batchNumberSearch": ["%_"]})["items"][0]["batchNo"], "legacy ABC%_123")
        self.assertEqual(self.listing({"batchApprovalDate": ["2026-02-29"]})["page"]["total"], 0)
        self.assertEqual(self.listing({"batchSequence": ["not-a-number"]})["page"]["total"], 0)
        self.assertEqual(self.before, list(self.conn.iterdump()))

    def test_original_full_number_filter_remains_exact(self):
        self.assertEqual(self.listing({"batchNo": ["Z2025137"]})["page"]["total"], 0)
        self.assertEqual(self.listing({"batchNo": ["(Z2025137）2026101406"]})["page"]["total"], 1)


if __name__ == "__main__":
    unittest.main()
