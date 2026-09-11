import copy
import json
import unittest

from server_app.domains.quarantine import repository as repo
from server_app.domains.quarantine import service, workflow
from server_app.shared.concurrency import StaleWriteError
from tests import test_quarantine as fixtures
from tests.test_quarantine import sample_test


class QuarantineWorkflowTests(unittest.TestCase):
    setUp = fixtures.QuarantineTests.setUp
    tearDown = fixtures.QuarantineTests.tearDown
    write = fixtures.QuarantineTests.write
    create_test = fixtures.QuarantineTests.create_test
    issue = fixtures.QuarantineTests.issue

    def add_intake(self, entity_id, status="received"):
        item = {
            "id": entity_id,
            "status": status,
            "species": "小鼠",
            "supplier": "供应商甲",
            "strainStandard": "C57BL/6J",
            "intakeDate": "2026-09-02",
        }
        with self.conn:
            self.conn.execute(
                "INSERT INTO intake_batches VALUES (?,?,?)", (entity_id, item["intakeDate"], json.dumps(item))
            )
        return item

    def set_conclusion(self):
        self.batch["conclusion"] = "所属检疫批次抽检无异常"
        self.batch = self.write(
            service.save_batch, {"item": self.batch, "expectedUpdatedAt": self.batch["updatedAt"]}, "batch"
        )

    def issue_methods(self, methods=("parasite", "elisa_mouse", "pcr")):
        for method in methods:
            raw = sample_test()
            raw.update(id=method, method=method)
            raw["projects"][0].update(kit="试剂盒", lot="lot", nc="negative", pc="positive")
            self.issue(self.create_test(raw))

    def complete(self, **overrides):
        body = {
            "expectedUpdatedAt": self.batch["updatedAt"],
            "expectedTestVersions": {t["id"]: t["updatedAt"] for t in repo.all_items(self.conn, "tests", "batch")},
        }
        body.update(overrides)
        return self.write(workflow.complete, "batch", body)

    def test_only_received_enters_pool_and_claim_is_exclusive(self):
        for status in ("draft", "pending_print", "printed", "received"):
            self.add_intake(status, status)
        self.assertEqual([i["id"] for i in repo.list_page(self.conn, "sources", {})["items"]], ["received"])
        source = {"id": "from-intake", "intakeId": "received"}
        self.batch["sources"].append(source)
        self.batch = self.write(
            service.save_batch, {"item": self.batch, "expectedUpdatedAt": self.batch["updatedAt"]}, "batch"
        )
        self.assertEqual(self.batch["sources"][-1]["strainStandard"], "C57BL/6J")
        self.assertEqual(repo.list_page(self.conn, "sources", {})["page"]["total"], 0)
        self.assertEqual(
            repo.list_page(self.conn, "sources", {"state": "all"})["items"][0]["quarantineStatus"], "检疫中"
        )
        with self.assertRaisesRegex(ValueError, "已加入"):
            self.write(service.save_batch, {"item": {"id": "other", "name": "重复", "sources": [source]}})
        with self.assertRaisesRegex(ValueError, "已接收"):
            self.write(
                service.save_batch,
                {"item": {"id": "other", "name": "未接收", "sources": [{"id": "x", "intakeId": "printed"}]}},
            )

    def test_completion_covers_unsampled_intake_and_keeps_receipt_state(self):
        animal = self.add_intake("not-sampled")
        self.batch["sources"].append({"id": "not-sampled", "intakeId": animal["id"]})
        self.set_conclusion()
        self.issue_methods()
        before = repo.intake(self.conn, animal["id"])
        completed = self.complete()
        self.assertTrue(completed["completedAt"])
        self.assertEqual(len(completed["completionReportIds"]), 3)
        self.assertEqual(workflow.decorate_intakes(self.conn, [copy.deepcopy(animal)])[0]["quarantineStatus"], "已检疫")
        self.assertEqual(repo.intake(self.conn, animal["id"]), before)
        self.assertEqual(self.complete()["completedAt"], completed["completedAt"])
        self.assertEqual(service.batch_detail(self.conn, "batch")["item"]["status"], "已检疫")
        self.assertIn("quarantine.batch_completed", json.dumps(self.audits))

    def test_completion_requires_all_methods_versions_and_auth(self):
        self.set_conclusion()
        self.issue_methods(("parasite",))
        with self.assertRaisesRegex(ValueError, "三类"):
            self.complete()
        self.issue_methods(("elisa_mouse", "pcr"))
        with self.assertRaises(StaleWriteError):
            self.complete(expectedTestVersions={})
        with self.assertRaises(StaleWriteError):
            self.complete(expectedUpdatedAt="old")
        with self.assertRaises(PermissionError):
            workflow.complete(self.conn, {}, "batch", {})

    def test_rat_coverage_requires_rat_elisa_even_when_unsampled(self):
        self.batch["sources"].append({"id": "rat", "supplier": "鼠供应商", "species": "大鼠"})
        self.set_conclusion()
        self.issue_methods()
        with self.assertRaisesRegex(ValueError, "三类"):
            self.complete()

    def test_abnormal_requires_supplier_split_negative_retests(self):
        self.set_conclusion()
        raw = sample_test()
        raw["samples"][0]["sourceIds"] = ["source-a", "source-b"]
        raw["projects"][0]["results"]["sample"] = "positive"
        self.issue(self.create_test(raw))
        self.issue_methods(("elisa_mouse", "pcr"))
        with self.assertRaisesRegex(ValueError, "异常"):
            self.complete()
        self.batch["handling"] = "已按供应商拆分复检"
        self.set_conclusion()
        original = repo.get(self.conn, "tests", "test")
        for index, supplier in enumerate(("供应商甲", "供应商乙")):
            retest = self.write(
                service.clone_test,
                "test",
                {"id": f"retest-{index}", "supplier": supplier, "expectedUpdatedAt": original["updatedAt"]},
                retest=True,
            )
            retest.update(samplingDate="2026-09-03", testDate="2026-09-04", conclusion="复检无异常")
            retest["projects"][0]["results"] = {"sample": "negative"}
            retest = self.write(
                service.save_test, {"item": retest, "expectedUpdatedAt": retest["updatedAt"]}, retest["id"]
            )
            self.issue(retest)
            if index == 0:
                with self.assertRaisesRegex(ValueError, "异常"):
                    self.complete()
        self.assertTrue(self.complete()["completedAt"])
        self.assertEqual(repo.get(self.conn, "tests", "test")["projects"][0]["results"]["sample"], "positive")

    def test_correction_reopens_cohort_and_keeps_completion_history(self):
        self.set_conclusion()
        self.issue_methods()
        completed = self.complete()
        with self.assertRaisesRegex(ValueError, "已完成检疫"):
            self.write(service.save_batch, {"item": completed, "expectedUpdatedAt": completed["updatedAt"]}, "batch")
        current = repo.get(self.conn, "tests", "parasite")
        correction = self.write(
            service.clone_test, "parasite", {"id": "corrected", "expectedUpdatedAt": current["updatedAt"]}
        )
        self.batch = repo.get(self.conn, "batches", "batch")
        self.assertFalse(self.batch["completedAt"])
        self.assertEqual(self.batch["completionHistory"][0]["reportIds"], completed["completionReportIds"])
        with self.assertRaises(ValueError):
            self.complete()
        self.issue(correction)
        self.assertTrue(self.complete()["completedAt"])

    def test_not_tested_does_not_complete_and_issued_coverage_is_frozen(self):
        self.set_conclusion()
        raw = sample_test()
        raw["projects"][0]["results"]["sample"] = "not_tested"
        self.issue(self.create_test(raw))
        self.issue_methods(("elisa_mouse", "pcr"))
        with self.assertRaisesRegex(ValueError, "未检测"):
            self.complete()
        self.batch["sources"].append({"id": "late", "supplier": "供应商", "species": "小鼠"})
        with self.assertRaisesRegex(ValueError, "覆盖范围"):
            self.set_conclusion()
