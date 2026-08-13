import json
import sqlite3
import unittest

from server_app.legacy import (
    get_billing_workflow_detail,
    initialize_schema,
    list_billing_workflows_page,
    record_archived_reimbursement,
    update_workflow_status,
)
from server_app.repositories.billing_workflows import list_billing_workflow_filter_options

ADMIN = {"id": "admin", "username": "admin", "displayName": "系统管理员", "role": "admin", "roomIds": []}


class BillingWorkflowListTests(unittest.TestCase):
    def setUp(self):
        self.conn = sqlite3.connect(":memory:")
        self.conn.row_factory = sqlite3.Row
        self.conn.execute("PRAGMA foreign_keys=ON")
        initialize_schema(self.conn)

    def tearDown(self):
        self.conn.close()

    def _insert_workflow(self, workflow_id, version_id, month, pi, manager, iacuc, amount, workflow_status):
        workflow = {
            "id": workflow_id,
            "iacuc": iacuc,
            "iacucs": [iacuc],
            "month": month,
            "sourceType": "pi_merged_quantity_sheet",
            "workflowStatus": workflow_status,
            "currentVersionId": version_id,
            "currentVersionNo": 1,
            "pi": pi,
            "manager": manager,
            "totalAmount": amount,
        }
        version = {
            "id": version_id,
            "workflowId": workflow_id,
            "versionNo": 1,
            "versionStatus": "active",
            "workflowStatus": workflow_status,
            "generatedAt": f"{month}-01T00:00:00+00:00",
            "statement": {
                "id": version_id,
                "pi": pi,
                "manager": manager,
                "iacuc": iacuc,
                "iacucs": [iacuc],
                "totalAmount": amount,
            },
        }
        self.conn.execute(
            """INSERT INTO billing_workflows (id, business_key, iacuc, month, source_type, workflow_status, current_version_id, current_version_no, latest_event_at, payload)
               VALUES (?, ?, ?, ?, 'pi_merged_quantity_sheet', ?, ?, 1, '', ?)""",
            (
                workflow_id,
                f"{month}:{pi}",
                iacuc,
                month,
                workflow_status,
                version_id,
                json.dumps(workflow, ensure_ascii=False),
            ),
        )
        self.conn.execute(
            """INSERT INTO billing_statement_versions (id, workflow_id, version_no, version_status, workflow_status, generated_at, voided_at, created_by, payload)
               VALUES (?, ?, 1, 'active', ?, ?, NULL, 'admin', ?)""",
            (version_id, workflow_id, workflow_status, version["generatedAt"], json.dumps(version, ensure_ascii=False)),
        )
        self.conn.commit()

    def _list(self, **overrides):
        filters = {
            "limit": 10,
            "offset": 0,
            "sortKey": "",
            "sortDir": "",
            "columnFilters": {},
            "status": "",
            "month": "",
            "sourceType": "",
            "iacuc": "",
            "pi": "",
        }
        filters.update(overrides)
        return list_billing_workflows_page(self.conn, filters)

    def test_list_sorts_and_filters(self):
        self._insert_workflow("wf-1", "v-1", "2026-07", "张教授", "李登记", "Z2026001", 100, "statement_generated")
        self._insert_workflow("wf-2", "v-2", "2026-07", "李教授", "王登记", "Z2026002", 80, "statement_sent")
        self._insert_workflow("wf-3", "v-3", "2026-06", "王教授", "李登记", "Z2026003", 60, "statement_archived")

        by_pi_asc = self._list(sortKey="pi", sortDir="asc")
        # 默认列表不展示已生成，只展示已发起之后的阶段。
        self.assertEqual([item["id"] for item in by_pi_asc["items"]], ["wf-2", "wf-3"])

        by_manager = self._list(columnFilters={"manager": ["李登记"]})
        self.assertEqual([item["id"] for item in by_manager["items"]], ["wf-3"])

        by_status = self._list(columnFilters={"status": ["statement_sent"]})
        self.assertEqual([item["id"] for item in by_status["items"]], ["wf-2"])

        by_iacuc = self._list(columnFilters={"iacuc": ["Z2026003"]})
        self.assertEqual([item["id"] for item in by_iacuc["items"]], ["wf-3"])
        self.assertEqual(by_iacuc["items"][0]["manager"], "李登记")

    def test_list_filters_accept_multiple_values_per_column(self):
        self._insert_workflow("wf-1", "v-1", "2026-07", "张教授", "李登记", "Z2026001", 100, "statement_generated")
        self._insert_workflow("wf-2", "v-2", "2026-07", "李教授", "王登记", "Z2026002", 80, "statement_sent")
        self._insert_workflow("wf-3", "v-3", "2026-06", "王教授", "李登记", "Z2026003", 60, "statement_archived")

        by_statuses = self._list(columnFilters={"status": ["statement_sent", "statement_archived"]})
        self.assertEqual(sorted(item["id"] for item in by_statuses["items"]), ["wf-2", "wf-3"])

        by_managers = self._list(columnFilters={"manager": ["李登记", "王登记"]})
        self.assertEqual(sorted(item["id"] for item in by_managers["items"]), ["wf-2", "wf-3"])

        by_months = self._list(columnFilters={"month": ["2026-07", "2026-06"]})
        self.assertEqual(len(by_months["items"]), 2)

    def test_list_default_excludes_generated(self):
        self._insert_workflow("wf-1", "v-1", "2026-07", "张教授", "李登记", "Z2026001", 100, "statement_generated")
        self._insert_workflow("wf-2", "v-2", "2026-07", "李教授", "王登记", "Z2026002", 80, "statement_sent")
        result = self._list()
        self.assertEqual([item["id"] for item in result["items"]], ["wf-2"])
        statuses = list_billing_workflow_filter_options(self.conn, {"columnFilters": {}}, "status")
        self.assertEqual({item["value"] for item in statuses}, {"statement_sent"})

    def test_detail_includes_audit_fields(self):
        self._insert_workflow("wf-1", "v-1", "2026-07", "张教授", "李登记", "Z2026001", 100, "statement_sent")
        detail = get_billing_workflow_detail(self.conn, "wf-1")
        self.assertEqual(detail["manager"], "李登记")
        self.assertIn("sentBy", detail)
        self.assertIn("sheetUpdatedAt", detail)

    def test_filter_options_group_by_status_and_scalar(self):
        self._insert_workflow("wf-1", "v-1", "2026-07", "张教授", "李登记", "Z2026001", 100, "statement_generated")
        self._insert_workflow("wf-2", "v-2", "2026-07", "李教授", "王登记", "Z2026002", 80, "statement_sent")

        statuses = list_billing_workflow_filter_options(self.conn, {"columnFilters": {}}, "status")
        labels = {item["value"]: item["label"] for item in statuses}
        self.assertEqual(labels["statement_sent"], "已发起")
        self.assertNotIn("statement_generated", labels)

        managers = list_billing_workflow_filter_options(self.conn, {"columnFilters": {}}, "manager")
        self.assertEqual({item["value"] for item in managers}, {"李登记", "王登记"})

    def test_sent_workflow_can_revert_to_generated(self):
        self._insert_workflow("wf-1", "v-1", "2026-07", "张教授", "李登记", "Z2026001", 100, "statement_sent")
        workflow, version, event = update_workflow_status(
            self.conn, "wf-1", "statement_generated", ADMIN, "撤回已发起流程"
        )
        self.assertEqual(workflow["workflowStatus"], "statement_generated")
        self.assertEqual(version["statement"]["workflowStatus"], "statement_generated")
        self.assertEqual(event["eventType"], "statement_sent_reverted")
        self.assertEqual(version["statement"]["revertedBy"]["displayName"], "系统管理员")

    def test_advance_to_sent_records_sent_by(self):
        self._insert_workflow("wf-1", "v-1", "2026-07", "张教授", "李登记", "Z2026001", 100, "statement_generated")
        workflow, version, event = update_workflow_status(self.conn, "wf-1", "statement_sent", ADMIN, "发起结算流程")
        statement = version["statement"]
        self.assertEqual(workflow["workflowStatus"], "statement_sent")
        self.assertEqual(statement["sentBy"]["displayName"], "系统管理员")
        self.assertTrue(statement["sentAt"])
        self.assertEqual(event["eventType"], "statement_sent")

    def test_archived_registration_derives_received_amount_from_forms(self):
        self._insert_workflow("wf-1", "v-1", "2026-07", "张教授", "李登记", "Z2026001", 100, "statement_sent")
        workflow, version, event = update_workflow_status(
            self.conn,
            "wf-1",
            "statement_archived",
            ADMIN,
            "交回登记并归档",
            {
                "reimbursementFormReturned": True,
                "reimbursementForms": [
                    {"formNo": "BX-001", "amount": 100},
                    {"formNo": "BX-002", "amount": 50},
                ],
            },
        )
        statement = version["statement"]
        self.assertEqual(statement["workflowStatus"], "statement_archived")
        self.assertEqual(statement["receivedAmount"], 150)
        self.assertEqual([entry["formNo"] for entry in statement["reimbursementForms"]], ["BX-001", "BX-002"])
        self.assertEqual(event["eventType"], "statement_registered_archived")

    def test_archived_workflow_can_record_missing_reimbursement(self):
        self._insert_workflow("wf-1", "v-1", "2026-07", "张教授", "李登记", "Z2026001", 100, "statement_archived")
        workflow, version, event = record_archived_reimbursement(
            self.conn,
            "wf-1",
            [{"formNo": "BX-LATE", "amount": 120}],
            ADMIN,
            "课题组补交报销单",
        )
        statement = version["statement"]
        self.assertEqual(workflow["workflowStatus"], "statement_archived")
        self.assertEqual(statement["workflowStatus"], "statement_archived")
        self.assertTrue(statement["reimbursementFormReturned"])
        self.assertEqual([entry["formNo"] for entry in statement["reimbursementForms"]], ["BX-LATE"])
        self.assertEqual(statement["receivedAmount"], 120)
        self.assertEqual(event["eventType"], "statement_reimbursement_recorded")
        self.assertEqual(statement["reimbursementRecordedBy"]["displayName"], "系统管理员")

    def test_reimbursement_recording_rejects_active_workflow(self):
        self._insert_workflow("wf-1", "v-1", "2026-07", "张教授", "李登记", "Z2026001", 100, "statement_sent")
        with self.assertRaises(ValueError):
            record_archived_reimbursement(
                self.conn,
                "wf-1",
                [{"formNo": "BX-LATE", "amount": 120}],
                ADMIN,
            )

    def test_archived_workflow_can_lock_and_unlock(self):
        self._insert_workflow("wf-1", "v-1", "2026-07", "张教授", "李登记", "Z2026001", 100, "statement_archived")
        workflow, version, event = update_workflow_status(self.conn, "wf-1", "statement_locked", ADMIN, "锁定流程")
        statement = version["statement"]
        self.assertEqual(workflow["workflowStatus"], "statement_locked")
        self.assertEqual(statement["lockedBy"]["displayName"], "系统管理员")
        self.assertTrue(statement["lockedAt"])
        self.assertEqual(event["eventType"], "statement_locked")

        workflow, version, event = update_workflow_status(self.conn, "wf-1", "statement_archived", ADMIN, "解锁流程")
        statement = version["statement"]
        self.assertEqual(workflow["workflowStatus"], "statement_archived")
        self.assertEqual(statement["unlockedBy"]["displayName"], "系统管理员")
        self.assertTrue(statement["unlockedAt"])
        self.assertEqual(event["eventType"], "statement_unlocked")

    def test_locked_workflow_is_terminal_without_unlock(self):
        self._insert_workflow("wf-1", "v-1", "2026-07", "张教授", "李登记", "Z2026001", 100, "statement_locked")
        with self.assertRaises(ValueError):
            update_workflow_status(self.conn, "wf-1", "statement_sent", ADMIN, "撤回")
        with self.assertRaises(ValueError):
            update_workflow_status(self.conn, "wf-1", "statement_generated", ADMIN, "撤回")

    def test_filter_options_include_locked(self):
        self._insert_workflow("wf-1", "v-1", "2026-07", "张教授", "李登记", "Z2026001", 100, "statement_locked")
        statuses = list_billing_workflow_filter_options(self.conn, {"columnFilters": {}}, "status")
        labels = {item["value"]: item["label"] for item in statuses}
        self.assertEqual(labels["statement_locked"], "已锁定")


if __name__ == "__main__":
    unittest.main()
