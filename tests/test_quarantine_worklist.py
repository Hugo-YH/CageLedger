import sqlite3
import unittest

from server_app.domains.quarantine import repository as repo
from server_app.domains.quarantine import worklist
from server_app.web import quarantine


class WorklistTests(unittest.TestCase):
    def setUp(self):
        self.conn = sqlite3.connect(":memory:")
        repo.ensure_schema(self.conn)
        self.conn.execute(
            "CREATE TABLE audit_events(id TEXT, action TEXT, entity_type TEXT, entity_id TEXT, actor_display_name TEXT, actor_username TEXT, at TEXT)"
        )
        for index, method in enumerate(("parasite", "pcr", "elisa_mouse", "elisa_rat")):
            batch_id, test_id = f"batch-{index}", f"test-{index}"
            repo.save(
                self.conn,
                "batches",
                {
                    "id": batch_id,
                    "name": f"B2609160{index}",
                    "sources": [{"supplier": "供应商甲" if index < 2 else "供应商乙", "pi": "测试课题组"}],
                    "updatedAt": "2026-09-16",
                },
                create=True,
            )
            repo.save(
                self.conn,
                "tests",
                {
                    "id": test_id,
                    "batchId": batch_id,
                    "method": method,
                    "state": "draft" if index < 2 else "issued",
                    "testDate": f"2026-09-1{index}",
                    "samples": [{"id": "sample"}],
                    "projects": [{"results": {"sample": "positive" if index == 1 else "negative"}, "pc": "positive"}],
                    "updatedAt": "2026-09-16",
                },
                create=True,
            )
            if index >= 2:
                for version in (1, 2):
                    repo.save(
                        self.conn,
                        "reports",
                        {
                            "id": f"report-{index}-{version}",
                            "testId": test_id,
                            "version": version,
                            "number": f"REPORT{index}",
                            "snapshot": {"private": "snapshot"},
                            "storageName": "private-file.pdf",
                            "updatedAt": "2026-09-16",
                        },
                        create=True,
                    )

    def tearDown(self):
        self.conn.close()

    def test_filters_counts_and_pagination(self):
        first = worklist.list_records(self.conn, {"method": "elisa", "limit": "1"})
        second = worklist.list_records(self.conn, {"method": "elisa", "limit": "1", "offset": "1"})
        self.assertEqual(first["summary"], {"total": 2, "draft": 0, "issued": 2})
        self.assertNotEqual(first["items"][0]["id"], second["items"][0]["id"])
        self.assertEqual(worklist.list_records(self.conn, {"search": "供应商甲", "state": "draft"})["page"]["total"], 2)
        result = worklist.list_records(self.conn, {"dateFrom": "2026-09-11", "dateTo": "2026-09-11"})
        self.assertEqual(result["items"][0]["abnormalCount"], 1)
        self.assertEqual(worklist.list_records(self.conn, {"method": "parasite"})["items"][0]["abnormalCount"], 0)

    def test_report_versions_are_separate_and_no_private_payload_is_exposed(self):
        result = worklist.list_records(self.conn, {"search": "REPORT2"}, reports=True)
        self.assertEqual(result["page"]["total"], 2)
        self.assertEqual({item["version"] for item in result["items"]}, {1, 2})
        for item in result["items"]:
            self.assertNotIn("snapshot", item)
            self.assertNotIn("storageName", item)
        self.assertEqual(worklist.list_records(self.conn, {"state": "draft"}, reports=True)["items"], [])

    def test_projection_counts_results_and_preserves_report_and_retest_fields(self):
        test = repo.get(self.conn, "tests", "test-2")
        test.update(
            samples=[{"id": "a"}, {"id": "b"}],
            projects=[
                {"results": {"a": "positive", "b": "suspect", "other": "negative"}},
                {"results": {"a": "positive", "b": "inconclusive"}},
            ],
            samplingDate=None,
            retestOf="earlier",
            correctionOf="corrected",
        )
        repo.save(self.conn, "tests", test)
        records = worklist.list_records(self.conn, {"method": "elisa_mouse"})["items"]
        item = records[0]
        self.assertEqual((item["sampleCount"], item["projectCount"], item["abnormalCount"]), (2, 2, 3))
        self.assertIsNone(item["samplingDate"])
        self.assertEqual((item["retestOf"], item["correctionOf"]), ("earlier", "corrected"))
        reports = worklist.list_records(self.conn, {"method": "elisa_mouse"}, reports=True)["items"]
        self.assertEqual({item["version"] for item in reports}, {1, 2})
        self.assertTrue(all(item["abnormalCount"] == 3 and item["testId"] == "test-2" for item in reports))

    def test_batch_counts_use_field_projection_and_keep_method_order(self):
        for index, (method, state) in enumerate((("pcr", "issued"), ("parasite", "draft"), ("pcr", "issued"))):
            repo.save(
                self.conn,
                "tests",
                {
                    "id": f"extra-{index}",
                    "batchId": "batch-0",
                    "method": method,
                    "state": state,
                    "samples": [],
                    "projects": [],
                    "updatedAt": "2026-09-16",
                },
                create=True,
            )
        statements = []
        self.conn.set_trace_callback(statements.append)
        result = repo.list_page(self.conn, "batches", {"search": "B26091600"})
        self.conn.set_trace_callback(None)
        item = result["items"][0]
        self.assertEqual((item["recordCount"], item["issuedCount"]), (4, 2))
        self.assertEqual(item["methods"], ["parasite", "pcr"])
        test_query = next(query for query in statements if "FROM quarantine_tests WHERE batch_id IN" in query)
        self.assertIn("json_extract(payload, '$.state')", test_query)
        self.assertNotIn("SELECT batch_id, payload", test_query)

    def test_invalid_filters_are_rejected(self):
        for params in (
            {"method": "x"},
            {"state": "x"},
            {"dateFrom": "bad"},
            {"dateFrom": "2026-09-20", "dateTo": "2026-09-01"},
        ):
            with self.subTest(params=params), self.assertRaises(ValueError):
                worklist.list_records(self.conn, params)

    def test_activity_is_scoped_paginated_and_hides_snapshots(self):
        for index, entity in enumerate(("batch-0", "test-0", "batch-1")):
            self.conn.execute(
                "INSERT INTO audit_events VALUES (?,?,?,?,?,?,?)",
                (str(index), "quarantine.test_saved", "quarantine", entity, "检测员", "actor", "2026-09-16"),
            )
        result = worklist.activity(self.conn, "batch-0", {"limit": "1"})
        self.assertEqual(result["page"]["total"], 2)
        self.assertTrue(result["page"]["hasMore"])
        self.assertEqual(set(result["items"][0]), {"id", "action", "actor", "at"})
        with self.assertRaises(LookupError):
            worklist.activity(self.conn, "missing", {})

    def test_removed_attachment_cannot_be_downloaded_or_previewed(self):
        repo.save(
            self.conn,
            "attachments",
            {"id": "removed", "testId": "test-0", "removed": True, "updatedAt": "2026-09-16"},
            create=True,
        )
        for params in ({}, {"preview": "1"}):
            with self.assertRaises(LookupError):
                quarantine.get(None, self.conn, ["attachments", "removed"], params)
