import json
import sqlite3
import tempfile
import threading
import unittest
from contextlib import closing
from pathlib import Path
from unittest.mock import patch

from server_app.domains.reimbursement_ledger.service import (
    confirm_allocation,
    create_allocation,
    get_claim,
    get_obligation,
    list_obligations,
    reverse_allocation,
    save_claim,
    sync_settlement_obligations,
)
from server_app.domains.reimbursement_ledger.snapshot_sync import sync_same_version_obligation
from server_app.domains.workflow.application import save_billing_statement_workflow
from tests import test_reimbursement_ledger as fixture


class ObligationSnapshotSyncTests(unittest.TestCase):
    def setUp(self):
        self.base = fixture.ReimbursementLedgerTests()
        self.base.setUp()
        self.conn = self.base.conn
        self.obligation = self.conn.execute(
            "SELECT id FROM reimbursement_settlement_obligations WHERE workflow_id='workflow-a'"
        ).fetchone()[0]

    def tearDown(self):
        self.base.tearDown()

    def amount(self, amount):
        self.conn.execute(
            "UPDATE billing_statement_versions SET payload=json_set(payload,'$.statement.totalAmount',?) WHERE id='version-a'",
            (amount,),
        )
        self.conn.commit()

    def allocation(self, amount):
        claim = save_claim(
            self.conn,
            fixture.ADMIN,
            None,
            {
                "documentNumber": "SNAPSHOT-TEST",
                "fundingLines": [
                    {"fundBookNo": "F1", "fundingOwner": "测试", "reimbursementAmount": 150},
                ],
            },
        )["item"]
        item = create_allocation(
            self.conn,
            fixture.ADMIN,
            {
                "claimId": claim["id"],
                "fundingLineId": claim["fundingLines"][0]["id"],
                "obligationId": self.obligation,
                "amount": amount,
            },
        )["item"]
        return claim, item

    def row(self):
        return dict(
            self.conn.execute(
                "SELECT * FROM reimbursement_settlement_obligations WHERE id=?", (self.obligation,)
            ).fetchone()
        )

    def audit(self):
        return self.conn.execute(
            "SELECT * FROM audit_events WHERE action='reimbursement_ledger.obligation_snapshot_synced' ORDER BY rowid"
        ).fetchall()

    def test_unchanged_receivables_do_not_run_per_statement_allocation_queries(self):
        for index in range(60):
            self.base._insert_statement(
                f"workflow-scale-{index}", f"version-scale-{index}", "2026-06", f"PI-{index}", f"ETH-{index}", index
            )
        sync_settlement_obligations(self.conn)
        before = list(self.conn.iterdump())
        queries = []
        self.conn.set_trace_callback(queries.append)
        try:
            for actor in (fixture.ADMIN, fixture.ROOM_ADMIN):
                result = list_obligations(self.conn, actor, {"limit": 10, "offset": 10})
                self.assertEqual((len(result["items"]), result["page"]["total"]), (10, 62))
                self.assertEqual(get_obligation(self.conn, actor, self.obligation)["item"]["payableAmount"], 100)
        finally:
            self.conn.set_trace_callback(None)
        allocation_queries = [query for query in queries if "FROM reimbursement_allocations" in query]
        self.assertEqual(allocation_queries, [])
        self.assertEqual(list(self.conn.iterdump()), before)
        # A warm read must not conceal a later same-version snapshot change.
        self.amount(75)
        self.assertEqual(get_obligation(self.conn, fixture.ROOM_ADMIN, self.obligation)["item"]["payableAmount"], 75)
        self.assertEqual(len(self.audit()), 1)

    def test_unchanged_amount_still_backfills_pi_placeholder_with_confirmed_payment(self):
        _, allocation = self.allocation(80)
        confirm_allocation(self.conn, fixture.ADMIN, allocation["id"])
        self.conn.execute(
            "UPDATE reimbursement_settlement_obligations SET iacuc='pi::测试' WHERE id=?", (self.obligation,)
        )
        self.conn.commit()
        result = get_obligation(self.conn, fixture.ADMIN, self.obligation)["item"]
        self.assertEqual((result["iacuc"], result["payableAmount"], result["allocatedAmount"]), ("Z2026001", 100, 80))
        self.assertEqual(len(self.audit()), 0)

    def test_same_version_reprices_unconfirmed_only_and_audits_once(self):
        original = self.row()
        self.amount(60)
        sync_settlement_obligations(self.conn, fixture.ROOM_ADMIN)
        row = self.row()
        self.assertEqual((row["payable_amount"], row["outstanding_amount"], row["allocated_amount"]), (60, 60, 0))
        self.assertEqual(row["payable_amount_cents"], 6000)
        self.assertEqual(row["statement_version_id"], original["statement_version_id"])
        event = self.audit()[0]
        self.assertEqual(event["actor_user_id"], fixture.ROOM_ADMIN["id"])
        payload = json.loads(event["payload"])
        self.assertEqual((payload["before"]["payableAmount"], payload["after"]["payableAmount"]), (100, 60))
        before, changes = list(self.conn.iterdump()), self.conn.total_changes
        sync_settlement_obligations(self.conn, fixture.ADMIN)
        self.assertEqual(list(self.conn.iterdump()), before)
        self.assertEqual(self.conn.total_changes, changes)
        self.amount(0)
        result = get_obligation(self.conn, fixture.ADMIN, self.obligation)["item"]
        self.assertEqual((result["payableAmount"], result["outstandingAmount"], result["status"]), (0, 0, "settled"))
        self.assertEqual(len(self.audit()), 2)

    def test_draft_and_reversed_history_survive_lowered_limit(self):
        claim, allocation = self.allocation(90)
        confirm_allocation(self.conn, fixture.ADMIN, allocation["id"])
        reverse_allocation(self.conn, fixture.ADMIN, allocation["id"], "选错")
        draft = create_allocation(
            self.conn,
            fixture.ADMIN,
            {
                "claimId": claim["id"],
                "fundingLineId": claim["fundingLines"][0]["id"],
                "obligationId": self.obligation,
                "amount": 90,
            },
        )["item"]
        before = get_claim(self.conn, fixture.ADMIN, claim["id"])
        self.amount(50)
        list_obligations(self.conn, fixture.ADMIN, {})
        self.assertEqual(get_claim(self.conn, fixture.ADMIN, claim["id"]), before)
        with self.assertRaisesRegex(ValueError, "超过结算应收"):
            confirm_allocation(self.conn, fixture.ADMIN, draft["id"])
        self.assertEqual(self.row()["outstanding_amount"], 50)

    def test_confirmed_same_version_and_void_or_noncurrent_sources_are_untouched(self):
        _, allocation = self.allocation(80)
        confirm_allocation(self.conn, fixture.ADMIN, allocation["id"])
        original = self.row()
        self.amount(50)
        sync_settlement_obligations(self.conn)
        self.assertEqual(self.row(), original)
        self.assertFalse(sync_same_version_obligation(self.conn, self.obligation))
        self.assertEqual(len(self.audit()), 0)
        self.conn.execute(
            "UPDATE reimbursement_settlement_obligations SET status='void' WHERE id=?", (self.obligation,)
        )
        void = self.row()
        self.assertFalse(sync_same_version_obligation(self.conn, self.obligation))
        self.assertEqual(self.row(), void)
        self.conn.execute(
            "UPDATE reimbursement_settlement_obligations SET status='open' WHERE id=?", (self.obligation,)
        )
        self.conn.execute("UPDATE billing_workflows SET current_version_id='' WHERE id='workflow-a'")
        self.assertFalse(sync_same_version_obligation(self.conn, self.obligation))

    def test_iacuc_backfill_and_amount_sync_do_not_overwrite_each_other(self):
        self.conn.execute(
            "UPDATE reimbursement_settlement_obligations SET iacuc='pi::测试' WHERE id=?", (self.obligation,)
        )
        self.amount(60)
        sync_settlement_obligations(self.conn)
        self.assertEqual((self.row()["iacuc"], self.row()["payable_amount"]), ("Z2026001", 60))

    def test_audit_failure_rolls_back_and_preserves_caller_transaction(self):
        self.amount(60)
        original = self.row()
        with patch(
            "server_app.domains.reimbursement_ledger.snapshot_sync.write_audit_events",
            side_effect=RuntimeError("audit failed"),
        ):
            with self.assertRaisesRegex(RuntimeError, "audit failed"):
                sync_same_version_obligation(self.conn, self.obligation)
        self.assertEqual(self.row(), original)
        self.assertFalse(self.conn.in_transaction)
        self.conn.execute("UPDATE billing_workflows SET latest_event_at='caller-pending' WHERE id='workflow-b'")
        self.assertTrue(sync_same_version_obligation(self.conn, self.obligation))
        self.assertTrue(self.conn.in_transaction)
        self.conn.rollback()
        self.assertEqual(self.row(), original)
        self.assertEqual(len(self.audit()), 0)

    def test_commit_failure_rolls_back_amount_and_audit_without_masking_error(self):
        class CommitFailure(sqlite3.Connection):
            def commit(self):
                raise sqlite3.OperationalError("commit blocked")

        self.amount(60)
        original = self.row()
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "copy.sqlite"
            with closing(sqlite3.connect(path)) as copied:
                self.conn.backup(copied)
            with closing(sqlite3.connect(path, factory=CommitFailure)) as conn:
                conn.row_factory = sqlite3.Row
                with self.assertRaisesRegex(sqlite3.OperationalError, "commit blocked"):
                    sync_same_version_obligation(conn, self.obligation)
                self.assertFalse(conn.in_transaction)
                row = dict(
                    conn.execute(
                        "SELECT * FROM reimbursement_settlement_obligations WHERE id=?", (self.obligation,)
                    ).fetchone()
                )
                self.assertEqual(row, original)
                self.assertEqual(
                    conn.execute(
                        "SELECT COUNT(*) FROM audit_events WHERE action='reimbursement_ledger.obligation_snapshot_synced'"
                    ).fetchone()[0],
                    0,
                )

    def test_actual_generated_workflow_reuses_version_and_updates_receivable(self):
        statement = {
            "month": "2026-07",
            "pi": "技术服务负责人",
            "iacuc": "Z2026010",
            "sourceType": "pi_merged_technical_service",
            "totalAmount": 300,
        }
        workflow, version, *_ = save_billing_statement_workflow(self.conn, statement, [], fixture.ADMIN)
        self.conn.commit()
        sync_settlement_obligations(self.conn)
        obligation = self.conn.execute(
            "SELECT id FROM reimbursement_settlement_obligations WHERE workflow_id=?", (workflow["id"],)
        ).fetchone()[0]
        same, next_version, *_ = save_billing_statement_workflow(
            self.conn, {**statement, "totalAmount": 120}, [], fixture.ADMIN
        )
        self.conn.commit()
        self.assertEqual((same["id"], next_version["id"]), (workflow["id"], version["id"]))
        result = get_obligation(self.conn, fixture.ADMIN, obligation)["item"]
        self.assertEqual(
            (result["payableAmount"], result["outstandingAmount"], result["feeType"]), (120, 120, "technical_service")
        )

    def test_concurrent_confirmation_cannot_exceed_reconciled_amount(self):
        _, allocation = self.allocation(90)
        self.amount(50)
        self.conn.commit()
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "copy.sqlite"
            with closing(sqlite3.connect(path)) as target:
                self.conn.backup(target)
            started, finished = threading.Event(), threading.Event()
            outcomes = []
            with closing(sqlite3.connect(path)) as locking:
                locking.row_factory = sqlite3.Row
                locking.execute("BEGIN IMMEDIATE")
                self.assertTrue(sync_same_version_obligation(locking, self.obligation))

                def confirm():
                    with closing(sqlite3.connect(path, timeout=5)) as conn:
                        conn.row_factory = sqlite3.Row
                        started.set()
                        try:
                            confirm_allocation(conn, fixture.ADMIN, allocation["id"])
                        except ValueError:
                            outcomes.append("rejected")
                        else:
                            outcomes.append("confirmed")
                        finally:
                            finished.set()

                worker = threading.Thread(target=confirm)
                worker.start()
                self.assertTrue(started.wait(2))
                self.assertFalse(finished.wait(0.05))
                locking.commit()
                worker.join(5)
                self.assertFalse(worker.is_alive())
                self.assertEqual(outcomes, ["rejected"])
                row = locking.execute(
                    "SELECT payable_amount,allocated_amount,outstanding_amount FROM reimbursement_settlement_obligations WHERE id=?",
                    (self.obligation,),
                ).fetchone()
                self.assertEqual(tuple(row), (50, 0, 50))


if __name__ == "__main__":
    unittest.main()
