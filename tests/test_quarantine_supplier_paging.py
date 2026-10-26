import sqlite3
import unittest

from server_app.domains.quarantine import history, repository, workflow


class QuarantineSupplierPagingTests(unittest.TestCase):
    def setUp(self):
        self.conn = sqlite3.connect(":memory:")
        self.conn.row_factory = sqlite3.Row
        repository.ensure_schema(self.conn)
        for index in range(3):
            batch = {
                "id": f"b{index}",
                "name": f"batch {index}",
                "updatedAt": f"2026-09-0{index + 1}",
                "sources": [
                    {
                        "id": f"s{index}",
                        "supplier": f"supplier {index}",
                        "species": "小鼠",
                        "intakeDate": "2026-09-01",
                        "intakeId": f"i{index}",
                    }
                ],
            }
            repository.save(self.conn, "batches", batch, create=True)
            repository.save(
                self.conn,
                "tests",
                {
                    "id": f"t{index}",
                    "batchId": batch["id"],
                    "method": "pcr",
                    "testDate": "2026-09-02",
                    "state": "issued",
                    "updatedAt": "2026-09-02",
                    "samples": [{"id": "sample", "sourceIds": [f"s{index}"], "poolCount": 1, "portionCount": 2}],
                    "projects": [{"id": "p", "sampleIds": ["sample"], "results": {"sample": "negative"}}],
                },
                create=True,
            )

    def tearDown(self):
        self.conn.close()

    def test_summary_pages_match_legacy_order_and_totals_without_detail_payload(self):
        legacy = history.supplier_history(self.conn, {})
        first = history.supplier_summary(self.conn, {"limit": "2", "offset": "0"})
        second = history.supplier_summary(self.conn, {"limit": "2", "offset": "2"})
        self.assertEqual(first["page"], {"limit": 2, "offset": 0, "total": 3, "hasMore": True})
        for actual, expected in zip(first["items"] + second["items"], legacy, strict=True):
            self.assertEqual(
                actual, {k: v for k, v in expected.items() if k not in {"details", "intakeIds", "batchIds"}}
            )
        self.assertEqual(history.supplier_summary(self.conn, {"limit": "999"})["page"]["limit"], 100)

    def test_details_preserve_exact_group_and_legacy_order(self):
        extra = repository.get(self.conn, "tests", "t2")
        extra.update(id="t-extra", updatedAt="2026-09-04")
        repository.save(self.conn, "tests", extra, create=True)
        legacy = history.supplier_history(self.conn, {})[0]
        params = {"groupSupplier": legacy["supplier"], "groupMethod": legacy["method"], "groupRetest": "false"}
        result = history.supplier_details(self.conn, {**params, "limit": "1"})
        next_page = history.supplier_details(self.conn, {**params, "limit": "1", "offset": "1"})
        self.assertEqual(result["items"] + next_page["items"], legacy["details"])
        self.assertEqual(result["page"]["total"], len(legacy["details"]))
        self.assertEqual(history.supplier_details(self.conn, {**params, "groupSupplier": "missing"})["items"], [])
        with self.assertRaises(ValueError):
            history.supplier_details(self.conn, {**params, "groupRetest": "invalid"})

    def test_bulk_tests_and_intake_decoration_are_scoped(self):
        queries = []
        self.conn.set_trace_callback(queries.append)
        history.supplier_history(self.conn, {})
        self.assertEqual(sum("FROM quarantine_tests" in query for query in queries), 1)
        queries.clear()
        result = workflow.decorate_intakes(self.conn, [{"id": "i1", "status": "received"}])
        self.assertEqual([item["id"] for item in result[0]["quarantineBatches"]], ["b1"])
        self.assertTrue(any("json_each" in query and "i1" in query for query in queries))
        self.assertEqual(set(workflow.intake_links(self.conn)), {"i0", "i1", "i2"})
