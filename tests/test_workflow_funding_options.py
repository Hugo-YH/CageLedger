import json
import sqlite3
import unittest

from server_app.domains.workflow.funding_options import current_funding_book_options
from server_app.persistence.bootstrap import initialize_schema


class WorkflowFundingOptionsTests(unittest.TestCase):
    def setUp(self):
        self.conn = sqlite3.connect(":memory:")
        self.conn.row_factory = sqlite3.Row
        initialize_schema(self.conn)
        workflow = {
            "id": "wf-1",
            "iacuc": "Z2026001",
            "iacucs": ["Z2026001", "Z2026002"],
            "pi": "张教授",
            "funding": "结算时的旧经费（经费本编号：OLD-1）",
        }
        self.conn.execute(
            """INSERT INTO billing_workflows
               (id, business_key, iacuc, month, source_type, workflow_status, current_version_id, current_version_no, latest_event_at, payload)
               VALUES ('wf-1', '2026-08:张教授', 'Z2026001', '2026-08', 'quantity_sheet', 'statement_sent', '', 1, '', ?)""",
            (json.dumps(workflow, ensure_ascii=False),),
        )

    def tearDown(self):
        self.conn.close()

    def _insert_application(self, iacuc, project, funding, fund_code, pi=""):
        payload = {"iacuc": iacuc, "project": project, "funding": funding, "fundCode": fund_code, "pi": pi}
        self.conn.execute(
            """INSERT INTO experiment_applications
               (id, iacuc, raw_iacuc, project, pi, owner, funding, imported_at, payload)
               VALUES (?, ?, ?, ?, ?, '', ?, '', ?)""",
            (f"app-{iacuc}", iacuc, iacuc, project, pi, funding, json.dumps(payload, ensure_ascii=False)),
        )

    def test_uses_latest_application_fund_code_instead_of_workflow_snapshot(self):
        self._insert_application("Z2026001", "更新后的课题", "新的项目来源", "NEW-100", "张教授")
        self._insert_application("Z2026002", "配套课题", "配套经费（经费本编号：NEW-200）", "", "张教授")
        self._insert_application("Z2026999", "同 PI 的另一课题", "另一经费", "PI-300", "张教授")
        self._insert_application("Z2026998", "无关课题", "无关经费", "OTHER-1", "李教授")

        result = current_funding_book_options(self.conn, "wf-1")

        self.assertEqual(result["iacucs"], ["Z2026001", "Z2026002"])
        self.assertEqual(result["piFundingBookNos"], ["NEW-100", "NEW-200", "PI-300"])
        self.assertEqual(
            result["piFundingBookOptions"],
            [
                {
                    "value": "NEW-100",
                    "label": "更新后的课题（经费本编号：NEW-100）",
                    "source": "fundCode",
                    "iacucs": ["Z2026001"],
                },
                {
                    "value": "NEW-200",
                    "label": "配套经费（经费本编号：NEW-200）",
                    "source": "funding",
                    "iacucs": ["Z2026002"],
                },
                {
                    "value": "PI-300",
                    "label": "同 PI 的另一课题（经费本编号：PI-300）",
                    "source": "fundCode",
                    "iacucs": ["Z2026999"],
                },
            ],
        )
        self.assertEqual(
            result["items"],
            [
                {
                    "value": "NEW-100",
                    "label": "更新后的课题（经费本编号：NEW-100）",
                    "source": "fundCode",
                    "iacucs": ["Z2026001"],
                },
                {
                    "value": "NEW-200",
                    "label": "配套经费（经费本编号：NEW-200）",
                    "source": "funding",
                    "iacucs": ["Z2026002"],
                },
            ],
        )
