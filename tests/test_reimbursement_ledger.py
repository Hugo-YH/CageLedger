import json
import sqlite3
import unittest

from server_app.domains.reimbursement_ledger.service import (
    confirm_allocation,
    create_allocation,
    delete_claim,
    get_claim,
    list_obligations,
    reverse_allocation,
    save_claim,
    sync_settlement_obligations,
)
from server_app.legacy import initialize_schema

ADMIN = {"id": "admin", "username": "admin", "displayName": "系统管理员", "role": "admin", "roomIds": []}
ROOM_ADMIN = {"id": "room", "username": "room", "displayName": "房间管理员", "role": "room_admin", "roomIds": []}


class ReimbursementLedgerTests(unittest.TestCase):
    def setUp(self):
        self.conn = sqlite3.connect(":memory:")
        self.conn.row_factory = sqlite3.Row
        self.conn.execute("PRAGMA foreign_keys=ON")
        initialize_schema(self.conn)
        self._insert_statement("workflow-a", "version-a", "2026-06", "张教授", "Z2026001", 100)
        self._insert_statement("workflow-b", "version-b", "2026-06", "李教授", "Z2026002", 80)
        sync_settlement_obligations(self.conn)

    def tearDown(self):
        self.conn.close()

    def _insert_statement(self, workflow_id, version_id, month, pi, iacuc, amount, version_no=1):
        workflow = {
            "id": workflow_id,
            "iacuc": iacuc,
            "month": month,
            "sourceType": "quantity_sheet",
            "currentVersionId": version_id,
            "currentVersionNo": version_no,
        }
        version = {
            "id": version_id,
            "workflowId": workflow_id,
            "versionNo": version_no,
            "versionStatus": "active",
            "workflowStatus": "statement_generated",
            "generatedAt": "2026-06-30T12:00:00+00:00",
            "statement": {"pi": pi, "iacuc": iacuc, "iacucs": [iacuc], "totalAmount": amount},
        }
        self.conn.execute(
            """INSERT INTO billing_workflows (id, business_key, iacuc, month, source_type, workflow_status, current_version_id, current_version_no, latest_event_at, payload)
               VALUES (?, ?, ?, ?, 'quantity_sheet', 'statement_generated', ?, ?, '', ?)""",
            (workflow_id, f"{month}:{iacuc}", iacuc, month, version_id, version_no, json.dumps(workflow)),
        )
        self.conn.execute(
            """INSERT INTO billing_statement_versions (id, workflow_id, version_no, version_status, workflow_status, generated_at, voided_at, created_by, payload)
               VALUES (?, ?, ?, 'active', 'statement_generated', ?, NULL, 'admin', ?)""",
            (version_id, workflow_id, version_no, version["generatedAt"], json.dumps(version)),
        )
        self.conn.commit()

    def _obligations(self):
        return list_obligations(self.conn, ADMIN, {"limit": 20, "offset": 0})["items"]

    def test_one_funding_line_can_reconcile_multiple_source_principals(self):
        claim = save_claim(
            self.conn,
            ROOM_ADMIN,
            None,
            {
                "documentNumber": "BXD-001",
                "fundingLines": [{"fundBookNo": "F-01", "fundingOwner": "王经费负责人", "reimbursementAmount": 180}],
            },
        )["item"]
        line_id = claim["fundingLines"][0]["id"]
        first, second = self._obligations()
        allocation_a = create_allocation(
            self.conn,
            ROOM_ADMIN,
            {"claimId": claim["id"], "fundingLineId": line_id, "obligationId": first["id"], "amount": 100},
        )["item"]
        allocation_b = create_allocation(
            self.conn,
            ROOM_ADMIN,
            {"claimId": claim["id"], "fundingLineId": line_id, "obligationId": second["id"], "amount": 80},
        )["item"]
        confirm_allocation(self.conn, ADMIN, allocation_a["id"])
        confirm_allocation(self.conn, ADMIN, allocation_b["id"])
        detail = get_claim(self.conn, ADMIN, claim["id"])["item"]
        allocations = detail["fundingLines"][0]["allocations"]
        self.assertEqual({item["sourcePi"] for item in allocations}, {"张教授", "李教授"})
        self.assertEqual(detail["fundingOwner"], "王经费负责人")
        self.assertEqual(detail["unallocatedAmount"], 0)

    def test_delete_claim_removes_claim_and_draft_allocations(self):
        claim = save_claim(
            self.conn,
            ROOM_ADMIN,
            None,
            {
                "documentNumber": "BXD-DELETE-1",
                "fundingLines": [{"fundBookNo": "F-01", "fundingOwner": "王经费负责人", "reimbursementAmount": 100}],
            },
        )["item"]
        line_id = claim["fundingLines"][0]["id"]
        obligation = self._obligations()[0]
        create_allocation(
            self.conn,
            ROOM_ADMIN,
            {"claimId": claim["id"], "fundingLineId": line_id, "obligationId": obligation["id"], "amount": 60},
        )
        result = delete_claim(self.conn, ROOM_ADMIN, claim["id"])
        self.assertTrue(result["ok"])
        with self.assertRaises(LookupError):
            get_claim(self.conn, ROOM_ADMIN, claim["id"])
        remaining = self.conn.execute(
            "SELECT COUNT(*) FROM reimbursement_allocations WHERE obligation_id = ?", (obligation["id"],)
        ).fetchone()[0]
        self.assertEqual(remaining, 0)
        self.conn.rollback()

    def test_delete_claim_rejects_confirmed_allocations(self):
        claim = save_claim(
            self.conn,
            ROOM_ADMIN,
            None,
            {
                "documentNumber": "BXD-DELETE-2",
                "fundingLines": [{"fundBookNo": "F-02", "fundingOwner": "王经费负责人", "reimbursementAmount": 100}],
            },
        )["item"]
        line_id = claim["fundingLines"][0]["id"]
        obligation = self._obligations()[0]
        allocation = create_allocation(
            self.conn,
            ROOM_ADMIN,
            {"claimId": claim["id"], "fundingLineId": line_id, "obligationId": obligation["id"], "amount": 60},
        )["item"]
        confirm_allocation(self.conn, ADMIN, allocation["id"])
        with self.assertRaises(ValueError):
            delete_claim(self.conn, ROOM_ADMIN, claim["id"])
        self.conn.rollback()

    def test_confirmed_amount_cannot_exceed_funding_line_or_receivable(self):
        claim = save_claim(
            self.conn,
            ADMIN,
            None,
            {
                "documentNumber": "BXD-002",
                "fundingLines": [{"fundBookNo": "F-02", "fundingOwner": "赵负责人", "reimbursementAmount": 50}],
            },
        )["item"]
        obligation = self._obligations()[0]
        allocation = create_allocation(
            self.conn,
            ADMIN,
            {
                "claimId": claim["id"],
                "fundingLineId": claim["fundingLines"][0]["id"],
                "obligationId": obligation["id"],
                "amount": 60,
            },
        )["item"]
        with self.assertRaisesRegex(ValueError, "经费明细"):
            confirm_allocation(self.conn, ADMIN, allocation["id"])

    def test_reversal_restores_balances(self):
        claim = save_claim(
            self.conn,
            ADMIN,
            None,
            {
                "documentNumber": "BXD-003",
                "fundingLines": [{"fundBookNo": "F-03", "fundingOwner": "钱负责人", "reimbursementAmount": 100}],
            },
        )["item"]
        obligation = self._obligations()[0]
        allocation = create_allocation(
            self.conn,
            ADMIN,
            {
                "claimId": claim["id"],
                "fundingLineId": claim["fundingLines"][0]["id"],
                "obligationId": obligation["id"],
                "amount": 100,
            },
        )["item"]
        confirm_allocation(self.conn, ADMIN, allocation["id"])
        reverse_allocation(self.conn, ADMIN, allocation["id"], "报销单据录入错误")
        refreshed = next(item for item in self._obligations() if item["id"] == obligation["id"])
        self.assertEqual(refreshed["outstandingAmount"], 100)
        self.assertEqual(get_claim(self.conn, ADMIN, claim["id"])["item"]["unallocatedAmount"], 100)

    def test_new_version_with_confirmed_allocation_creates_adjustment_obligation(self):
        claim = save_claim(
            self.conn,
            ADMIN,
            None,
            {
                "documentNumber": "BXD-004",
                "fundingLines": [{"fundBookNo": "F-04", "fundingOwner": "孙负责人", "reimbursementAmount": 100}],
            },
        )["item"]
        original = next(item for item in self._obligations() if item["iacuc"] == "Z2026001")
        allocation = create_allocation(
            self.conn,
            ADMIN,
            {
                "claimId": claim["id"],
                "fundingLineId": claim["fundingLines"][0]["id"],
                "obligationId": original["id"],
                "amount": 100,
            },
        )["item"]
        confirm_allocation(self.conn, ADMIN, allocation["id"])
        self.conn.execute(
            "UPDATE billing_workflows SET current_version_id = 'version-a2', current_version_no = 2 WHERE id = 'workflow-a'"
        )
        version = {
            "id": "version-a2",
            "workflowId": "workflow-a",
            "versionNo": 2,
            "versionStatus": "active",
            "workflowStatus": "statement_generated",
            "generatedAt": "2026-07-01T12:00:00+00:00",
            "statement": {"pi": "张教授", "iacuc": "Z2026001", "totalAmount": 130},
        }
        self.conn.execute(
            "INSERT INTO billing_statement_versions (id, workflow_id, version_no, version_status, workflow_status, generated_at, voided_at, created_by, payload) VALUES (?, ?, 2, 'active', 'statement_generated', ?, NULL, 'admin', ?)",
            ("version-a2", "workflow-a", version["generatedAt"], json.dumps(version)),
        )
        self.conn.commit()
        sync_settlement_obligations(self.conn)
        adjustments = [item for item in self._obligations() if item["obligationKind"] == "adjustment"]
        self.assertEqual(len(adjustments), 1)
        self.assertEqual(adjustments[0]["payableAmount"], 30)


if __name__ == "__main__":
    unittest.main()
