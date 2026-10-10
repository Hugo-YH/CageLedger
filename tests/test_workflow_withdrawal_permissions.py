import copy
import json
import sqlite3
import unittest
from http import HTTPStatus
from unittest.mock import patch

from server_app.cache import cache_get, cache_set, invalidate_data_cache_prefixes
from server_app.domains.workflow.application import save_billing_statement_workflow, update_workflow_status
from server_app.domains.workflow.facade import get_billing_version, get_billing_workflow
from server_app.domains.workflow.permissions import with_withdrawal_capabilities, withdrawal_capabilities
from server_app.legacy import initialize_schema
from server_app.web.workflow_actions import WorkflowActionsMixin

ADMIN = {"id": "admin", "username": "admin", "displayName": "系统管理员", "role": "admin"}
OWNER = {"id": "room-a", "username": "a", "displayName": "登记人员", "role": "room_admin"}
OTHER = {**OWNER, "id": "room-b", "username": "b"}


class Handler(WorkflowActionsMixin):
    def __init__(self, actor, body):
        self.actor, self.body = actor, body
        self.status, self.response = None, None

    def require_user(self):
        return self.actor

    def read_json_body(self):
        return self.body

    def read_optional_json_body(self):
        return self.body or {}

    def send_json(self, response, status=HTTPStatus.OK):
        self.status, self.response = int(status), response


class WorkflowWithdrawalPermissionTests(unittest.TestCase):
    def setUp(self):
        invalidate_data_cache_prefixes("billing_", "reimbursement_", "quantity_sheets::", "audit_events::")
        self.conn = sqlite3.connect(":memory:")
        self.conn.row_factory = sqlite3.Row
        self.conn.execute("PRAGMA foreign_keys=ON")
        initialize_schema(self.conn)
        self.conn.commit()
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
            OWNER,
        )
        self.conn.commit()
        self.workflow_id = self.workflow["id"]

    def tearDown(self):
        self.conn.close()
        invalidate_data_cache_prefixes("billing_", "reimbursement_", "quantity_sheets::", "audit_events::")

    def advance(self, status, actor=OWNER, **kwargs):
        result = update_workflow_status(self.conn, self.workflow_id, status, actor, "准备测试状态", **kwargs)
        self.conn.commit()
        return result

    def request(self, actor, *, delete=False, note="金额核对有误", status="statement_generated"):
        body = {"workflowId": self.workflow_id, "toStatus": status, "note": note}
        handler = Handler(actor, body)
        with patch("server_app.web.workflow_actions.connect_db", return_value=self.conn):
            if delete:
                handler.handle_billing_workflow_delete(self.workflow_id)
            else:
                handler.handle_billing_workflow_advance()
        return handler

    def state(self):
        return list(self.conn.iterdump())

    def test_own_generated_can_cancel_and_audit_survives_tree_deletion(self):
        cache_set("billing_workflows::withdraw-test", {"stale": True})
        response = self.request(OWNER, delete=True)
        self.assertEqual(response.status, 200)
        self.assertIsNone(get_billing_workflow(self.conn, self.workflow_id))
        self.assertIsNone(get_billing_version(self.conn, self.version["id"]))
        self.assertEqual(self.conn.execute("SELECT COUNT(*) FROM billing_workflow_events").fetchone()[0], 0)
        audit = json.loads(
            self.conn.execute("SELECT payload FROM audit_events ORDER BY rowid DESC LIMIT 1").fetchone()[0]
        )
        self.assertEqual(audit["actorUserId"], OWNER["id"])
        self.assertIn("金额核对有误", audit["message"])
        self.assertEqual(audit["before"]["currentVersionId"], self.version["id"])
        self.assertIsNone(cache_get("billing_workflows::withdraw-test"))

    def test_own_sent_can_revert_with_reason_and_version_event_audit(self):
        self.advance("statement_sent")
        response = self.request(OWNER)
        self.assertEqual(response.status, 200)
        self.assertEqual(get_billing_workflow(self.conn, self.workflow_id)["workflowStatus"], "statement_generated")
        statement = get_billing_version(self.conn, self.version["id"])["statement"]
        self.assertEqual(statement["revertedBy"]["id"], OWNER["id"])
        self.assertEqual(statement["totalAmount"], 100)
        self.assertEqual(response.response["event"]["note"], "金额核对有误")
        audit = json.loads(
            self.conn.execute("SELECT payload FROM audit_events ORDER BY rowid DESC LIMIT 1").fetchone()[0]
        )
        self.assertEqual(audit["after"]["event"]["note"], "金额核对有误")
        self.assertEqual(audit["actorUserId"], OWNER["id"])
        before = self.state()
        self.assertEqual(self.request(OWNER).status, 403)
        self.assertEqual(self.state(), before)

    def test_denials_leave_database_unchanged_even_with_same_display_name(self):
        for delete in (True, False):
            if not delete:
                self.advance("statement_sent")
            before = self.state()
            self.assertEqual(self.request(OTHER, delete=delete).status, 403)
            self.assertEqual(self.state(), before)

    def test_actor_must_be_latest_initiator_not_generator(self):
        self.advance("statement_sent", OTHER)
        self.assertEqual(self.request(OWNER).status, 403)
        self.assertEqual(self.request(OTHER).status, 200)

    def test_missing_reason_and_wrong_action_are_rejected_without_writes(self):
        before = self.state()
        self.assertEqual(self.request(OWNER, delete=True, note=" ").status, 400)
        self.assertEqual(self.state(), before)
        self.advance("statement_sent")
        before = self.state()
        self.assertEqual(self.request(OWNER, note=" ").status, 400)
        self.assertEqual(self.request(OWNER, delete=True).status, 403)
        self.assertEqual(self.request(OWNER, status="statement_archived").status, 403)
        self.assertEqual(self.state(), before)

    def test_archive_lock_and_admin_boundaries(self):
        self.advance("statement_sent")
        self.advance("statement_archived", ADMIN, registration={"signedStatementReturned": True})
        before = self.state()
        self.assertEqual(self.request(OWNER).status, 403)
        self.assertEqual(self.request(OWNER, status="statement_sent").status, 403)
        self.assertEqual(self.request(OWNER, delete=True).status, 403)
        self.assertEqual(self.state(), before)
        self.assertEqual(self.request(ADMIN, status="statement_sent").status, 200)
        self.advance("statement_locked", ADMIN)
        before = self.state()
        self.assertEqual(self.request(OWNER).status, 403)
        self.assertEqual(self.request(ADMIN).status, 403)
        self.assertEqual(self.request(ADMIN, delete=True).status, 400)
        self.assertEqual(self.state(), before)
        authorized = {**ADMIN, "billingLockAllowed": True}
        self.assertEqual(self.request(authorized, status="statement_archived").status, 200)

    def test_legacy_event_ids_work_but_names_or_old_versions_cannot_claim_ownership(self):
        self.assertTrue(withdrawal_capabilities(self.conn, OWNER, [self.workflow_id])[self.workflow_id])
        self.advance("statement_sent", OTHER)
        self.conn.execute("UPDATE billing_workflows SET payload=json_remove(payload, '$.sentBy')")
        self.conn.commit()
        self.assertTrue(withdrawal_capabilities(self.conn, OTHER, [self.workflow_id])[self.workflow_id])
        self.assertFalse(withdrawal_capabilities(self.conn, OWNER, [self.workflow_id])[self.workflow_id])
        self.conn.execute("UPDATE billing_workflow_events SET payload=json_remove(payload, '$.actor.id')")
        self.conn.commit()
        self.assertFalse(withdrawal_capabilities(self.conn, OTHER, [self.workflow_id])[self.workflow_id])
        self.assertTrue(withdrawal_capabilities(self.conn, ADMIN, [self.workflow_id])[self.workflow_id])

    def test_revision_and_reinitiation_use_current_version_and_latest_actor(self):
        self.advance("statement_sent")
        workflow, version, *_ = save_billing_statement_workflow(
            self.conn,
            {**self.version["statement"], "totalAmount": 120},
            [],
            OTHER,
        )
        self.conn.commit()
        self.assertNotEqual(version["id"], self.version["id"])
        self.assertTrue(withdrawal_capabilities(self.conn, OTHER, [workflow["id"]])[workflow["id"]])
        self.assertFalse(withdrawal_capabilities(self.conn, OWNER, [workflow["id"]])[workflow["id"]])
        self.advance("statement_sent", OWNER)
        self.assertEqual(self.request(OWNER).status, 200)
        self.advance("statement_sent", OTHER)
        self.assertEqual(self.request(OWNER).status, 403)
        self.assertEqual(self.request(OTHER).status, 200)

    def test_capability_projection_never_contaminates_shared_cached_data(self):
        items = [{"workflowId": self.workflow_id, "workflowStatus": "statement_generated"}]
        before = copy.deepcopy(items)
        self.assertTrue(with_withdrawal_capabilities(self.conn, OWNER, items, id_key="workflowId")[0]["canWithdraw"])
        self.assertFalse(with_withdrawal_capabilities(self.conn, OTHER, items, id_key="workflowId")[0]["canWithdraw"])
        self.assertEqual(items, before)
        self.assertEqual(
            with_withdrawal_capabilities(self.conn, OWNER, [{"workflowId": "missing"}], id_key="workflowId")[0][
                "canWithdraw"
            ],
            False,
        )

    def test_admin_empty_delete_request_remains_compatible(self):
        response = self.request(ADMIN, delete=True, note="")
        self.assertEqual(response.status, 200)


if __name__ == "__main__":
    unittest.main()
