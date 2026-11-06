"""Notification projection keeps the existing generator and write response contract."""

import sqlite3
import unittest
from types import SimpleNamespace
from unittest.mock import patch

from server_app.cache import invalidate_data_cache
from server_app.web import workflow_actions
from tests import test_post_commit_cache_invalidation as http_fixture


class SettlementNoticePreviewTests(unittest.TestCase):
    def test_notice_uses_fresh_generator_and_only_projects_read_response(self):
        for persist, initiate in ((False, False), (True, False), (False, True)):
            with self.subTest(persist=persist, initiate=initiate):
                conn = sqlite3.connect(":memory:")
                self.addCleanup(conn.close)
                self.addCleanup(invalidate_data_cache)
                handler = http_fixture.Handler()
                body = {
                    "pi": "PI",
                    "month": "2026-10",
                    "sourceType": "quantity_sheet",
                    "view": "notice",
                    "persist": persist,
                    "initiate": initiate,
                }
                statement = {
                    "pi": "PI",
                    "month": "2026-10",
                    "totalAmount": 123.45,
                    "workflowId": "issued-workflow",
                    "sourceVersions": {"sheet": "latest-version"},
                    "technicalServiceRows": [{"large": "not needed by mail"}],
                }
                ports = SimpleNamespace(
                    generate_billing_statement_by_pi=lambda *_, statement=statement: (
                        statement,
                        [{"amount": 123.45}],
                        [],
                    )
                )
                with (
                    patch.object(handler, "read_json_body", return_value=body),
                    patch.object(workflow_actions, "connect_db", return_value=conn),
                    patch.object(workflow_actions, "app_ports", return_value=ports),
                    patch.object(workflow_actions, "update_settlement_candidate_snapshot_from_statement") as update,
                    patch.object(
                        workflow_actions, "get_billing_workflow", return_value={"id": "issued-workflow"}
                    ) as workflow,
                    patch.object(
                        workflow_actions, "get_reimbursement_record_by_workflow_id", return_value=None
                    ) as reimbursement,
                ):
                    handler.handle_billing_statement_generate_by_pi()
                response, status = handler.response
                self.assertEqual(status, 201)
                update.assert_called_once()
                if not persist and not initiate:
                    self.assertEqual(
                        response,
                        {
                            "statement": {"pi": "PI", "month": "2026-10", "totalAmount": 123.45},
                            "sourceVersions": {"sheet": "latest-version"},
                        },
                    )
                    workflow.assert_not_called()
                    reimbursement.assert_not_called()
                else:
                    self.assertEqual(response["statement"], statement)
                    self.assertEqual(response["lines"], [{"amount": 123.45}])
                    workflow.assert_called_once()
                    reimbursement.assert_called_once()

    def test_notice_retains_generator_failure_without_publishing_a_partial_summary(self):
        conn = sqlite3.connect(":memory:")
        self.addCleanup(conn.close)
        handler = http_fixture.Handler()

        def fail(*_):
            raise ValueError("来源已变化")

        ports = SimpleNamespace(generate_billing_statement_by_pi=fail)
        with (
            patch.object(handler, "read_json_body", return_value={"view": "notice"}),
            patch.object(workflow_actions, "connect_db", return_value=conn),
            patch.object(workflow_actions, "app_ports", return_value=ports),
            patch.object(workflow_actions, "update_settlement_candidate_snapshot_from_statement") as update,
        ):
            handler.handle_billing_statement_generate_by_pi()
        self.assertEqual(handler.response, ({"error": "来源已变化"}, 400))
        update.assert_not_called()
