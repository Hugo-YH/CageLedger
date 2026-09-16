import json
import sqlite3
import unittest
from unittest.mock import Mock, patch

from server_app.composition import (
    generate_billing_statement,
    generate_billing_statement_by_pi,
    generate_quantity_sheet_statement,
)
from server_app.domains.iacuc.sync import sync_project_derived_fields_after_iacuc_upload
from server_app.legacy import initialize_schema
from server_app.web.pdf_exports import (
    _enqueue_billing_pdf,
    _frozen_pdf_cache_key,
    _render_billing_pdf,
    _start_billing_export,
)

ADMIN = {"id": "admin", "username": "admin", "displayName": "系统管理员", "role": "admin", "roomIds": []}
IACUC = "Z2026999"


def application(*, pi="王力", facility="珠江新城"):
    return {
        "iacuc": IACUC,
        "project": "主档项目",
        "pi": pi,
        "owner": "主档实验负责人",
        "funding": "主档项目来源",
        "species": "mouse",
        "facility": facility,
    }


class BillingWorkflowFreezeTests(unittest.TestCase):
    def setUp(self):
        self.conn = sqlite3.connect(":memory:")
        self.conn.row_factory = sqlite3.Row
        self.conn.execute("PRAGMA foreign_keys=ON")
        initialize_schema(self.conn)

    def tearDown(self):
        self.conn.close()

    def insert_sheet(self, sheet_id, *, month, pi="王力", iacuc=IACUC, updated_at="2026-09-01T00:00:00+00:00"):
        payload = {
            "id": sheet_id,
            "month": month,
            "iacuc": iacuc,
            "roomId": "room-1",
            "roomName": "测试房间",
            "manager": "登记员",
            "project": "本地项目",
            "pi": pi,
            "owner": "本地负责人",
            "funding": "本地项目来源",
            "species": "rat",
            "facility": "珠江新城",
            "initialCageCount": 1,
            "initialAnimalCount": 2,
            "billingUnit": "cage_day",
            "rows": [],
            "updatedAt": updated_at,
        }
        self.conn.execute(
            """
            INSERT INTO quantity_sheets (
                id, month, iacuc, room_id, room_name, manager, project, pi, owner, funding, updated_at, payload
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                sheet_id,
                month,
                iacuc,
                payload["roomId"],
                payload["roomName"],
                payload["manager"],
                payload["project"],
                payload["pi"],
                payload["owner"],
                payload["funding"],
                updated_at,
                json.dumps(payload, ensure_ascii=False),
            ),
        )
        return payload

    def insert_workflow(
        self,
        workflow_id,
        status,
        *,
        month,
        pi="王力",
        iacuc=IACUC,
        source_type="pi_merged_quantity_sheet",
        source_ids=None,
        source_id="",
        amount=123.45,
    ):
        version_id = f"version-{workflow_id}"
        scope_iacuc = f"pi::{pi}" if source_type.startswith("pi_merged_") else iacuc
        statement = {
            "id": version_id,
            "workflowId": workflow_id,
            "versionId": version_id,
            "versionNo": 1,
            "versionStatus": "active",
            "workflowStatus": status,
            "iacuc": scope_iacuc,
            "iacucs": [iacuc],
            "month": month,
            "pi": pi,
            "project": "存档项目",
            "owner": "存档负责人",
            "funding": "存档来源",
            "sourceType": source_type,
            "totalAmount": amount,
            "totalCageDays": 9,
            "sheetUpdatedAt": "2026-09-02T00:00:00+00:00",
            "generatedAt": "2026-09-02T00:00:00+00:00",
        }
        if source_ids is not None:
            statement["sourceIds"] = source_ids
        if source_id:
            statement["sourceId"] = source_id
        version = {
            "id": version_id,
            "workflowId": workflow_id,
            "versionNo": 1,
            "versionStatus": "active",
            "workflowStatus": status,
            "generatedAt": "2026-09-02T00:00:00+00:00",
            "statement": statement,
        }
        workflow = {
            "id": workflow_id,
            "businessKey": f"pi|{scope_iacuc}|{month}|{source_type}|{workflow_id}",
            "iacuc": scope_iacuc,
            "iacucs": [iacuc],
            "month": month,
            "pi": pi,
            "sourceType": source_type,
            "workflowStatus": status,
            "currentVersionId": version_id,
            "currentVersionNo": 1,
            "currentVersion": version,
            "latestEventAt": "2026-09-02T00:00:00+00:00",
        }
        self.conn.execute(
            """
            INSERT INTO billing_workflows (
                id, business_key, iacuc, month, source_type, workflow_status,
                current_version_id, current_version_no, latest_event_at, payload
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                workflow_id,
                workflow["businessKey"],
                workflow["iacuc"],
                month,
                workflow["sourceType"],
                status,
                version_id,
                1,
                workflow["latestEventAt"],
                json.dumps(workflow, ensure_ascii=False),
            ),
        )
        self.conn.execute(
            """
            INSERT INTO billing_statement_versions (
                id, workflow_id, version_no, version_status, workflow_status,
                generated_at, voided_at, created_by, payload
            ) VALUES (?, ?, 1, 'active', ?, ?, NULL, 'admin', ?)
            """,
            (version_id, workflow_id, status, version["generatedAt"], json.dumps(version, ensure_ascii=False)),
        )
        lines = [
            {
                "id": f"line-{workflow_id}",
                "statementId": version_id,
                "date": f"{month}-01",
                "cageCount": 9,
                "amount": amount,
                "cumulative": amount,
                "iacucBreakdown": [{"iacuc": IACUC, "project": "存档项目", "cageCount": 9}],
            }
        ]
        for line in lines:
            self.conn.execute(
                "INSERT INTO billing_statement_version_lines (id, version_id, line_date, payload) VALUES (?, ?, ?, ?)",
                (line["id"], version_id, line["date"], json.dumps(line, ensure_ascii=False)),
            )
        return statement, lines

    def sheet_row(self, sheet_id):
        row = self.conn.execute(
            "SELECT project, pi, owner, funding, updated_at, payload FROM quantity_sheets WHERE id = ?", (sheet_id,)
        ).fetchone()
        return {**dict(row), "payload": json.loads(row["payload"])}

    def test_iacuc_sync_freezes_issued_sources_but_updates_generated_and_unlisted_sheets(self):
        protected = {
            "sheet-sent": "statement_sent",
            "sheet-archived": "statement_archived",
            "sheet-locked": "statement_locked",
        }
        before = {}
        for sheet_id, status in protected.items():
            self.insert_sheet(sheet_id, month="2026-08")
            self.insert_workflow(
                f"workflow-{sheet_id}",
                status,
                month="2026-08",
                source_ids=None if sheet_id == "sheet-archived" else [sheet_id],
                source_id=sheet_id if sheet_id == "sheet-archived" else "",
            )
            before[sheet_id] = self.sheet_row(sheet_id)

        # A legacy issued version without source IDs still protects its matching month/PI/IACUC.
        self.insert_sheet("sheet-legacy", month="2026-07")
        self.insert_workflow("workflow-legacy", "statement_sent", month="2026-07", source_ids=None)
        before["sheet-legacy"] = self.sheet_row("sheet-legacy")

        # Explicit source IDs must not make every sheet in the same scope immutable.
        self.insert_sheet("sheet-unlisted", month="2026-08")
        self.insert_sheet("sheet-generated", month="2026-09")
        self.conn.commit()

        result = sync_project_derived_fields_after_iacuc_upload(
            self.conn,
            [application()],
            [application(pi="李新", facility="珠")],
            ADMIN,
            "2026-09-16T10:00:00+00:00",
        )

        for sheet_id, original in before.items():
            self.assertEqual(self.sheet_row(sheet_id), original, sheet_id)

        for sheet_id in ("sheet-unlisted", "sheet-generated"):
            updated = self.sheet_row(sheet_id)
            self.assertEqual(updated["pi"], "李新")
            self.assertEqual(updated["payload"]["pi"], "李新")
            self.assertEqual(updated["payload"]["facility"], "珠")
            self.assertEqual(updated["updated_at"], "2026-09-16T10:00:00+00:00")

        snapshot = self.conn.execute(
            "SELECT payload FROM project_sync_snapshots WHERE id = ?", (result["snapshotId"],)
        ).fetchone()
        changed_ids = {item["id"] for item in json.loads(snapshot["payload"])["changes"]}
        self.assertTrue({"sheet-unlisted", "sheet-generated"}.issubset(changed_ids))
        self.assertTrue(changed_ids.isdisjoint(before))

    def test_issued_preview_reads_complete_version_without_live_calculation_and_reverted_workflow_uses_live_data(self):
        self.insert_sheet("sheet-preview", month="2026-10")
        statement, stored_lines = self.insert_workflow(
            "workflow-preview", "statement_sent", month="2026-10", source_ids=["sheet-preview"], amount=321.5
        )
        self.conn.commit()
        request = {
            "month": "2026-10",
            "pi": "王力",
            "sourceType": "quantity_sheet",
            "status": "draft",
            "persist": False,
        }

        with patch(
            "server_app.domains.billing.generation.quantity_sheet_statement_lines",
            side_effect=AssertionError("issued preview must not read live quantity sheets"),
        ):
            preview, lines, audits = generate_billing_statement_by_pi(self.conn, request, ADMIN)
        self.assertEqual(preview, statement)
        self.assertEqual(lines, stored_lines)
        self.assertEqual(audits, [])

        with self.assertRaisesRegex(PermissionError, "请先登录"):
            generate_billing_statement_by_pi(self.conn, request, None)

        self.conn.execute(
            "UPDATE billing_workflows SET workflow_status = 'statement_generated' WHERE id = 'workflow-preview'"
        )
        self.conn.commit()
        live_lines = [
            {
                "id": "live-line",
                "date": "2026-10-01",
                "animalCount": 0,
                "cageCount": 2,
                "freeCages": 0,
                "billableCages": 2,
                "tier1BillableCages": 2,
                "tier2BillableCages": 0,
                "amount": 88,
                "cumulative": 88,
                "iacucBreakdown": [],
                "quantitySheetRowIds": [],
            }
        ]
        with patch(
            "server_app.domains.billing.generation.quantity_sheet_statement_lines", return_value=live_lines
        ) as calculator:
            preview, lines, _ = generate_billing_statement_by_pi(self.conn, request, ADMIN)
        calculator.assert_called_once()
        self.assertEqual(preview["totalAmount"], 88)
        self.assertEqual(lines, live_lines)

    def test_issued_workflow_with_missing_active_version_fails_instead_of_recalculating(self):
        workflow = {
            "id": "workflow-missing-version",
            "iacucs": [IACUC],
            "month": "2026-11",
            "pi": "王力",
            "sourceType": "pi_merged_quantity_sheet",
            "workflowStatus": "statement_sent",
            "currentVersionId": "missing-version",
            "currentVersionNo": 1,
        }
        self.conn.execute(
            """
            INSERT INTO billing_workflows (
                id, business_key, iacuc, month, source_type, workflow_status,
                current_version_id, current_version_no, latest_event_at, payload
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                workflow["id"],
                "pi|pi::王力|2026-11|pi_merged_quantity_sheet|missing",
                "pi::王力",
                "2026-11",
                "pi_merged_quantity_sheet",
                "statement_sent",
                "missing-version",
                1,
                "2026-09-02T00:00:00+00:00",
                json.dumps(workflow, ensure_ascii=False),
            ),
        )
        self.conn.commit()
        with self.assertRaisesRegex(ValueError, "结算版本缺失"):
            generate_billing_statement_by_pi(
                self.conn,
                {"month": "2026-11", "pi": "王力", "sourceType": "quantity_sheet", "persist": False},
                ADMIN,
            )

    def test_same_month_pi_quantity_sheet_previews_are_bound_to_the_requested_source(self):
        self.insert_sheet("sheet-a", month="2026-12", iacuc="Z-A")
        statement_a, lines_a = self.insert_workflow(
            "workflow-sheet-a",
            "statement_sent",
            month="2026-12",
            iacuc="Z-A",
            source_type="quantity_sheet",
            source_id="sheet-a",
            amount=101,
        )
        self.insert_sheet("sheet-b", month="2026-12", iacuc="Z-B")
        statement_b, lines_b = self.insert_workflow(
            "workflow-sheet-b",
            "statement_sent",
            month="2026-12",
            iacuc="Z-B",
            source_type="quantity_sheet",
            source_ids=["sheet-b"],
            amount=202,
        )
        self.conn.commit()

        with patch(
            "server_app.domains.billing.generation.quantity_sheet_statement_lines",
            side_effect=AssertionError("issued sheet preview must not read live quantity sheets"),
        ):
            preview_a, preview_a_lines, _ = generate_quantity_sheet_statement(
                self.conn, "sheet-a", {"persist": False}, ADMIN
            )
            preview_b, preview_b_lines, _ = generate_quantity_sheet_statement(
                self.conn, "sheet-b", {"persist": False}, ADMIN
            )
        self.assertEqual((preview_a, preview_a_lines), (statement_a, lines_a))
        self.assertEqual((preview_b, preview_b_lines), (statement_b, lines_b))

    def test_cage_map_preview_uses_iacuc_frozen_version_with_or_without_pi(self):
        statement_a, lines_a = self.insert_workflow(
            "workflow-cage-a",
            "statement_sent",
            month="2027-02",
            iacuc="Z-CAGE-A",
            source_type="cage_map",
            amount=303,
        )
        self.insert_workflow(
            "workflow-cage-b",
            "statement_sent",
            month="2027-02",
            iacuc="Z-CAGE-B",
            source_type="cage_map",
            amount=404,
        )
        self.conn.commit()
        no_live_read = patch(
            "server_app.composition.read_occupancies_for_billing",
            side_effect=AssertionError("issued cage-map preview must not read live occupancies"),
        )
        with no_live_read:
            without_pi = generate_billing_statement(
                self.conn, {"iacuc": "Z-CAGE-A", "month": "2027-02", "persist": False}, ADMIN
            )
            with_pi = generate_billing_statement(
                self.conn,
                {"iacuc": "Z-CAGE-A", "month": "2027-02", "pi": "王力", "persist": False},
                ADMIN,
            )
        self.assertEqual(without_pi[:2], (statement_a, lines_a))
        self.assertEqual(with_pi[:2], (statement_a, lines_a))

    def test_issued_pdf_renders_frozen_version_without_live_generation_and_keys_by_version(self):
        statement, stored_lines = self.insert_workflow(
            "workflow-pdf", "statement_sent", month="2026-12", source_ids=["sheet-pdf"], amount=456.7
        )
        self.conn.commit()
        payload = {"month": "2026-12", "pi": "王力", "sourceType": "quantity_sheet"}
        generated = Mock(side_effect=AssertionError("issued PDF must not regenerate from live data"))
        cache_keys = []

        def render_cached(key, render):
            cache_keys.append(key)
            return render()

        with (
            patch("server_app.web.pdf_exports.pdf_export_cache.render_cached", side_effect=render_cached),
            patch(
                "server_app.web.pdf_exports.render_billing_statement_pdf", return_value=b"%PDF snapshot"
            ) as render_pdf,
        ):
            body = _render_billing_pdf(payload, connect_db=lambda: self.conn, generate_statement=generated, actor=ADMIN)

        self.assertEqual(body, b"%PDF snapshot")
        self.assertEqual(cache_keys, [_frozen_pdf_cache_key((statement, stored_lines))])
        render_pdf.assert_called_once_with(statement, stored_lines)
        generated.assert_not_called()

        revised_statement = {**statement, "id": "version-workflow-pdf-v2", "versionId": "version-workflow-pdf-v2"}
        self.assertNotEqual(
            _frozen_pdf_cache_key((statement, stored_lines)), _frozen_pdf_cache_key((revised_statement, stored_lines))
        )
        regenerated_statement = {**statement, "totalAmount": 900}
        self.assertNotEqual(
            _frozen_pdf_cache_key((statement, stored_lines)),
            _frozen_pdf_cache_key((regenerated_statement, stored_lines)),
        )
        regenerated_lines = [{**line, "amount": 900, "cumulative": 900} for line in stored_lines]
        self.assertNotEqual(
            _frozen_pdf_cache_key((statement, stored_lines)), _frozen_pdf_cache_key((statement, regenerated_lines))
        )

    def test_queued_issued_pdf_captures_snapshot_before_source_change_or_revert(self):
        self.insert_sheet("sheet-queued", month="2027-01")
        statement, stored_lines = self.insert_workflow(
            "workflow-queued", "statement_sent", month="2027-01", source_ids=["sheet-queued"], amount=789
        )
        self.conn.commit()
        captured = {}

        def enqueue_artifact(**kwargs):
            captured.update(kwargs)
            return "queued-job"

        generated = Mock(side_effect=AssertionError("queued issued PDF must not regenerate from live data"))
        with patch("server_app.web.pdf_exports.pdf_export_cache.enqueue_artifact", side_effect=enqueue_artifact):
            job = _enqueue_billing_pdf(
                "2027-01",
                "王力",
                ADMIN["id"],
                connect_db=lambda: self.conn,
                generate_statement=generated,
                actor=ADMIN,
            )
        self.assertEqual(job, "queued-job")
        self.assertEqual(captured["key"], _frozen_pdf_cache_key((statement, stored_lines)))

        self.conn.execute(
            "UPDATE quantity_sheets SET pi = ?, updated_at = ? WHERE id = ?", ("李新", "2027-01-02", "sheet-queued")
        )
        self.conn.execute(
            "UPDATE billing_workflows SET workflow_status = 'statement_generated' WHERE id = ?", ("workflow-queued",)
        )
        self.conn.commit()
        with patch(
            "server_app.web.pdf_exports.render_billing_statement_pdf", return_value=b"%PDF queued"
        ) as render_pdf:
            self.assertEqual(captured["render"](), b"%PDF queued")
        render_pdf.assert_called_once_with(statement, stored_lines, priority=0)
        generated.assert_not_called()

    def test_batch_pdf_queue_keeps_issued_documents_after_their_workflows_are_reverted(self):
        first_statement, first_lines = self.insert_workflow(
            "workflow-batch-first", "statement_sent", month="2027-03", pi="王力", amount=111
        )
        second_statement, second_lines = self.insert_workflow(
            "workflow-batch-second", "statement_sent", month="2027-03", pi="李新", amount=222
        )
        self.conn.commit()
        captured = {}

        def enqueue_batch(**kwargs):
            captured.update(kwargs)
            return "batch-job"

        generated = Mock(side_effect=AssertionError("issued batch PDF must not regenerate from live data"))
        requested = [
            {"month": "2027-03", "pi": "王力", "sourceType": "quantity_sheet"},
            {"month": "2027-03", "pi": "李新", "sourceType": "quantity_sheet"},
        ]
        with patch("server_app.web.pdf_exports.pdf_export_cache.enqueue_batch", side_effect=enqueue_batch):
            job = _start_billing_export(
                requested,
                ADMIN,
                lambda: self.conn,
                lambda *_: (_ for _ in ()).throw(AssertionError("issued batch must not inspect live sheets")),
                lambda *_: None,
                generated,
                str,
            )
        self.assertEqual(job, "batch-job")

        self.conn.execute("UPDATE billing_workflows SET workflow_status = 'statement_generated'")
        self.conn.commit()
        progress = Mock()
        with (
            patch("server_app.web.pdf_exports.pdf_export_cache.render_cached", side_effect=lambda _, render: render()),
            patch(
                "server_app.web.pdf_exports.render_billing_statement_pdf", side_effect=[b"first", b"second"]
            ) as render_pdf,
            patch("server_app.web.pdf_exports.build_pdf_zip", return_value=b"zip") as build_zip,
        ):
            self.assertEqual(captured["render"](progress), b"zip")
        render_pdf.assert_has_calls(
            [
                unittest.mock.call(first_statement, first_lines),
                unittest.mock.call(second_statement, second_lines),
            ]
        )
        build_zip.assert_called_once_with(
            [
                (unittest.mock.ANY, b"first"),
                (unittest.mock.ANY, b"second"),
            ]
        )
        progress.assert_has_calls([unittest.mock.call(1), unittest.mock.call(2)])
        generated.assert_not_called()


if __name__ == "__main__":
    unittest.main()
