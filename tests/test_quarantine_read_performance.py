import copy
import sqlite3
import unittest
from unittest.mock import patch

from server_app.domains.quarantine import history, service
from server_app.domains.quarantine import repository as repo


class QuarantineReadTests(unittest.TestCase):
    def setUp(self):
        self.conn = sqlite3.connect(":memory:")
        self.conn.row_factory = sqlite3.Row
        repo.ensure_schema(self.conn)

    def tearDown(self):
        self.conn.close()

    def batch(self, entity_id="batch", sources=None):
        item = {
            "id": entity_id,
            "name": entity_id,
            "conclusion": "",
            "handling": "",
            "updatedAt": "2026-09-01",
            "sources": sources
            or [
                {
                    "id": "source-a",
                    "supplier": "Straße供应商",
                    "species": "小鼠",
                    "intakeDate": "2026-09-01",
                    "intakeId": "intake-a",
                },
                {
                    "id": "source-b",
                    "supplier": "供应商乙",
                    "species": "大鼠",
                    "intakeDate": "2026-09-02",
                    "intakeId": "",
                },
            ],
        }
        repo.save(self.conn, "batches", item, create=True)
        return item

    def create_record(self, entity_id="test", batch_id="batch", **changes):
        item = {
            "id": entity_id,
            "batchId": batch_id,
            "method": "pcr",
            "testDate": "2026-09-03",
            "state": "issued",
            "updatedAt": "2026-09-03",
            "samples": [{"id": "sample", "sourceIds": ["source-a", "source-b"], "poolCount": 1, "portionCount": 2}],
            "projects": [{"id": "project", "sampleIds": ["sample"], "results": {"sample": "negative"}}],
            **changes,
        }
        repo.save(self.conn, "tests", item, create=True)
        return item

    def test_source_filters_keep_unicode_date_boundaries_and_manual_sources(self):
        self.batch()
        self.create_record()
        for filters, supplier, intake_count in (
            ({"supplier": "STRASSE", "species": "小鼠"}, "Straße供应商", 1),
            ({"dateFrom": "2026-09-01", "dateTo": "2026-09-01"}, "Straße供应商", 1),
            ({"species": "鼠", "dateFrom": "2026-09-02", "dateTo": "2026-09-02"}, "供应商乙", 0),
        ):
            with self.subTest(filters=filters):
                rows = history.supplier_history(self.conn, filters)
                self.assertEqual(len(rows), 1)
                self.assertEqual(rows[0]["supplier"], supplier)
                self.assertEqual(rows[0]["intakeCount"], intake_count)
                self.assertEqual(rows[0]["poolCount"], 1)
                self.assertEqual(rows[0]["portionCount"], 2)
                self.assertTrue(rows[0]["details"][0]["sharedPools"])
        rows = history.supplier_history(
            self.conn, {"dateType": "test", "dateFrom": "2026-09-03", "dateTo": "2026-09-03"}
        )
        self.assertEqual(len(rows), 2)
        self.assertEqual(history.supplier_history(self.conn, {"dateTo": "2026-08-31"}), [])

    def test_excluded_batches_do_not_load_detection_payloads(self):
        self.batch()
        self.create_record()
        for filters in (
            {"supplier": "没有此供应商"},
            {"species": "兔"},
            {"dateFrom": "2026-09-03"},
        ):
            with self.subTest(filters=filters):
                queries = []
                self.conn.set_trace_callback(queries.append)
                self.assertEqual(history.supplier_history(self.conn, filters), [])
                self.conn.set_trace_callback(None)
                self.assertFalse(any("FROM quarantine_tests" in query for query in queries))

    def test_out_of_range_retest_still_resolves_selected_original(self):
        self.batch()
        original = self.create_record(
            projects=[{"id": "project", "sampleIds": ["sample"], "results": {"sample": "suspect"}}]
        )
        for index, source in enumerate(("source-a", "source-b")):
            self.create_record(
                f"retest-{index}",
                retestOf=original["id"],
                testDate="2026-09-10",
                samples=[{"id": "sample", "sourceIds": [source], "poolCount": 1, "portionCount": 1}],
            )
        rows = history.supplier_history(
            self.conn,
            {"supplier": "STRASSE", "dateType": "test", "dateTo": "2026-09-03", "result": "resolved"},
        )
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["resolved"], 1)
        self.assertEqual(rows[0]["pending"], 0)
        self.assertEqual([detail["testId"] for detail in rows[0]["details"]], ["test"])
        self.assertEqual(repo.get(self.conn, "tests", "test"), original)

    def test_out_of_range_issued_correction_supersedes_original_but_draft_does_not(self):
        self.batch()
        self.create_record()
        correction = self.create_record("correction", correctionOf="test", testDate="2026-09-10", state="draft")
        filters = {"supplier": "STRASSE", "dateType": "test", "dateTo": "2026-09-03"}
        rows = history.supplier_history(self.conn, filters)
        self.assertEqual([detail["testId"] for detail in rows[0]["details"]], ["test"])
        correction["state"] = "issued"
        repo.save(self.conn, "tests", correction)
        self.assertEqual(history.supplier_history(self.conn, filters), [])

    def test_detail_scans_project_results_once_per_test_at_supported_sample_limit(self):
        sources = [{"id": f"source-{index}", "supplier": "供应商", "species": "小鼠"} for index in range(200)]
        self.batch(sources=sources)
        samples = [{"id": f"sample-{index}", "sourceIds": [source["id"]]} for index, source in enumerate(sources)]
        sample_ids = [sample["id"] for sample in samples]
        test = self.create_record(
            samples=samples,
            projects=[
                {"id": f"project-{index}", "sampleIds": sample_ids, "results": dict.fromkeys(sample_ids, "negative")}
                for index in range(100)
            ],
        )
        expected = copy.deepcopy(test)
        with patch.object(service, "abnormal_samples", wraps=service.abnormal_samples) as scan:
            detail = service.batch_detail(self.conn, "batch")
        self.assertEqual(scan.call_count, 1)
        self.assertEqual(detail["tests"], [expected])
        self.assertEqual(detail["item"]["status"], "检测中")
        self.assertEqual(detail["attachments"], [])
        self.assertEqual(detail["reports"], [])


if __name__ == "__main__":
    unittest.main()
