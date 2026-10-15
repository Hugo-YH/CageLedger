import json
import sqlite3
import unittest
from unittest.mock import patch

from server_app.cache import invalidate_data_cache_prefixes
from server_app.domains.reimbursement_ledger.listing import OBLIGATION_LIST_COLUMNS, list_column_options
from server_app.domains.reimbursement_ledger.repository import refresh_obligation_balance
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
from server_app.domains.workflow.application import save_billing_statement_workflow
from server_app.legacy import initialize_schema
from tests import test_workflow_withdrawal_permissions as workflow_fixture


class WorkflowObligationCancellationTests(unittest.TestCase):
    def setUp(self):
        invalidate_data_cache_prefixes("billing_", "reimbursement_", "quantity_sheets::", "audit_events::")
        self.conn = sqlite3.connect(":memory:")
        self.conn.row_factory = sqlite3.Row
        self.conn.execute("PRAGMA foreign_keys=ON")
        initialize_schema(self.conn)
        self.workflow, self.version, *_ = save_billing_statement_workflow(
            self.conn,
            {
                "id": "seed",
                "month": "2026-07",
                "pi": "测试负责人",
                "iacuc": "Z2026001",
                "sourceType": "quantity_sheet",
                "totalAmount": 100,
            },
            [],
            workflow_fixture.OWNER,
        )
        self.conn.commit()
        sync_settlement_obligations(self.conn)
        self.obligation = list_obligations(self.conn, workflow_fixture.ADMIN, {})["items"][0]

    def tearDown(self):
        self.conn.close()
        invalidate_data_cache_prefixes("billing_", "reimbursement_", "quantity_sheets::", "audit_events::")

    def delete(self, actor=workflow_fixture.ADMIN):
        handler = workflow_fixture.Handler(actor, {"note": "结算录入错误"})
        with patch("server_app.web.workflow_actions.connect_db", return_value=self.conn):
            handler.handle_billing_workflow_delete(self.workflow["id"])
        return handler

    def allocation(self):
        claim = save_claim(
            self.conn,
            workflow_fixture.ADMIN,
            None,
            {
                "documentNumber": "cancel-test",
                "fundingLines": [{"fundBookNo": "F1", "fundingOwner": "经费负责人", "reimbursementAmount": 100}],
            },
        )["item"]
        draft = create_allocation(
            self.conn,
            workflow_fixture.ADMIN,
            {
                "claimId": claim["id"],
                "fundingLineId": claim["fundingLines"][0]["id"],
                "obligationId": self.obligation["id"],
                "amount": 50,
            },
        )["item"]
        return claim, draft

    def test_owner_cancellation_removes_unallocated_obligation_and_audits(self):
        self.assertEqual(self.delete(workflow_fixture.OWNER).status, 200)
        self.assertEqual(
            self.conn.execute("SELECT COUNT(*) FROM reimbursement_settlement_obligations").fetchone()[0], 0
        )
        self.assertEqual(list_obligations(self.conn, workflow_fixture.ADMIN, {})["page"]["total"], 0)
        event = json.loads(
            self.conn.execute(
                "SELECT payload FROM audit_events WHERE action='reimbursement_ledger.obligation_cancelled'"
            ).fetchone()[0]
        )
        self.assertEqual(event["before"]["payableAmount"], 100)
        self.assertIsNone(event["after"])
        self.assertEqual(event["actorUserId"], workflow_fixture.OWNER["id"])

    def test_technical_cancellation_does_not_remove_feeding_obligation(self):
        feeding_id = self.obligation["id"]
        self.workflow, self.version, *_ = save_billing_statement_workflow(
            self.conn,
            {
                "id": "technical-seed",
                "month": "2026-07",
                "pi": "测试负责人",
                "iacuc": "Z2026001",
                "sourceType": "pi_merged_technical_service",
                "totalAmount": 300,
            },
            [],
            workflow_fixture.OWNER,
        )
        self.conn.commit()
        sync_settlement_obligations(self.conn)
        self.assertEqual(self.delete(workflow_fixture.OWNER).status, 200)
        items = list_obligations(self.conn, workflow_fixture.ADMIN, {})["items"]
        self.assertEqual([item["id"] for item in items], [feeding_id])
        self.assertEqual(items[0]["payableAmount"], 100)

    def test_confirmed_allocation_blocks_cancellation_without_mutation(self):
        claim, draft = self.allocation()
        confirm_allocation(self.conn, workflow_fixture.ADMIN, draft["id"])
        before = list(self.conn.iterdump())
        result = self.delete()
        self.assertEqual(result.status, 400)
        self.assertIn("先撤销相关核销", result.response["error"])
        self.assertEqual(list(self.conn.iterdump()), before)
        self.assertEqual(get_claim(self.conn, workflow_fixture.ADMIN, claim["id"])["item"]["allocatedAmount"], 50)

    def test_draft_history_survives_but_cannot_be_confirmed_after_cancellation(self):
        claim, draft = self.allocation()
        before = get_claim(self.conn, workflow_fixture.ADMIN, claim["id"])["item"]
        self.assertEqual(self.delete().status, 200)
        self.assertEqual(get_claim(self.conn, workflow_fixture.ADMIN, claim["id"])["item"], before)
        with self.assertRaisesRegex(ValueError, "已撤销或来源不存在"):
            confirm_allocation(self.conn, workflow_fixture.ADMIN, draft["id"])
        with self.assertRaisesRegex(ValueError, "已撤销或来源不存在"):
            create_allocation(
                self.conn,
                workflow_fixture.ADMIN,
                {
                    "claimId": claim["id"],
                    "fundingLineId": claim["fundingLines"][0]["id"],
                    "obligationId": self.obligation["id"],
                    "amount": 10,
                },
            )
        self.assertEqual(list_obligations(self.conn, workflow_fixture.ADMIN, {})["page"]["total"], 0)

    def test_reversed_history_is_preserved_and_balance_refresh_does_not_revive_it(self):
        claim, draft = self.allocation()
        confirm_allocation(self.conn, workflow_fixture.ADMIN, draft["id"])
        reverse_allocation(self.conn, workflow_fixture.ADMIN, draft["id"], "核销选错")
        before = get_claim(self.conn, workflow_fixture.ADMIN, claim["id"])["item"]
        self.assertEqual(self.delete().status, 200)
        refresh_obligation_balance(self.conn, self.obligation["id"])
        row = self.conn.execute("SELECT status,outstanding_amount FROM reimbursement_settlement_obligations").fetchone()
        self.assertEqual(tuple(row), ("void", 0))
        self.assertEqual(get_claim(self.conn, workflow_fixture.ADMIN, claim["id"])["item"], before)
        self.assertEqual(self.conn.execute("PRAGMA foreign_key_check").fetchall(), [])

    def test_legacy_orphan_is_excluded_from_list_options_details_and_confirmation(self):
        claim, draft = self.allocation()
        self.conn.execute("DELETE FROM billing_workflows WHERE id=?", (self.workflow["id"],))
        self.conn.commit()
        self.assertEqual(list_obligations(self.conn, workflow_fixture.ADMIN, {})["page"]["total"], 0)
        options = list_column_options(
            self.conn, "reimbursement_settlement_obligations", OBLIGATION_LIST_COLUMNS, {}, "sourcePi"
        )
        self.assertEqual(options["items"], [])
        with self.assertRaisesRegex(LookupError, "不存在或已撤销"):
            get_obligation(self.conn, workflow_fixture.ADMIN, self.obligation["id"])
        with self.assertRaisesRegex(ValueError, "来源不存在"):
            confirm_allocation(self.conn, workflow_fixture.ADMIN, draft["id"])
        self.assertEqual(
            self.conn.execute("SELECT COUNT(*) FROM reimbursement_settlement_obligations").fetchone()[0], 1
        )
        self.assertEqual(get_claim(self.conn, workflow_fixture.ADMIN, claim["id"])["item"]["allocatedAmount"], 0)

    def test_failure_after_deletion_rolls_back_obligations_workflow_and_audits(self):
        before = list(self.conn.iterdump())
        with patch("server_app.web.workflow_actions.write_audit_events", side_effect=RuntimeError("audit failed")):
            with self.assertRaisesRegex(RuntimeError, "audit failed"):
                self.delete()
        self.assertEqual(list(self.conn.iterdump()), before)


if __name__ == "__main__":
    unittest.main()
