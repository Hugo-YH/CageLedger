import io
import json
import tempfile
import unittest
from contextlib import nullcontext
from pathlib import Path
from unittest.mock import patch

from pypdf import PdfReader

from server_app.domains.animal_management import service
from server_app.pdf.animal_inspection import animal_inspection_html
from server_app.pdf.cache import PdfExportCache
from server_app.shared.concurrency import StaleWriteError
from server_app.web import animal_inspection
from server_app.web.read_inspection_actions import ReadInspectionActionsMixin
from tests import test_animal_inspection as inspection_fixture

ACTOR = inspection_fixture.ACTOR


class AnimalInspectionPerformanceTests(unittest.TestCase):
    setUp = inspection_fixture.AnimalInspectionServiceTests.setUp
    tearDown = inspection_fixture.AnimalInspectionServiceTests.tearDown
    seed_many_findings = inspection_fixture.AnimalInspectionServiceTests.seed_many_findings

    def draft(self):
        body = {
            "roomId": "room-1",
            "moduleCodes": ["abnormalAnimalAssessment"],
            "answers": [
                {"moduleCode": "abnormalAnimalAssessment", "nodeCode": "abnormal_07_02_01", "outcome": "abnormal"}
            ],
        }
        return service.create_or_update_inspection(self.conn, ACTOR, None, body)["item"], body

    def test_display_and_edit_are_small_equivalent_authorized_read_only_projections(self):
        inspection_id = self.seed_many_findings(25)
        full = service.get_inspection(self.conn, ACTOR, inspection_id)
        before = self.conn.total_changes
        statements = []
        self.conn.set_trace_callback(statements.append)
        display = service.get_inspection(self.conn, ACTOR, inspection_id, view="display")
        self.conn.set_trace_callback(None)
        edit = service.get_inspection(self.conn, ACTOR, inspection_id, view="edit")
        self.assertEqual(edit, {key: full[key] for key in ("item", "answers")})
        self.assertEqual(display["item"], full["item"])
        self.assertEqual(display["answers"], full["answers"])
        self.assertEqual(
            display["catalog"]["nodes"],
            [{key: node[key] for key in ("moduleCode", "code", "name")} for node in full["catalog"]["nodes"]],
        )
        for small, original in zip(display["findings"], full["findings"], strict=True):
            self.assertEqual(small["attachmentCount"], len(original["attachments"]))
            self.assertEqual(
                {k: v for k, v in small.items() if k != "attachmentCount"},
                {k: original[k] for k in small if k != "attachmentCount"},
            )
        self.assertFalse(any("finding_events" in sql for sql in statements))
        self.assertLess(len(json.dumps(display)), len(json.dumps(full)) / 3)
        self.assertEqual(animal_inspection_html(display), animal_inspection_html(full))
        for view in ("display", "edit"):
            with self.assertRaises(PermissionError):
                service.get_inspection(
                    self.conn, {"id": "other", "role": "user", "roomIds": []}, inspection_id, view=view
                )
            self.assertEqual(
                service.get_inspection(
                    self.conn, {"id": "other", "role": "user", "roomIds": ["room-1"]}, inspection_id, view=view
                )["item"],
                full["item"],
            )
        self.assertEqual(self.conn.total_changes, before)

    def test_catalog_summary_preserves_visible_counts_and_current_catalog(self):
        full = service.catalog_payload(self.conn, ACTOR)
        before = self.conn.total_changes
        small = service.catalog_payload(self.conn, ACTOR, view="summary")
        self.assertEqual(
            {k: small[k] for k in ("version", "modules", "reviewNotice")},
            {k: full[k] for k in ("version", "modules", "reviewNotice")},
        )
        self.assertEqual(
            small["moduleItemCounts"],
            {"basicAssessment": 32, "advancedAssessment": 26, "abnormalAnimalAssessment": 125},
        )
        self.assertNotIn("nodes", small)
        self.assertLess(len(json.dumps(small)), len(json.dumps(full)) / 20)
        self.assertEqual(self.conn.total_changes, before)
        with self.assertRaises(PermissionError):
            service.catalog_payload(self.conn, None, view="summary")

    def test_optional_exact_versions_reject_stale_save_and_submit_without_writes(self):
        item, body = self.draft()
        statements = []
        self.conn.set_trace_callback(statements.append)
        newer = service.create_or_update_inspection(
            self.conn, ACTOR, item["id"], {**body, "expectedUpdatedAt": item["updatedAt"]}
        )["item"]
        self.conn.set_trace_callback(None)
        self.assertEqual(statements[0], "BEGIN IMMEDIATE")
        self.assertNotEqual(newer["updatedAt"], item["updatedAt"])
        for expected in (item["updatedAt"], "", f" {newer['updatedAt']} ", None):
            for operation in (
                lambda expected=expected: service.create_or_update_inspection(
                    self.conn, ACTOR, item["id"], {**body, "expectedUpdatedAt": expected}
                ),
                lambda expected=expected: service.submit_inspection(
                    self.conn, ACTOR, item["id"], {"expectedUpdatedAt": expected}
                ),
            ):
                before = self.conn.total_changes
                with self.conn:
                    with self.assertRaises(StaleWriteError):
                        operation()
                self.assertEqual(self.conn.total_changes, before)
        # Explicit manual save remains an audited action, even with identical answers.
        self.assertEqual(
            self.conn.execute(
                "SELECT COUNT(*) FROM audit_events WHERE action = 'animal_inspection.draft_saved'"
            ).fetchone()[0],
            2,
        )
        submitted = service.submit_inspection(self.conn, ACTOR, item["id"], {"expectedUpdatedAt": newer["updatedAt"]})
        self.assertEqual(submitted["item"]["status"], "submitted")
        legacy, _ = self.draft()
        self.assertEqual(service.submit_inspection(self.conn, ACTOR, legacy["id"])["item"]["status"], "submitted")

    def test_pdf_reuses_identical_output_but_reauthorizes_and_tracks_render_inputs(self):
        item, _ = self.draft()
        submitted = service.submit_inspection(self.conn, ACTOR, item["id"])
        with tempfile.TemporaryDirectory() as directory:
            cache = PdfExportCache(Path(directory))
            with (
                patch.object(service, "pdf_export_cache", cache),
                patch.object(
                    service,
                    "render_animal_inspection_pdf",
                    side_effect=lambda detail: animal_inspection_html(detail).encode(),
                ) as render,
            ):
                original = service.export_inspection_pdf(self.conn, ACTOR, item["id"])
                self.assertEqual(service.export_inspection_pdf(self.conn, ACTOR, item["id"]), original)
                self.assertEqual(render.call_count, 1)
                with self.assertRaises(PermissionError):
                    service.export_inspection_pdf(self.conn, {"id": "other", "role": "user", "roomIds": []}, item["id"])
                finding_id = submitted["findings"][0]["id"]
                service.update_finding(
                    self.conn,
                    ACTOR,
                    finding_id,
                    {"status": "pending_recheck", "actionNote": "已处理", "recheckDueAt": "2026-12-01"},
                )
                changed = service.export_inspection_pdf(self.conn, ACTOR, item["id"])
                self.assertNotEqual(changed[0], original[0])
                self.assertEqual(render.call_count, 2)
                self.conn.execute(
                    "UPDATE inspection_catalog_nodes SET name = '更新名称' WHERE code = 'abnormal_07_02_01'"
                )
                self.conn.commit()
                renamed = service.export_inspection_pdf(self.conn, ACTOR, item["id"])
                self.assertIn("更新名称".encode(), renamed[0])
                self.assertEqual(render.call_count, 3)
                service.resolve_finding(self.conn, ACTOR, finding_id, {"conclusion": "完成"})
                render.side_effect = RuntimeError("暂时失败")
                with self.assertRaises(RuntimeError):
                    service.export_inspection_pdf(self.conn, ACTOR, item["id"])
                render.side_effect = lambda detail: animal_inspection_html(detail).encode()
                self.assertIn(b"resolved", service.export_inspection_pdf(self.conn, ACTOR, item["id"])[0])
                self.assertEqual(render.call_count, 5)

    def test_versioned_submission_refreshes_room_snapshot_without_saving_answers_again(self):
        item, _ = self.draft()
        legacy, _ = self.draft()
        before_answers = list(self.conn.execute("SELECT * FROM animal_inspection_answers ORDER BY id"))
        before_audits = self.conn.execute("SELECT COUNT(*) FROM audit_events").fetchone()[0]
        self.conn.execute(
            "UPDATE rooms SET name = ?, area = ?, payload = ? WHERE id = 'room-1'",
            ("新饲养间", "新设施", json.dumps({"id": "room-1", "name": "新饲养间", "facility": "新设施"})),
        )
        for status, count in (("active", 3), ("reserved", 4), ("closed", 99)):
            self.conn.execute(
                """INSERT INTO occupancies (id, room_id, status, animal_count, iacuc, pi, species, cage_code, payload)
                   VALUES (?, 'room-1', ?, ?, 'IACUC-1', '负责人', '小鼠', ?, '{}')""",
                (status, status, count, status),
            )
        self.conn.commit()
        statements = []
        self.conn.set_trace_callback(statements.append)
        actual = service.submit_inspection(self.conn, ACTOR, item["id"], {"expectedUpdatedAt": item["updatedAt"]})[
            "item"
        ]
        self.conn.set_trace_callback(None)
        self.assertEqual(actual["roomName"], "新饲养间")
        self.assertEqual(actual["facility"], "新设施")
        self.assertEqual(
            actual["snapshot"],
            {
                "iacucs": ["IACUC-1"],
                "pis": ["负责人"],
                "species": ["小鼠"],
                "animalCount": 7,
                "cageCodes": ["active", "reserved"],
            },
        )
        self.assertEqual(before_answers, list(self.conn.execute("SELECT * FROM animal_inspection_answers ORDER BY id")))
        self.assertFalse(
            any(
                sql.startswith(("INSERT INTO animal_inspection_answers", "DELETE FROM animal_inspection_answers"))
                for sql in statements
            )
        )
        row = self.conn.execute(
            "SELECT room_name, facility, snapshot_json, payload FROM animal_inspections WHERE id = ?", (item["id"],)
        ).fetchone()
        self.assertEqual((row["room_name"], row["facility"]), (actual["roomName"], actual["facility"]))
        self.assertEqual(json.loads(row["snapshot_json"]), actual["snapshot"])
        self.assertEqual(json.loads(row["payload"]), actual)
        audit = self.conn.execute(
            "SELECT payload, message FROM audit_events WHERE action = 'animal_inspection.submitted' AND entity_id = ?",
            (item["id"],),
        ).fetchone()
        self.assertEqual(json.loads(audit["payload"])["before"], item)
        self.assertEqual(json.loads(audit["payload"])["after"], actual)
        self.assertIn("新饲养间", audit["message"])
        self.assertEqual(self.conn.execute("SELECT COUNT(*) FROM audit_events").fetchone()[0], before_audits + 1)
        self.assertEqual(
            service.submit_inspection(self.conn, ACTOR, legacy["id"])["item"]["snapshot"], legacy["snapshot"]
        )
        failed, _ = self.draft()
        before = self.conn.total_changes
        with self.conn, patch.object(service, "_room_snapshot", side_effect=LookupError("饲养间不存在")):
            with self.assertRaises(LookupError):
                service.submit_inspection(self.conn, ACTOR, failed["id"], {"expectedUpdatedAt": failed["updatedAt"]})
        self.assertEqual(self.conn.total_changes, before)
        self.assertEqual(service.get_inspection(self.conn, ACTOR, failed["id"])["item"]["status"], "draft")

    def test_get_adapters_select_views_and_write_conflicts_are_409(self):
        item, body = self.draft()

        class Handler(ReadInspectionActionsMixin):
            path = f"/api/animal-inspections/{item['id']}?view=edit"

            def require_user(self):
                return ACTOR

            def send_json(self, payload, status=200):
                self.response, self.status = payload, status

            def read_json_body(self):
                return {**body, "expectedUpdatedAt": "stale"}

            def read_optional_json_body(self):
                return {"expectedUpdatedAt": "stale"}

        handler = Handler()
        with patch("server_app.web.read_inspection_actions.connect_db", return_value=nullcontext(self.conn)):
            handler.get_animal_inspection(handler.path, item["id"])
            self.assertEqual(set(handler.response), {"item", "answers"})
        with patch.object(animal_inspection, "connect_db", side_effect=lambda: self.conn):
            animal_inspection.save_inspection(handler, item["id"])
            self.assertEqual(handler.status, 409)
            animal_inspection.submit_inspection_record(handler, item["id"])
            self.assertEqual(handler.status, 409)
            handler.path = "/api/animal-inspection-catalog?view=summary"
            animal_inspection.handle_get(handler, "/api/animal-inspection-catalog")
            self.assertIn("moduleItemCounts", handler.response)

    def test_real_pdf_uses_display_projection_and_reuses_artifact(self):
        item, _ = self.draft()
        service.submit_inspection(self.conn, ACTOR, item["id"])
        with (
            tempfile.TemporaryDirectory() as directory,
            patch.object(service, "pdf_export_cache", PdfExportCache(Path(directory))),
            patch.object(service, "render_animal_inspection_pdf", wraps=service.render_animal_inspection_pdf) as render,
        ):
            body, filename = service.export_inspection_pdf(self.conn, ACTOR, item["id"])
            self.assertTrue(body.startswith(b"%PDF"))
            self.assertTrue(filename.endswith(".pdf"))
            text = "".join(page.extract_text() for page in PdfReader(io.BytesIO(body)).pages)
            self.assertIn("测试饲养间", text)
            self.assertIn(item["id"], text)
            self.assertEqual(service.export_inspection_pdf(self.conn, ACTOR, item["id"])[0], body)
            self.assertEqual(render.call_count, 1)

    def test_default_page_and_event_lookup_use_indexes(self):
        for sql, index in (
            (
                "SELECT id FROM animal_inspections ORDER BY updated_at DESC, id DESC LIMIT 20",
                "idx_animal_inspections_updated_id",
            ),
            (
                "SELECT * FROM animal_inspection_finding_events WHERE finding_id = 'x' ORDER BY at, rowid",
                "idx_animal_finding_events_finding_at",
            ),
        ):
            plan = " ".join(row[3] for row in self.conn.execute("EXPLAIN QUERY PLAN " + sql))
            self.assertIn(index, plan)
            self.assertNotIn("TEMP B-TREE", plan)
