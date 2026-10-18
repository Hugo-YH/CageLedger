"""Candidate refresh must not overwrite a concurrent source invalidation."""

import sqlite3
import tempfile
import unittest
from pathlib import Path

import server
from server_app.domains.billing.candidate_calculation import CandidateCalculation
from server_app.domains.billing.candidates import _refresh_snapshot_keys, invalidate_settlement_candidate_snapshots
from server_app.repositories.billing_candidates import (
    get_billing_candidate_snapshot,
    mark_billing_candidate_snapshots_stale_by_pi,
    sync_billing_candidate_snapshot_registry,
)
from tests import test_reimbursement_ledger as ledger_fixture
from tests.test_billing_candidates import seed_quantity_sheet


class CandidateRefreshConcurrencyTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory(prefix="candidate-refresh-concurrency-")
        path = Path(self.directory.name) / "database.sqlite"
        self.reader = sqlite3.connect(path, timeout=1)
        self.reader.row_factory = sqlite3.Row
        self.reader.execute("PRAGMA journal_mode=WAL")
        server.initialize_schema(self.reader)
        seed_quantity_sheet(self.reader, "sheet-a", "2026-09", "A", "Z1")
        seed_quantity_sheet(self.reader, "sheet-b", "2026-09", "B", "Z2")
        sync_billing_candidate_snapshot_registry(self.reader, "quantity_sheet", "before")
        self.reader.commit()
        self.writer = sqlite3.connect(path, timeout=1)
        self.writer.row_factory = sqlite3.Row
        self.keys = [("2026-09", "A"), ("2026-09", "B")]

    def tearDown(self):
        self.reader.close()
        self.writer.close()
        self.directory.cleanup()

    def test_source_change_between_calculation_and_batch_publish_uses_current_amount(self):
        changed = False
        calls = []

        def calculate(month, pi):
            nonlocal changed
            calls.append(pi)
            if pi == "B" and not changed:
                changed = True
                self.writer.execute("UPDATE quantity_sheets SET updated_at='source-new' WHERE id='sheet-a'")
                invalidate_settlement_candidate_snapshots(self.writer, [(month, "A")], now="source-new")
                self.writer.commit()
            updated = self.reader.execute("SELECT updated_at FROM quantity_sheets WHERE pi=?", (pi,)).fetchone()[0]
            return {"totalAmount": 20 if updated == "source-new" else 10}

        _refresh_snapshot_keys(self.reader, self.keys, calculate, "quantity_sheet", None, None)
        self.reader.commit()
        snapshot = get_billing_candidate_snapshot(self.writer, "2026-09", "A", "quantity_sheet")
        self.assertEqual(snapshot["totalAmount"], 20)
        self.assertIn("source-new", snapshot["sourceFingerprint"])
        self.assertEqual(calls, ["A", "B", "A", "B"])

    def test_concurrent_snapshot_change_discards_prepared_headers_even_with_same_source_fingerprint(self):
        ledger_fixture.ReimbursementLedgerTests._insert_statement_on(
            self.reader, "workflow-a", "version-a", "2026-09", "A", "Z1", 10
        )
        self.reader.execute(
            "UPDATE billing_workflows SET source_type='pi_merged_quantity_sheet',iacuc='pi::A',workflow_status='statement_sent',payload=json_set(payload,'$.pi','A')"
        )
        self.reader.commit()
        changed = False

        def live(month, pi):
            nonlocal changed
            if not changed:
                changed = True
                self.writer.execute(
                    "UPDATE billing_statement_versions SET payload=json_set(payload,'$.statement.totalAmount',20) WHERE id='version-a'"
                )
                mark_billing_candidate_snapshots_stale_by_pi(self.writer, "quantity_sheet", "A", "snapshot-new")
                self.writer.commit()
            return {"totalAmount": 30}

        calculation = CandidateCalculation(self.reader, live)
        _refresh_snapshot_keys(
            self.reader,
            self.keys,
            lambda month, pi: calculation(month, pi),
            "quantity_sheet",
            None,
            calculation.prepare,
        )
        self.reader.commit()
        snapshot = get_billing_candidate_snapshot(self.writer, "2026-09", "A", "quantity_sheet")
        self.assertEqual(snapshot["totalAmount"], 20)

    def test_refresh_preserves_an_existing_callers_transaction_and_rollback(self):
        self.reader.execute("UPDATE quantity_sheets SET updated_at='uncommitted' WHERE id='sheet-a'")
        _refresh_snapshot_keys(self.reader, self.keys, lambda *_: {"totalAmount": 7}, "quantity_sheet", None, None)
        self.assertTrue(self.reader.in_transaction)
        self.reader.rollback()
        self.assertIsNone(get_billing_candidate_snapshot(self.writer, "2026-09", "A", "quantity_sheet")["totalAmount"])
        self.assertEqual(
            self.writer.execute("SELECT updated_at FROM quantity_sheets WHERE id='sheet-a'").fetchone()[0],
            "sheet-a-updated",
        )

    def test_prepare_callback_may_start_a_caller_owned_transaction(self):
        def prepare(_keys):
            self.reader.execute("UPDATE quantity_sheets SET manager='prepared' WHERE id='sheet-a'")

        _refresh_snapshot_keys(self.reader, self.keys, lambda *_: {"totalAmount": 7}, "quantity_sheet", None, prepare)
        self.assertTrue(self.reader.in_transaction)
        self.reader.rollback()
        self.assertEqual(
            self.writer.execute("SELECT manager FROM quantity_sheets WHERE id='sheet-a'").fetchone()[0], ""
        )
        self.assertIsNone(get_billing_candidate_snapshot(self.writer, "2026-09", "A", "quantity_sheet")["totalAmount"])

    def test_concurrent_source_deletion_does_not_resurrect_its_candidate(self):
        changed = False

        def calculate(month, pi):
            nonlocal changed
            if pi == "B" and not changed:
                changed = True
                self.writer.execute("DELETE FROM quantity_sheets WHERE id='sheet-a'")
                invalidate_settlement_candidate_snapshots(self.writer, [(month, "A")], now="deleted")
                self.writer.commit()
            return {"totalAmount": 10}

        _refresh_snapshot_keys(self.reader, self.keys, calculate, "quantity_sheet", None, None)
        self.reader.commit()
        self.assertIsNone(get_billing_candidate_snapshot(self.writer, "2026-09", "A", "quantity_sheet"))
        self.assertEqual(
            get_billing_candidate_snapshot(self.writer, "2026-09", "B", "quantity_sheet")["totalAmount"], 10
        )
