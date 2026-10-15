import copy
import json
import sqlite3
import unittest
from contextlib import closing
from unittest.mock import patch

from server_app.domains.data_quality import read_service as service
from server_app.domains.data_quality.read_repository import ArchiveIntegrityError
from server_app.domains.data_quality.repository import save_scan
from server_app.persistence.data_quality import ensure_schema
from server_app.web import data_quality

ADMIN = {"id": "admin", "role": "admin", "displayName": "管理员"}


def report(identity="scan-old", at="2026-10-10", count=25):
    findings = [
        {
            "id": f"issue-{index:03}",
            "code": "placement_missing_receipt" if index % 2 else "occupancy_missing_slot",
            "entityType": "placement_tasks" if index % 2 else "occupancies",
            "entityId": f"record-{index}",
            "referenceId": f"missing-{index}",
            "summary": f"待核对记录{index}",
            "reviewStatus": "retained_history" if index % 3 == 0 else "needs_review",
            "evidence": {"payloadText": json.dumps({"id": f"record-{index}", "iacuc": "Z1", "pi": "原负责人"})},
        }
        for index in range(count)
    ]
    return {
        "scanId": identity,
        "scannedAt": at,
        "detectorVersion": "test-v1",
        "latestBusinessAt": "2026-10-09",
        "sourceSha256": "a" * 64,
        "scope": "历史关联核查范围",
        "actor": ADMIN,
        "findings": findings,
        "summary": {},
    }


class DataQualityReadTests(unittest.TestCase):
    def setUp(self):
        self.conn = sqlite3.connect(":memory:")
        self.conn.row_factory = sqlite3.Row
        self.conn.execute("PRAGMA foreign_keys=ON")
        ensure_schema(self.conn)
        self.source = report()
        save_scan(self.conn, self.source)
        self.conn.commit()
        self.addCleanup(self.conn.close)

    def test_pages_facets_and_details_are_read_only_and_do_not_start_detection(self):
        before, changes = list(self.conn.iterdump()), self.conn.total_changes
        self.conn.execute("PRAGMA query_only=ON")
        with patch("server_app.domains.data_quality.detection.detect", side_effect=AssertionError("must not scan")):
            scans = service.list_scans(self.conn, ADMIN, {"limit": 1})
            self.assertEqual(scans["items"][0]["findingCount"], 25)
            self.assertNotIn("findings", scans["items"][0])
            ids = []
            for offset in range(0, 25, 10):
                result = service.list_issues(self.conn, ADMIN, "scan-old", {"limit": 10, "offset": offset})
                ids.extend(item["id"] for item in result["items"])
                self.assertEqual(sum(item["count"] for item in result["filterOptions"]["code"]), 25)
                for item in result["items"]:
                    self.assertNotIn("evidence", item)
                    detail = service.get_issue(self.conn, ADMIN, "scan-old", item["id"])
                    self.assertEqual(
                        detail["evidence"],
                        next(f["evidence"] for f in self.source["findings"] if f["id"] == item["id"]),
                    )
            self.assertEqual(len(set(ids)), 25)
            self.assertEqual(result["page"], {"limit": 10, "offset": 20, "total": 25, "hasMore": False})
        self.assertEqual(list(self.conn.iterdump()), before)
        self.assertEqual(self.conn.total_changes, changes)

    def test_filters_exclude_their_own_column_and_page_after_filtering(self):
        selected = {"code": ["occupancy_missing_slot"], "reviewStatus": ["needs_review"]}
        result = service.list_issues(
            self.conn, ADMIN, "scan-old", {"columnFilters": json.dumps(selected), "limit": 3, "offset": 3}
        )
        expected = [
            f
            for f in self.source["findings"]
            if f["code"] == selected["code"][0] and f["reviewStatus"] == selected["reviewStatus"][0]
        ]
        self.assertEqual(result["page"]["total"], len(expected))
        self.assertEqual([f["id"] for f in result["items"]], [f["id"] for f in expected[3:6]])
        self.assertEqual(sum(x["count"] for x in result["filterOptions"]["code"]), 16)
        self.assertEqual(sum(x["count"] for x in result["filterOptions"]["reviewStatus"]), 13)
        zero = service.list_issues(self.conn, ADMIN, "scan-old", {"columnFilters": {"code": ["unknown-future-code"]}})
        self.assertEqual(zero["page"]["total"], 0)

    def test_old_and_new_scan_keep_their_own_status_and_evidence(self):
        newer = copy.deepcopy(self.source)
        newer.update(scanId="scan-new", scannedAt="2026-10-12")
        newer["findings"][1].update(reviewStatus="retained_history", evidence={"payloadText": "新留档证据"})
        save_scan(self.conn, newer)
        self.conn.commit()
        old = service.get_issue(self.conn, ADMIN, "scan-old", "issue-001")
        new = service.get_issue(self.conn, ADMIN, "scan-new", "issue-001")
        self.assertEqual(
            (old["item"]["reviewStatus"], new["item"]["reviewStatus"]), ("needs_review", "retained_history")
        )
        self.assertNotEqual(old["evidence"], new["evidence"])
        self.assertEqual(
            self.conn.execute("SELECT review_status FROM data_quality_issues WHERE id='issue-001'").fetchone()[0],
            "needs_review",
        )
        scans = service.list_scans(self.conn, ADMIN, {"limit": 1})
        self.assertEqual(scans["items"][0]["id"], "scan-new")
        self.assertTrue(scans["page"]["hasMore"])
        self.assertEqual(service.list_scans(self.conn, ADMIN, {"limit": 1, "offset": 1})["items"][0]["id"], "scan-old")

    def test_empty_archive_and_zero_finding_scan_are_distinct(self):
        empty = report("scan-empty", "2026-10-15", 0)
        save_scan(self.conn, empty)
        self.conn.commit()
        value = service.list_issues(self.conn, ADMIN, "scan-empty", {})
        self.assertEqual((value["scan"]["findingCount"], value["items"], value["page"]["total"]), (0, [], 0))
        with closing(sqlite3.connect(":memory:")) as conn:
            conn.row_factory = sqlite3.Row
            ensure_schema(conn)
            self.assertEqual(service.list_scans(conn, ADMIN, {})["items"], [])

    def test_access_is_admin_only_before_any_query(self):
        for actor in (None, {"role": "room_admin"}, {"role": "viewer"}):
            for operation in (
                lambda actor=actor: service.list_scans(None, actor, {}),
                lambda actor=actor: service.list_issues(None, actor, "scan-old", {}),
                lambda actor=actor: service.get_issue(None, actor, "scan-old", "issue-001"),
            ):
                with self.assertRaises(PermissionError):
                    operation()

    def test_mismatched_scan_issue_and_corrupt_evidence_fail_without_repair(self):
        with self.assertRaises(LookupError):
            service.get_issue(self.conn, ADMIN, "scan-old", "missing")
        self.conn.execute(
            "UPDATE data_quality_observations SET evidence_json='{}' WHERE scan_id='scan-old' AND issue_id='issue-001'"
        )
        self.conn.commit()
        before = list(self.conn.iterdump())
        with self.assertRaisesRegex(ArchiveIntegrityError, "校验失败"):
            service.get_issue(self.conn, ADMIN, "scan-old", "issue-001")
        self.assertEqual(list(self.conn.iterdump()), before)
        self.conn.execute("DELETE FROM data_quality_observations WHERE scan_id='scan-old' AND issue_id='issue-001'")
        with self.assertRaisesRegex(ArchiveIntegrityError, "证据缺失"):
            service.get_issue(self.conn, ADMIN, "scan-old", "issue-001")
        self.conn.execute("UPDATE data_quality_scans SET finding_count=0 WHERE id='scan-old'")
        with self.assertRaisesRegex(ArchiveIntegrityError, "清单校验失败"):
            service.list_issues(self.conn, ADMIN, "scan-old", {})

    def test_invalid_filters_pagination_and_order_are_rejected(self):
        for params in (
            {"limit": 0},
            {"limit": 101},
            {"offset": -1},
            {"limit": "bad"},
            {"columnFilters": "{"},
            {"columnFilters": {"entityId": ["a"]}},
            {"columnFilters": {"code": "bad"}},
            {"columnFilters": {"reviewStatus": ["resolved"]}},
            {"sortKey": "id;DELETE"},
            {"sortDir": "bad"},
        ):
            with self.subTest(params=params), self.assertRaises(ValueError):
                service.list_issues(self.conn, ADMIN, "scan-old", params)

    def test_http_boundary_is_query_only_and_uses_expected_error_codes(self):
        class Handler:
            path = "/api/data-quality/scans/scan-old/issues?limit=3"

            def require_user(self):
                return ADMIN

            def send_json(self, payload, status=200):
                self.response = payload, status

        handler = Handler()
        before = list(self.conn.iterdump())
        with patch.object(data_quality, "connect_db", return_value=self.conn):
            self.assertTrue(data_quality.handle(handler, "GET", "/api/data-quality/scans/scan-old/issues"))
        self.assertEqual(handler.response[1], 200)
        self.assertEqual(len(handler.response[0]["items"]), 3)
        self.assertEqual(self.conn.execute("PRAGMA query_only").fetchone()[0], 1)
        self.assertEqual(list(self.conn.iterdump()), before)
        with (
            patch.object(handler, "require_user", return_value={"role": "room_admin"}),
            patch.object(data_quality, "connect_db", side_effect=AssertionError("unauthorized DB read")),
        ):
            data_quality.handle(handler, "GET", "/api/data-quality/scans")
        self.assertEqual(handler.response[1], 403)
