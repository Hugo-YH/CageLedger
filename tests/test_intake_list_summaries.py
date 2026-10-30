import json
import sqlite3
import unittest

from server_app.cache import invalidate_data_cache_prefixes
from server_app.domains.intake.read_service import print_data, read_batch
from server_app.repositories.entities import list_intake_batches_page
from server_app.repositories.filter_options import filtered_where
from server_app.repositories.intake_summaries import FIELDS
from server_app.shared.concurrency import StaleWriteError
from server_app.web.entity_contracts import ENTITY_ORDER_BY

ACTOR = {"id": "admin", "role": "admin"}


class IntakeSummaryReadTests(unittest.TestCase):
    def setUp(self):
        invalidate_data_cache_prefixes("")
        self.addCleanup(invalidate_data_cache_prefixes, "")
        self.conn = sqlite3.connect(":memory:")
        self.conn.row_factory = sqlite3.Row
        self.addCleanup(self.conn.close)
        self.conn.execute(
            "CREATE TABLE intake_batches (id TEXT PRIMARY KEY, batch_no TEXT, iacuc TEXT, room_name TEXT, intake_date TEXT, status TEXT, updated_at TEXT, payload TEXT)"
        )
        self.items = []
        for index in range(3):
            item = {key: "" for key in FIELDS}
            item.update(
                id=str(index),
                batchNo="B" + str(index),
                iacuc="Z2026001",
                roomName="8101",
                intakeDate="" if index == 0 else "2026-10-29",
                intakePurpose="housing",
                status="pending_print",
                quantity=10,
                finalCardCount=2,
                confirmedCardCount=0,
                remainingCardCount=2,
                updatedAt="v1",
                notes="source notes",
                rawMessage="x" * 20000,
                recognition={"extractedText": "y" * 10000},
                cards=[{"id": "card", "qrId": "ABCD"}],
                receipts=[],
            )
            self.items.append(item)
            self.conn.execute(
                "INSERT INTO intake_batches VALUES (?,?,?,?,?,?,?,?)",
                (
                    item["id"],
                    item["batchNo"],
                    item["iacuc"],
                    item["roomName"],
                    item["intakeDate"],
                    item["status"],
                    item["updatedAt"],
                    json.dumps(item),
                ),
            )
        self.conn.commit()
        self.conn.execute("PRAGMA query_only=ON")

    def listing(self, summary=False, **params):
        return list_intake_batches_page(
            self.conn,
            {"limit": 2, "offset": 0, "view": "summary" if summary else "", **params},
            filtered_where,
            ENTITY_ORDER_BY,
        )

    def test_summary_is_exact_display_projection_and_default_stays_complete(self):
        full = self.listing()
        summary = self.listing(True)
        self.assertEqual(full["page"], summary["page"])
        self.assertEqual(summary["items"], [{key: row.get(key) for key in FIELDS} for row in full["items"]])
        self.assertTrue(
            all("recognition" not in row and "cards" not in row and "rawMessage" not in row for row in summary["items"])
        )
        self.assertTrue(all("recognition" in row and "cards" in row for row in full["items"]))
        self.assertLess(len(json.dumps(summary)), len(json.dumps(full)) // 10)

    def test_sort_filter_empty_date_and_pagination_have_same_semantics(self):
        for params in (
            {"offset": 1, "sortKey": "intakeDate", "sortDir": "asc"},
            {"columnFilters": {"intakeDate": [""]}},
            {"iacuc": "Z2026001"},
        ):
            with self.subTest(params=params):
                full = self.listing(**params)
                summary = self.listing(True, **params)
                self.assertEqual([row["id"] for row in full["items"]], [row["id"] for row in summary["items"]])
                self.assertEqual(full["page"], summary["page"])

    def test_detail_and_batch_print_are_read_only_bounded_and_preserve_order(self):
        before = self.conn.total_changes
        self.assertEqual(read_batch(self.conn, ACTOR, "1"), self.items[1])
        for actor in (ACTOR, {"id": "room-admin", "role": "room_admin", "roomIds": []}):
            self.assertEqual(
                print_data(self.conn, actor, {"ids": ["2", "0"], "expectedVersions": {"2": "v1", "0": "v1"}})["items"],
                [self.items[2], self.items[0]],
            )
        self.assertEqual(self.conn.total_changes, before)
        with self.assertRaises(StaleWriteError):
            print_data(self.conn, ACTOR, {"ids": ["0"], "expectedVersions": {"0": "old"}})
        with self.assertRaises(LookupError):
            print_data(self.conn, ACTOR, {"ids": ["missing"]})
        with self.assertRaises(LookupError):
            read_batch(self.conn, ACTOR, "missing")
        for body in (
            {"ids": ["0", "0"]},
            {"ids": []},
            {"ids": ["a"] * 201},
            {"ids": ["0"], "expectedVersions": {}},
            [],
        ):
            with self.subTest(body=type(body).__name__), self.assertRaises(ValueError):
                print_data(self.conn, ACTOR, body)
        with self.assertRaises(PermissionError):
            print_data(self.conn, None, {"ids": ["0"]})
        with self.assertRaises(PermissionError):
            read_batch(self.conn, None, "0")


class IntakeDefaultOrderTests(unittest.TestCase):
    def setUp(self):
        invalidate_data_cache_prefixes("")
        self.addCleanup(invalidate_data_cache_prefixes, "")
        self.conn = sqlite3.connect(":memory:")
        self.conn.row_factory = sqlite3.Row
        self.addCleanup(self.conn.close)
        self.conn.execute(
            "CREATE TABLE intake_batches (id TEXT PRIMARY KEY, batch_no TEXT, iacuc TEXT, intake_date TEXT, updated_at TEXT, payload TEXT)"
        )
        rows = [
            ("dated-new", "2026-11-02", "2026-10-01", "target"),
            ("pending-empty-old", "", "2026-10-02", "target"),
            ("pending-null-new", None, "2026-10-04", "target"),
            ("dated-old", "2026-10-01", "2026-10-09", "target"),
            ("pending-null-tie", None, "2026-10-03", "target"),
            ("pending-empty-tie", "", "2026-10-03", "target"),
            ("dated-same", "2026-11-02", "2026-10-05", "target"),
            ("other-project", "", "2026-10-06", "other"),
        ]
        for item_id, date, updated_at, iacuc in rows:
            item = dict(id=item_id, batchNo=item_id, intakeDate=date, updatedAt=updated_at, iacuc=iacuc)
            self.conn.execute(
                "INSERT INTO intake_batches VALUES (?,?,?,?,?,?)",
                (item_id, item_id, iacuc, date, updated_at, json.dumps(item)),
            )
        self.conn.commit()
        self.conn.execute("PRAGMA query_only=ON")

    def listing(self, summary=False, **params):
        return list_intake_batches_page(
            self.conn,
            {"limit": 2, "offset": 0, "view": "summary" if summary else "", "iacuc": "target", **params},
            filtered_where,
            ENTITY_ORDER_BY,
        )

    def test_default_order_is_global_stable_and_shared_by_summary_and_full_pages(self):
        expected = [
            "pending-null-new",
            "pending-empty-tie",
            "pending-null-tie",
            "pending-empty-old",
            "dated-same",
            "dated-new",
            "dated-old",
        ]
        for summary in (False, True):
            actual = []
            for offset in range(0, 7, 2):
                result = self.listing(summary, offset=offset)
                self.assertEqual(result["page"]["total"], 7)
                self.assertEqual(result["page"]["hasMore"], offset + 2 < 7)
                actual.extend(row["id"] for row in result["items"])
            self.assertEqual(actual, expected)
            self.assertEqual([row["id"] for row in self.listing(summary)["items"]], expected[:2])

    def test_date_filter_preserves_pending_first_and_date_descending_across_pages(self):
        params = {"columnFilters": {"intakeDate": ["", "2026-11-02"]}}
        expected = [
            "pending-null-new",
            "pending-empty-tie",
            "pending-null-tie",
            "pending-empty-old",
            "dated-same",
            "dated-new",
        ]
        for summary in (False, True):
            actual = []
            for offset in range(0, 6, 2):
                result = self.listing(summary, offset=offset, **params)
                self.assertEqual(result["page"]["total"], 6)
                actual.extend(row["id"] for row in result["items"])
            self.assertEqual(actual, expected)

    def test_explicit_sort_keeps_existing_null_date_and_other_column_semantics(self):
        expected_by_direction = {
            "asc": [
                "pending-null-tie",
                "pending-null-new",
                "pending-empty-tie",
                "pending-empty-old",
                "dated-old",
                "dated-same",
                "dated-new",
            ],
            "desc": [
                "dated-same",
                "dated-new",
                "dated-old",
                "pending-empty-tie",
                "pending-empty-old",
                "pending-null-tie",
                "pending-null-new",
            ],
        }
        for summary in (False, True):
            for direction, expected in expected_by_direction.items():
                result = self.listing(summary, limit=20, sortKey="intakeDate", sortDir=direction)
                self.assertEqual([row["id"] for row in result["items"]], expected)
            result = self.listing(summary, limit=20, sortKey="batchNo", sortDir="asc")
            self.assertEqual([row["id"] for row in result["items"]], sorted(expected_by_direction["asc"]))
