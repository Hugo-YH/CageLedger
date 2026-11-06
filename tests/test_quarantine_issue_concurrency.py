"""Real WAL transactions around fake, gated PDF conversion; no Writer required."""

import copy
import json
import sqlite3
import tempfile
import threading
import unittest
from contextlib import contextmanager
from pathlib import Path
from queue import Queue
from unittest.mock import patch

from server_app.domains.quarantine import files, service
from server_app.domains.quarantine import repository as repo
from server_app.domains.quarantine.pdf import PdfRenderError
from server_app.shared.concurrency import StaleWriteError
from tests.test_quarantine import ACTOR, sample_test

PDF = b"%PDF-1.7\nsynthetic report\n%%EOF"


class CommitAcknowledgementLost(sqlite3.Connection):
    fail_commit = False

    def commit(self):
        super().commit()
        if self.fail_commit:
            self.fail_commit = False
            raise sqlite3.OperationalError("Synthetic commit acknowledgement lost")


class QuarantineIssueConcurrencyTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix="quarantine-issue-wal-")
        self.addCleanup(self.temporary.cleanup)
        self.database = Path(self.temporary.name) / "isolated.sqlite"
        self.root = Path(self.temporary.name) / "reports"
        audit_patch = patch.object(service, "write_audit_events", side_effect=self.write_audits)
        audit_patch.start()
        self.addCleanup(audit_patch.stop)
        with self.connection() as conn:
            self.assertEqual(conn.execute("PRAGMA journal_mode=WAL").fetchone()[0], "wal")
            repo.ensure_schema(conn)
            conn.execute("CREATE TABLE intake_batches(id TEXT PRIMARY KEY,intake_date TEXT,payload TEXT)")
            conn.execute("CREATE TABLE test_audits(id TEXT PRIMARY KEY,action TEXT,payload TEXT)")
            conn.execute("CREATE TABLE unrelated_writes(id TEXT PRIMARY KEY)")
            conn.commit()
            self.batch = service.save_batch(
                conn,
                ACTOR,
                {
                    "item": {
                        "id": "batch",
                        "batchNo": "B26090201",
                        "sources": [{"id": "source-a", "supplier": "Synthetic supplier", "species": "小鼠"}],
                    }
                },
            )
            conn.commit()
            self.test = service.save_test(conn, ACTOR, {"item": sample_test()})
            conn.commit()
        self.initial_sequences = self.sequences()

    @contextmanager
    def connection(self, factory=sqlite3.Connection):
        conn = sqlite3.connect(self.database, timeout=1, factory=factory)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA foreign_keys=ON")
        try:
            yield conn
        finally:
            conn.close()

    @staticmethod
    def write_audits(conn, events):
        conn.executemany(
            "INSERT INTO test_audits VALUES(?,?,?)",
            [(event["id"], event["action"], json.dumps(event, ensure_ascii=False)) for event in events],
        )

    def body(self, test=None):
        return {
            "expectedUpdatedAt": (test or self.test)["updatedAt"],
            "expectedBatchUpdatedAt": self.batch["updatedAt"],
        }

    def issue(self, test=None):
        item = test or self.test
        with self.connection() as conn:
            return files.issue(conn, ACTOR, item["id"], self.body(item), self.root)

    def sequences(self):
        with self.connection() as conn:
            return dict(conn.execute("SELECT scope,last_value FROM quarantine_number_sequences"))

    def issued_audits(self):
        with self.connection() as conn:
            return conn.execute("SELECT count(*) FROM test_audits WHERE action='quarantine.report_issued'").fetchone()[
                0
            ]

    def reports(self):
        with self.connection() as conn:
            return repo.all_items(conn, "reports")

    def assert_no_issue(self):
        self.assertEqual(self.reports(), [])
        self.assertEqual(self.issued_audits(), 0)
        self.assertEqual(self.sequences(), self.initial_sequences)
        with self.connection() as conn:
            self.assertEqual(repo.get(conn, "tests", self.test["id"])["state"], "draft")
        self.assertEqual(list(self.root.glob("*.pdf")), [])
        self.assertEqual(list(self.root.glob(".issue-*")), [])

    def start_issue(self, item=None):
        outcomes = Queue()

        def run():
            try:
                outcomes.put((True, self.issue(item)))
            except BaseException as error:
                outcomes.put((False, error))

        thread = threading.Thread(target=run, name="synthetic-quarantine-issue")
        thread.start()
        self.addCleanup(thread.join, 6)
        return thread, outcomes

    def finish(self, thread, outcomes):
        thread.join(6)
        self.assertFalse(thread.is_alive(), "Owned issue worker did not exit")
        return outcomes.get_nowait()

    def blocked_conversion(self, entered, release):
        def generate(_snapshot, _root):
            entered.set()
            self.assertTrue(release.wait(5), "Synthetic conversion gate was not released")
            return PDF

        return generate

    def test_other_connection_can_commit_while_pdf_generation_is_blocked(self):
        entered, release = threading.Event(), threading.Event()
        self.addCleanup(release.set)
        with patch.object(files, "generate", side_effect=self.blocked_conversion(entered, release)):
            thread, outcomes = self.start_issue()
            try:
                self.assertTrue(entered.wait(5))
                with self.connection() as conn:
                    conn.execute("BEGIN IMMEDIATE")
                    conn.execute("INSERT INTO unrelated_writes VALUES('during-render')")
                    conn.commit()
            finally:
                release.set()
            success, result = self.finish(thread, outcomes)
        self.assertTrue(success, repr(result))
        self.assertEqual(len(self.reports()), 1)
        self.assertEqual(self.issued_audits(), 1)
        self.assertEqual((self.root / result["storageName"]).read_bytes(), PDF)

    def assert_change_rejected(self, kind):
        entered, release = threading.Event(), threading.Event()
        self.addCleanup(release.set)
        with patch.object(files, "generate", side_effect=self.blocked_conversion(entered, release)):
            thread, outcomes = self.start_issue()
            try:
                self.assertTrue(entered.wait(5))
                with self.connection() as conn:
                    if kind == "test":
                        service.save_test(
                            conn,
                            ACTOR,
                            {
                                "item": {**self.test, "notes": "Changed during render"},
                                "expectedUpdatedAt": self.test["updatedAt"],
                            },
                            self.test["id"],
                        )
                    elif kind == "batch":
                        service.save_batch(
                            conn,
                            ACTOR,
                            {
                                "item": {**self.batch, "notes": "Changed during render"},
                                "expectedUpdatedAt": self.batch["updatedAt"],
                            },
                            self.batch["id"],
                        )
                    else:
                        conn.execute("BEGIN IMMEDIATE")
                        # A metadata-only repository change specifically exercises the
                        # attachment fence even when the test version is unchanged.
                        repo.save(
                            conn,
                            "attachments",
                            {
                                "id": "concurrent-attachment",
                                "testId": self.test["id"],
                                "name": "Synthetic evidence",
                                "mime": "application/pdf",
                                "storageName": "not-rendered.bin",
                                "updatedAt": "changed-during-render",
                            },
                            create=True,
                        )
                    conn.commit()
            finally:
                release.set()
            success, error = self.finish(thread, outcomes)
        self.assertFalse(success)
        self.assertIsInstance(error, StaleWriteError)
        self.assert_no_issue()

    def test_test_changed_during_generation_rejects_without_consuming_number(self):
        self.assert_change_rejected("test")

    def test_batch_changed_during_generation_rejects_without_consuming_number(self):
        self.assert_change_rejected("batch")

    def test_attachment_changed_during_generation_rejects_without_consuming_number(self):
        self.assert_change_rejected("attachment")

    def test_concurrent_issue_of_one_test_returns_one_report_and_audit(self):
        barrier = threading.Barrier(2)

        def generate(_snapshot, _root):
            barrier.wait(timeout=5)
            return PDF

        with patch.object(files, "generate", side_effect=generate):
            first, first_results = self.start_issue()
            second, second_results = self.start_issue()
            outcomes = [self.finish(first, first_results), self.finish(second, second_results)]
        self.assertTrue(all(success for success, _ in outcomes), repr(outcomes))
        self.assertEqual(outcomes[0][1]["id"], outcomes[1][1]["id"])
        self.assertEqual(len(self.reports()), 1)
        self.assertEqual(self.issued_audits(), 1)
        self.assertEqual(len(list(self.root.glob("*.pdf"))), 1)
        self.assertEqual(list(self.root.glob(".issue-*")), [])

    def test_different_tests_competing_for_a_number_reject_then_retry_without_gaps(self):
        raw = copy.deepcopy(sample_test())
        raw["id"] = "test-2"
        with self.connection() as conn:
            second_test = service.save_test(conn, ACTOR, {"item": raw})
            conn.commit()
        barrier = threading.Barrier(2)

        def generate(_snapshot, _root):
            barrier.wait(timeout=5)
            return PDF

        with patch.object(files, "generate", side_effect=generate):
            first, first_results = self.start_issue()
            second, second_results = self.start_issue(second_test)
            outcomes = [self.finish(first, first_results), self.finish(second, second_results)]
        self.assertEqual(sum(success for success, _ in outcomes), 1, repr(outcomes))
        self.assertIsInstance(next(value for success, value in outcomes if not success), StaleWriteError)
        with self.connection() as conn:
            remaining = next(item for item in repo.all_items(conn, "tests") if item["state"] == "draft")
        with patch.object(files, "generate", return_value=PDF):
            self.issue(remaining)
        reports = self.reports()
        self.assertEqual(sorted(int(item["number"][-2:]) for item in reports), [1, 2])
        self.assertEqual(len({item["number"] for item in reports}), 2)
        self.assertEqual(self.issued_audits(), 2)
        self.assertEqual(sorted(value for key, value in self.sequences().items() if key.startswith("report:")), [2])
        self.assertEqual(len(list(self.root.glob("*.pdf"))), 2)
        self.assertEqual(list(self.root.glob(".issue-*")), [])

    def test_conversion_failure_does_not_consume_number_or_create_report(self):
        with patch.object(files, "generate", side_effect=PdfRenderError("Synthetic conversion failed")):
            with self.assertRaises(PdfRenderError):
                self.issue()
        self.assert_no_issue()

    def test_rename_failure_rolls_back_report_number_state_and_audit(self):
        with (
            patch.object(files, "generate", return_value=PDF),
            patch.object(files.os, "replace", side_effect=OSError("Synthetic disk error")),
        ):
            with self.assertRaises(OSError):
                self.issue()
        self.assert_no_issue()

    def test_audit_failure_rolls_back_report_number_and_removes_staged_file(self):
        with (
            patch.object(files, "generate", return_value=PDF),
            patch.object(files, "audit", side_effect=RuntimeError("Synthetic audit error")),
        ):
            with self.assertRaises(RuntimeError):
                self.issue()
        self.assert_no_issue()

    def test_commit_acknowledgement_failure_preserves_a_referenced_file_and_idempotent_retry(self):
        with self.connection(CommitAcknowledgementLost) as conn, patch.object(files, "generate", return_value=PDF):
            conn.fail_commit = True
            with self.assertRaisesRegex(sqlite3.OperationalError, "acknowledgement lost"):
                files.issue(conn, ACTOR, self.test["id"], self.body(), self.root)
        reports = self.reports()
        self.assertEqual(len(reports), 1)
        self.assertEqual((self.root / reports[0]["storageName"]).read_bytes(), PDF)
        self.assertEqual(self.issued_audits(), 1)
        with patch.object(files, "generate", side_effect=AssertionError("Committed report must be reused")):
            self.assertEqual(self.issue()["id"], reports[0]["id"])
        self.assertEqual(self.issued_audits(), 1)
        self.assertEqual(list(self.root.glob(".issue-*")), [])
