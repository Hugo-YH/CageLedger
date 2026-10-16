import copy
import json
import sqlite3
import unittest
from http import HTTPStatus
from unittest.mock import patch

from server_app.cache import cache_get, cache_set, invalidate_data_cache_prefixes
from server_app.domains.administration import audit_event, write_audit_events
from server_app.domains.workflow.application import (
    record_archived_reimbursement,
    save_billing_statement_workflow,
    update_workflow_status,
)
from server_app.domains.workflow.facade import get_billing_version, get_billing_workflow
from server_app.domains.workflow.permissions import with_withdrawal_capabilities, withdrawal_capabilities
from server_app.legacy import initialize_schema
from server_app.repositories.audit_storage import read_payload as read_audit_payload
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

    def request(self, actor, *, delete=False, note="金额核对有误", status="statement_generated", registration=None):
        body = {"workflowId": self.workflow_id, "toStatus": status, "note": note}
        if registration is not None:
            body["registration"] = registration
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
            read_audit_payload(
                self.conn, self.conn.execute("SELECT id FROM audit_events ORDER BY rowid DESC LIMIT 1").fetchone()[0]
            )
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
            read_audit_payload(
                self.conn, self.conn.execute("SELECT id FROM audit_events ORDER BY rowid DESC LIMIT 1").fetchone()[0]
            )
        )
        self.assertEqual(audit["after"]["event"]["note"], "金额核对有误")
        self.assertEqual(audit["actorUserId"], OWNER["id"])
        before = self.state()
        self.assertEqual(self.request(OWNER).status, 403)
        self.assertEqual(self.state(), before)

    def test_lock_operator_can_cancel_foreign_generated_workflow_and_audit(self):
        operator = {**OTHER, "billingLockAllowed": True}
        self.assertTrue(withdrawal_capabilities(self.conn, operator, [self.workflow_id])[self.workflow_id])
        self.assertEqual(self.request(operator, delete=True).status, 200)
        self.assertIsNone(get_billing_workflow(self.conn, self.workflow_id))
        audit = json.loads(
            read_audit_payload(
                self.conn,
                self.conn.execute("SELECT id FROM audit_events WHERE action='billing_workflow.deleted'").fetchone()[0],
            )
        )
        self.assertEqual(audit["actorUserId"], operator["id"])
        self.assertIn("金额核对有误", audit["message"])

    def test_lock_operator_withdraws_foreign_workflow_without_bypassing_state_or_reason(self):
        operator = {**OTHER, "billingLockAllowed": True}
        before = self.state()
        self.assertEqual(self.request(operator, delete=True, note=" ").status, 400)
        self.assertEqual(self.state(), before)
        self.advance("statement_sent")
        self.advance("statement_archived", OWNER, registration={"signedStatementReturned": True})
        self.assertTrue(withdrawal_capabilities(self.conn, operator, [self.workflow_id])[self.workflow_id])
        before = self.state()
        for delete, status, note in [
            (True, "statement_generated", "原因"),
            (False, "statement_generated", "原因"),
            (False, "statement_sent", " "),
        ]:
            with self.subTest(delete=delete, status=status, note=note):
                self.assertIn(self.request(operator, delete=delete, status=status, note=note).status, (400, 403))
                self.assertEqual(self.state(), before)
        self.assertEqual(self.request(operator, status="statement_sent").status, 200)
        before = self.state()
        self.assertEqual(self.request(operator, delete=True).status, 403)
        self.assertEqual(self.request(operator, note=" ").status, 400)
        self.assertEqual(self.state(), before)
        response = self.request(operator)
        self.assertEqual(response.status, 200)
        self.assertEqual(response.response["event"]["actor"]["id"], operator["id"])
        self.assertEqual(response.response["event"]["note"], "金额核对有误")
        self.assertEqual(get_billing_workflow(self.conn, self.workflow_id)["workflowStatus"], "statement_generated")
        self.assertEqual(self.request(OTHER, delete=True).status, 403)

    def test_lock_operator_must_unlock_foreign_workflow_before_withdrawing(self):
        operator = {**OTHER, "billingLockAllowed": True}
        self.advance("statement_sent")
        self.advance("statement_locked", ADMIN)
        self.assertFalse(withdrawal_capabilities(self.conn, operator, [self.workflow_id])[self.workflow_id])
        before = self.state()
        self.assertEqual(self.request(operator, delete=True).status, 403)
        self.assertEqual(self.request(operator, status="statement_generated").status, 400)
        self.assertEqual(self.state(), before)
        self.assertEqual(self.request(operator, status="statement_sent").status, 200)
        self.assertTrue(withdrawal_capabilities(self.conn, operator, [self.workflow_id])[self.workflow_id])
        self.assertEqual(self.request(operator).status, 200)

    def test_lock_operator_cannot_withdraw_legacy_terminal_states(self):
        operator = {**OTHER, "billingLockAllowed": True}
        for status in ("statement_signed_returned", "submitted_to_finance"):
            self.conn.execute(
                "UPDATE billing_workflows SET workflow_status=?, payload=json_set(payload, '$.workflowStatus', ?)",
                (status, status),
            )
            self.conn.commit()
            before = self.state()
            self.assertFalse(withdrawal_capabilities(self.conn, operator, [self.workflow_id])[self.workflow_id])
            self.assertEqual(self.request(operator, delete=True).status, 403)
            self.assertEqual(self.request(operator).status, 403)
            self.assertEqual(self.state(), before)

    def test_denials_leave_database_unchanged_even_with_same_display_name(self):
        for delete in (True, False):
            if not delete:
                self.advance("statement_sent")
            before = self.state()
            self.assertEqual(self.request(OTHER, delete=delete).status, 403)
            self.assertEqual(self.state(), before)

    def test_generator_and_initiator_are_both_handlers(self):
        self.advance("statement_sent", OTHER)
        self.assertEqual(self.request(OWNER).status, 200)
        self.advance("statement_sent", OTHER)
        self.assertEqual(self.request(OTHER).status, 200)

    def test_missing_reason_and_wrong_action_are_rejected_without_writes(self):
        before = self.state()
        self.assertEqual(self.request(OWNER, delete=True, note=" ").status, 400)
        self.assertEqual(self.state(), before)
        self.advance("statement_sent")
        before = self.state()
        self.assertEqual(self.request(OWNER, note=" ").status, 400)
        self.assertEqual(self.request(OWNER, delete=True).status, 403)
        self.assertEqual(self.request(OWNER, status="statement_archived").status, 400)
        self.assertEqual(self.state(), before)

    def test_archive_lock_and_admin_boundaries(self):
        self.advance("statement_sent")
        self.advance("statement_archived", ADMIN, registration={"signedStatementReturned": True})
        before = self.state()
        self.assertEqual(self.request(OWNER).status, 403)
        self.assertEqual(self.request(OTHER, status="statement_sent").status, 403)
        self.assertEqual(self.request(OWNER, delete=True).status, 403)
        self.assertEqual(self.state(), before)
        self.assertEqual(self.request(OWNER, status="statement_sent").status, 200)
        self.advance("statement_locked", ADMIN)
        before = self.state()
        self.assertEqual(self.request(OWNER).status, 403)
        self.assertEqual(self.request(ADMIN).status, 403)
        self.assertEqual(self.request(ADMIN, delete=True).status, 400)
        self.assertEqual(self.state(), before)
        authorized = {**ADMIN, "billingLockAllowed": True}
        self.assertEqual(self.request(authorized, status="statement_sent").status, 200)

    def test_legacy_account_ids_work_but_names_cannot_claim_ownership(self):
        self.assertTrue(withdrawal_capabilities(self.conn, OWNER, [self.workflow_id])[self.workflow_id])
        self.advance("statement_sent", OTHER)
        self.conn.execute("UPDATE billing_workflows SET payload=json_remove(payload, '$.sentBy')")
        self.conn.commit()
        self.assertTrue(withdrawal_capabilities(self.conn, OTHER, [self.workflow_id])[self.workflow_id])
        self.assertTrue(withdrawal_capabilities(self.conn, OWNER, [self.workflow_id])[self.workflow_id])
        self.conn.execute("UPDATE billing_workflow_events SET payload=json_remove(payload, '$.actor.id')")
        self.conn.commit()
        self.assertFalse(withdrawal_capabilities(self.conn, OTHER, [self.workflow_id])[self.workflow_id])
        self.assertTrue(withdrawal_capabilities(self.conn, ADMIN, [self.workflow_id])[self.workflow_id])

    def test_handlers_from_previous_versions_and_initiations_remain_authorized(self):
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
        self.assertTrue(withdrawal_capabilities(self.conn, OWNER, [workflow["id"]])[workflow["id"]])
        self.advance("statement_sent", OWNER)
        self.assertEqual(self.request(OWNER).status, 200)
        self.advance("statement_sent", OTHER)
        self.assertEqual(self.request(OWNER).status, 200)
        self.advance("statement_sent", OTHER)
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

    def assert_registration(self, actor):
        self.advance("statement_sent")
        response = self.request(
            actor,
            status="statement_archived",
            registration={
                "signedStatementReturned": True,
                "signedStatementNote": "结算单已交回",
                "reimbursementFormReturned": True,
                "reimbursementForms": [{"formNo": "REGISTER-001", "amount": 100, "fundingBookNo": "FUND-001"}],
            },
        )
        self.assertEqual(response.status, 200)
        workflow = get_billing_workflow(self.conn, self.workflow_id)
        self.assertEqual(workflow["workflowStatus"], "statement_archived")
        self.assertEqual(workflow["registeredBy"]["id"], actor["id"])
        statement = get_billing_version(self.conn, self.version["id"])["statement"]
        self.assertEqual(statement["totalAmount"], 100)
        self.assertEqual(statement["receivedAmount"], 100)
        self.assertEqual(statement["reimbursementFormNos"], ["REGISTER-001"])
        self.assertEqual(response.response["event"]["actor"]["id"], actor["id"])
        audit = json.loads(
            read_audit_payload(
                self.conn, self.conn.execute("SELECT id FROM audit_events ORDER BY rowid DESC LIMIT 1").fetchone()[0]
            )
        )
        self.assertEqual(audit["actorUserId"], actor["id"])
        self.assertEqual(audit["after"]["version"]["statement"]["registeredBy"]["id"], actor["id"])

    def test_room_admin_can_register_own_sent_workflow(self):
        self.assert_registration(OWNER)

    def test_room_admin_can_register_other_initiators_sent_workflow(self):
        self.assert_registration(OTHER)

    def test_system_admin_registration_remains_available(self):
        self.assert_registration(ADMIN)

    def test_registration_still_validates_required_fields_status_and_lock(self):
        before = self.state()
        self.assertEqual(
            self.request(OTHER, status="statement_archived", registration={"signedStatementReturned": True}).status, 403
        )
        self.assertEqual(self.state(), before)

        self.advance("statement_sent")
        before = self.state()
        for registration in (
            {},
            {"signedStatementReturned": False},
            {"signedStatementReturned": True, "reimbursementFormReturned": True},
        ):
            self.assertEqual(self.request(OTHER, status="statement_archived", registration=registration).status, 400)
            self.assertEqual(self.state(), before)
        self.advance("statement_locked", ADMIN)
        before = self.state()
        self.assertEqual(
            self.request(OTHER, status="statement_archived", registration={"signedStatementReturned": True}).status, 403
        )
        self.assertEqual(self.state(), before)

    def source_audit(self, source_id, actor, action="quantity_sheet.created"):
        write_audit_events(
            self.conn,
            [
                audit_event(
                    actor,
                    action,
                    "quantity_sheet",
                    source_id,
                    "录入测试统计表",
                    [],
                    "2026-07-01T00:00:00+00:00",
                    None,
                    {"id": source_id, "manager": actor["displayName"]},
                )
            ],
        )
        self.conn.commit()

    def set_sources(self, source_ids):
        payload = get_billing_version(self.conn, self.version["id"])
        payload["statement"]["sourceIds"] = source_ids
        self.conn.execute(
            "UPDATE billing_statement_versions SET payload=? WHERE id=?", (json.dumps(payload), self.version["id"])
        )
        self.conn.commit()

    def test_quantity_sheet_creator_and_editor_can_revoke_without_name_matching(self):
        self.set_sources(["source-a", "source-b"])
        self.source_audit("unrelated", OTHER)
        self.assertFalse(withdrawal_capabilities(self.conn, OTHER, [self.workflow_id])[self.workflow_id])
        self.source_audit("source-a", OTHER)
        editor = {**OTHER, "id": "another-editor", "username": "editor"}
        self.source_audit("source-b", editor, "quantity_sheet.updated")
        for actor in (OTHER, editor):
            self.assertTrue(withdrawal_capabilities(self.conn, actor, [self.workflow_id])[self.workflow_id])
        stranger = {**OTHER, "id": "same-name-stranger", "username": "stranger"}
        self.assertFalse(withdrawal_capabilities(self.conn, stranger, [self.workflow_id])[self.workflow_id])
        self.advance("statement_sent")
        self.assertEqual(self.request(OTHER).status, 200)
        self.assertEqual(self.request(editor, delete=True).status, 200)

    def test_legacy_sources_resolve_by_frozen_business_keys_and_audit_actor(self):
        self.conn.execute(
            "INSERT INTO quantity_sheets(id,month,pi,iacuc,updated_at,payload) VALUES ('legacy','2026-07','测试负责人','Z2026001','2026-07-01','{}')"
        )
        self.conn.execute(
            "INSERT INTO quantity_sheets(id,month,pi,iacuc,updated_at,payload) VALUES ('unrelated','2026-07','测试负责人','Z2026002','2026-07-01','{}')"
        )
        self.conn.commit()
        self.source_audit("unrelated", OTHER)
        self.assertFalse(withdrawal_capabilities(self.conn, OTHER, [self.workflow_id])[self.workflow_id])
        self.source_audit("legacy", OTHER)
        plans = self.conn.execute(
            "EXPLAIN QUERY PLAN SELECT entity_id FROM audit_events WHERE entity_type='quantity_sheet' AND entity_id=? AND actor_user_id=?",
            ("legacy", OTHER["id"]),
        ).fetchall()
        self.assertTrue(any("idx_audit_events_entity_actor" in row["detail"] for row in plans))
        before = self.state()
        self.assertTrue(withdrawal_capabilities(self.conn, OTHER, [self.workflow_id])[self.workflow_id])
        self.assertEqual(self.state(), before)

    def test_registration_handler_can_revoke_and_original_initiator_is_preserved(self):
        self.advance("statement_sent")
        self.advance("statement_archived", OTHER, registration={"signedStatementReturned": True})
        self.assertEqual(self.request(OTHER, status="statement_sent").status, 200)
        self.assertEqual(get_billing_version(self.conn, self.version["id"])["statement"]["sentBy"]["id"], OWNER["id"])
        self.assertTrue(withdrawal_capabilities(self.conn, OTHER, [self.workflow_id])[self.workflow_id])

    def test_reimbursement_handler_is_authorized_only_after_unlocking(self):
        self.advance("statement_sent")
        self.advance("statement_archived", ADMIN, registration={"signedStatementReturned": True})
        record_archived_reimbursement(self.conn, self.workflow_id, [{"formNo": "LATE", "amount": 100}], OTHER)
        self.conn.commit()
        self.assertTrue(withdrawal_capabilities(self.conn, OTHER, [self.workflow_id])[self.workflow_id])
        self.advance("statement_locked", ADMIN)
        self.assertFalse(withdrawal_capabilities(self.conn, OTHER, [self.workflow_id])[self.workflow_id])
        self.assertEqual(self.request(OTHER, status="statement_sent").status, 403)
        self.assertEqual(self.request({**ADMIN, "billingLockAllowed": True}, status="statement_archived").status, 200)
        self.assertEqual(self.request(OTHER, status="statement_sent").status, 200)

    def test_unlock_restores_previous_stage_without_reviving_withdrawn_registration(self):
        self.advance("statement_sent")
        self.advance("statement_archived", OWNER, registration={"signedStatementReturned": True})
        self.assertEqual(self.request(OWNER, status="statement_sent").status, 200)
        self.advance("statement_locked", ADMIN)
        self.assertEqual(self.request({**ADMIN, "billingLockAllowed": True}, status="statement_sent").status, 200)

    def test_legacy_archive_target_matches_server_transition_even_without_old_flags(self):
        self.advance("statement_sent")
        self.advance("statement_locked", ADMIN)
        self.conn.execute(
            "UPDATE billing_statement_versions SET payload=json_remove(payload, '$.statement.lockedFromStatus', '$.statement.signedStatementReturned')"
        )
        self.conn.commit()
        projected = with_withdrawal_capabilities(
            self.conn, ADMIN, [{"id": self.workflow_id, "workflowStatus": "statement_locked"}]
        )[0]
        self.assertEqual(projected["unlockStatus"], "statement_archived")
        self.assertFalse(projected["canWithdraw"])
        self.assertEqual(
            self.request({**ADMIN, "billingLockAllowed": True}, status=projected["unlockStatus"]).status, 200
        )

    def test_large_source_sets_do_not_exceed_sqlite_bind_limit(self):
        self.set_sources([f"source-{index}" for index in range(1001)])
        self.source_audit("source-1000", OTHER)
        limit = self.conn.setlimit(sqlite3.SQLITE_LIMIT_VARIABLE_NUMBER, 500)
        try:
            self.assertTrue(withdrawal_capabilities(self.conn, OTHER, [self.workflow_id])[self.workflow_id])
        finally:
            self.conn.setlimit(sqlite3.SQLITE_LIMIT_VARIABLE_NUMBER, limit)


if __name__ == "__main__":
    unittest.main()
