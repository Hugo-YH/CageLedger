"""Isolated evidence-to-registration regressions; no provider or production data access."""

import copy
import hashlib
import json
import sqlite3
import subprocess
import tempfile
import unittest
from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime, timedelta
from io import BytesIO
from pathlib import Path
from threading import Barrier
from unittest.mock import Mock, patch
from uuid import uuid4

from openpyxl import load_workbook

from server_app.domains.reception import certificate_ai as ai
from server_app.domains.reception import certificate_files as files
from server_app.domains.reception import certificate_pages as pages
from server_app.domains.reception import certificate_repository as repo
from server_app.domains.reception import certificate_routes as routes
from server_app.domains.reception import certificate_service as certificates
from server_app.domains.reception import registration_service as registrations
from server_app.domains.reception import repository, service, workbook
from server_app.persistence.bootstrap import initialize_schema
from server_app.repositories.entities import upsert_intake_batch
from server_app.shared.concurrency import StaleWriteError
from server_app.shared.sqlite import ClosingConnection

ACTOR = {"id": "certificate-admin", "username": "admin", "displayName": "管理员", "role": "admin"}
PDF = b"%PDF-1.7\nsynthetic certificate"
PNG = b"\x89PNG\r\n\x1a\nsynthetic preview"


class ReceptionCertificateTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory(prefix="reception-certificates-")
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        self.path = self.root / "test.sqlite"
        self.file_root = self.root / "attachments"
        self.conn = self.connect()
        self.addCleanup(self.conn.close)
        initialize_schema(self.conn)
        self.batch = {"id": "received-1", "batchNo": "BATCH-1", "iacuc": "Z2026001"}
        self.batch.update(purchaseOrderNo="0000123", pi="预约PI", owner="预约人", supplier="广东维通利华")
        self.batch.update(strainRaw="c57", strainStandard="C57BL/6J", species="mouse", sex="雌雄", quantity=6)
        self.batch.update(specification="6-8周", finalCardCount=2, roomName="8105", intakeDate="2026-10-20")
        self.batch.update(status="received", updatedAt="2026-11-01T01:00:00", notes="预约备注")
        self.batch["receipts"] = [{"id": "receipt-1", "actualReceiptDate": "2026-10-31", "cardCount": 2}]
        self.index = {
            "source": "synthetic.xlsx",
            "updatedAt": "2026-11-01",
            "items": [
                {
                    "iacuc": "Z2026001",
                    "pi": "申请PI",
                    "owner": "申请人",
                    "project": "申请项目",
                    "funding": "申请经费",
                    "fundCode": "F1",
                    "projectEndDate": "2027-01-01",
                }
            ],
        }
        self.put()
        page_selection = patch.object(
            pages,
            "prepare",
            return_value=(
                [{"pageNumber": 1, "image": PNG}],
                {"totalPages": 2, "selectedPages": [1], "skippedPhotoPages": [2], "mode": "auto"},
            ),
        )
        self.page_prepare = page_selection.start()
        self.addCleanup(page_selection.stop)
        for target, name, value in (
            (files, "RECEPTION_CERTIFICATE_FILES_PATH", self.file_root),
            (certificates, "connect_db", self.connect),
            (routes, "connect_db", self.connect),
            (repository, "read_iacuc_index", lambda *_: self.index),
            (certificates, "emit_event", Mock()),
        ):
            context = patch.object(target, name, value)
            context.start()
            self.addCleanup(context.stop)

    def connect(self):
        conn = sqlite3.connect(self.path, factory=ClosingConnection)
        conn.row_factory = sqlite3.Row
        return conn

    def put(self, **changes):
        self.batch.update(changes)
        upsert_intake_batch(self.conn, self.batch)
        self.conn.commit()

    def payload(self):
        return self.conn.execute("SELECT payload FROM intake_batches WHERE id=?", (self.batch["id"],)).fetchone()[0]

    def count(self, action):
        return self.conn.execute("SELECT count(*) FROM audit_events WHERE action=?", (action,)).fetchone()[0]

    def prepared(self, name, content):
        return {
            "name": files.filename(name),
            "sha256": hashlib.sha256(content).hexdigest(),
            "size": len(content),
            "page_count": 2,
        }, PNG

    def upload(self, suffix=b"", actor=None):
        with patch.object(files, "prepare", side_effect=self.prepared):
            return certificates.upload(
                actor or ACTOR, self.batch["id"], self.batch["updatedAt"], "合格证.pdf", PDF + suffix
            )["attachment"]

    def line(self, attachment_id, **changes):
        return {
            "id": uuid4().hex,
            "attachmentId": attachment_id,
            "runId": None,
            "certificateIndex": 1,
            "certificateLineIndex": 1,
            "certificateNo": "No.: SCXK(粤)2026-000001-12345678901234567890",
            "certificateStrain": "证载C57",
            "grade": "SPF级",
            "supplier": "广东维通利华实验动物技术有限公司",
            "sex": "雄性",
            "quantity": 3,
            "weightRaw": "18-22克",
            "ageRaw": "6-8周",
            "specification": "18-22克 / 6-8周",
            "receiptId": None,
            "experimentCertificateNo": "E-1",
            "notes": "证载备注",
            **changes,
        }

    def body(self, lines, **changes):
        saved = repo.registration(self.conn, self.batch["id"])
        return {
            "requestId": uuid4().hex,
            "expectedBatchUpdatedAt": self.batch["updatedAt"],
            "expectedRegistrationUpdatedAt": saved["updatedAt"] if saved else None,
            "expectedApplicationVersion": repository.context(self.conn)["version"],
            "acknowledged": True,
            "lines": lines,
            **changes,
        }

    def save(self, body, actor=None):
        try:
            result = registrations.save(self.conn, actor or ACTOR, self.batch["id"], body)["registration"]
            self.conn.commit()
            return result
        except Exception:
            self.conn.rollback()
            raise

    def extraction(self):
        return {
            "certificates": [
                {
                    "certificateNo": "No.: SCXK(粤)2026-000001-12345678901234567890",
                    "certificateStrain": "C57BL/6J",
                    "grade": "SPF级",
                    "supplier": "广东维通利华实验动物技术有限公司",
                    "productionLicenseNo": "PRODUCTION",
                    "issueDate": "2026-10-01",
                    "lines": [
                        {"sex": "male", "quantity": 3, "weightRaw": "10-30g", "ageRaw": "54天"},
                        {"sex": "female", "quantity": None, "weightRaw": "-", "ageRaw": "28"},
                        {"sex": "female", "quantity": 0, "weightRaw": "", "ageRaw": ""},
                    ],
                    "uncertainFields": ["雌性数量"],
                },
                {
                    "certificateNo": "合格证编号：SECOND-0002",
                    "certificateStrain": "SD",
                    "grade": "普通级",
                    "supplier": "出售单位B",
                    "lines": [{"sex": "雌", "quantity": 2.0, "ageRaw": "42-45周"}],
                },
            ]
        }

    def recognize(self, attachment_id, request_id=None, **changes):
        return certificates.recognize(
            ACTOR,
            self.batch["id"],
            attachment_id,
            {
                "requestId": request_id or uuid4().hex,
                "expectedBatchUpdatedAt": self.batch["updatedAt"],
                **changes,
            },
        )["run"]

    def export_body(self):
        listed = service.list_records(self.conn, ACTOR, {})
        item = listed["items"][0]
        return {
            "ids": [item["id"]],
            "expectedVersions": {item["id"]: item["updatedAt"]},
            "expectedApplicationVersion": listed["applicationVersion"],
        }

    def test_schema_is_idempotent_and_preserves_existing_evidence(self):
        attachment = self.upload()
        before = self.payload()
        schema = list(
            self.conn.execute("SELECT name,sql FROM sqlite_master WHERE name LIKE 'reception_%' ORDER BY name")
        )
        for _ in range(2):
            repo.ensure_schema(self.conn)
            initialize_schema(self.conn)
        self.assertEqual(
            [tuple(row) for row in schema],
            [
                tuple(row)
                for row in self.conn.execute(
                    "SELECT name,sql FROM sqlite_master WHERE name LIKE 'reception_%' ORDER BY name"
                )
            ],
        )
        self.assertEqual(repo.attachments(self.conn, self.batch["id"])[0]["id"], attachment["id"])
        self.assertEqual(self.payload(), before)

    def test_pdf_limits_type_and_bounded_rendering(self):
        for name, content in (
            ("a.png", PDF),
            ("a.pdf", b"not a pdf"),
            ("a.pdf", b""),
            ("a.pdf", b"x" * (files.MAX_FILE_BYTES + 1)),
        ):
            with self.subTest(name=name, size=len(content)), patch.object(files, "tool") as tool:
                with self.assertRaises(ValueError):
                    files.prepare(name, content)
                tool.assert_not_called()

        def render(command, **kwargs):
            if command[0] == "pdfinfo":
                kwargs["stdout"].write(b"Pages: 2\nEncrypted: no\n")
            else:
                Path(command[-1] + ".png").write_bytes(PNG)
            return Mock(returncode=0)

        with (
            patch.object(files, "tool", side_effect=lambda _configured, name: name),
            patch.object(files.subprocess, "run", side_effect=render) as run,
        ):
            metadata, preview = files.prepare("../folder/证件.pdf", PDF)
        self.assertEqual((metadata["name"], metadata["page_count"], preview), ("证件.pdf", 2, PNG))
        self.assertEqual(metadata["sha256"], hashlib.sha256(PDF).hexdigest())
        self.assertEqual([call.kwargs["timeout"] for call in run.call_args_list], [15, 30])
        for info in (b"Pages: 0\n", b"Pages: 101\n", b"Pages: 1\nEncrypted: yes\n", b"corrupt"):

            def invalid_info(_command, *, info=info, **kwargs):
                kwargs["stdout"].write(info)
                return Mock(returncode=0)

            with (
                self.subTest(info=info),
                patch.object(files, "tool", return_value="pdfinfo"),
                patch.object(files.subprocess, "run", side_effect=invalid_info),
                self.assertRaises(ValueError),
            ):
                files.prepare("a.pdf", PDF)
        with (
            patch.object(files, "tool", return_value="pdfinfo"),
            patch.object(files.subprocess, "run", side_effect=subprocess.TimeoutExpired("pdfinfo", 15)),
            self.assertRaises(files.CertificateUnavailableError),
        ):
            files.prepare("a.pdf", PDF)

    def test_opaque_paths_file_rollback_and_symlink_rejection(self):
        for identity in ("../escape", "a" * 31, "A" * 32, "/tmp/file"):
            with self.subTest(identity=identity), self.assertRaises(LookupError):
                files.path(identity)
        identity = "a" * 32
        with self.assertRaisesRegex(RuntimeError, "rollback"), files.store(identity, PDF, PNG):
            raise RuntimeError("rollback")
        self.assertEqual(list(self.file_root.iterdir()), [])
        with files.store(identity, PDF, PNG) as commit:
            commit()
        with self.assertRaises(FileExistsError), files.store(identity, b"replacement", PNG):
            pass
        self.assertEqual(files.read(identity), PDF)
        collision = "b" * 32
        files.path(collision, preview=True).write_bytes(PNG)
        with self.assertRaises(FileExistsError), files.store(collision, PDF, b"replacement"):
            pass
        self.assertFalse(files.path(collision).exists())
        self.assertEqual(files.read(collision, preview=True), PNG)
        outside = self.root / "outside.png"
        outside.write_bytes(PNG)
        files.path(identity, preview=True).unlink()
        files.path(identity, preview=True).symlink_to(outside)
        with self.assertRaises(LookupError):
            files.read(identity, preview=True)
        with files.path(identity).open("wb") as output:
            output.truncate(files.MAX_FILE_BYTES + 1)
        with self.assertRaises(ValueError):
            files.read(identity)

    def test_upload_deduplicates_sha_without_repeated_audit_or_appointment_write(self):
        before = self.payload()
        with patch.object(files, "prepare", side_effect=self.prepared) as render:
            first = certificates.upload(ACTOR, self.batch["id"], self.batch["updatedAt"], "../first.pdf", PDF)
            second = certificates.upload(ACTOR, self.batch["id"], self.batch["updatedAt"], "renamed.pdf", PDF)
        self.assertFalse(first["reused"])
        self.assertTrue(second["reused"])
        self.assertEqual(first["attachment"], second["attachment"])
        self.assertEqual(render.call_count, 1)
        self.assertEqual(self.count("reception.certificate_uploaded"), 1)
        self.assertEqual(self.payload(), before)
        self.assertIsNone(repo.registration(self.conn, self.batch["id"]))

    def test_upload_guards_state_version_and_rolls_back_files_and_database(self):
        for status, expected in (("received", None), ("received", "wrong"), ("printed", self.batch["updatedAt"])):
            self.put(status=status)
            with self.subTest(status=status, expected=expected), patch.object(files, "prepare") as render:
                with self.assertRaises(StaleWriteError):
                    certificates.upload(ACTOR, self.batch["id"], expected, "a.pdf", PDF)
                render.assert_not_called()
        self.put(status="received")
        with (
            patch.object(certificates, "audit", side_effect=RuntimeError("audit unavailable")),
            self.assertRaises(RuntimeError),
        ):
            self.upload()
        self.assertEqual(repo.attachments(self.conn, self.batch["id"]), [])
        self.assertEqual(list(self.file_root.iterdir()), [])
        original = self.batch["updatedAt"]

        def racing_prepare(name, content):
            self.put(updatedAt="2026-11-01T02:00:00")
            return self.prepared(name, content)

        with patch.object(files, "prepare", side_effect=racing_prepare), self.assertRaises(StaleWriteError):
            certificates.upload(ACTOR, self.batch["id"], original, "a.pdf", PDF)
        self.assertEqual(repo.attachments(self.conn, self.batch["id"]), [])
        self.assertEqual(list(self.file_root.iterdir()), [])
        self.assertEqual(self.count("reception.certificate_uploaded"), 0)

    def test_concurrent_same_sha_uploads_commit_one_evidence_pair_and_audit(self):
        barrier = Barrier(2, timeout=5)
        batch_id, version = self.batch["id"], self.batch["updatedAt"]

        def concurrent_prepare(name, content):
            barrier.wait()
            return self.prepared(name, content)

        with patch.object(files, "prepare", side_effect=concurrent_prepare), ThreadPoolExecutor(max_workers=2) as pool:
            futures = [
                pool.submit(certificates.upload, ACTOR, batch_id, version, f"same-{index}.pdf", PDF)
                for index in range(2)
            ]
            results = [future.result(timeout=15) for future in futures]
        self.assertEqual(sorted(result["reused"] for result in results), [False, True])
        self.assertEqual(results[0]["attachment"], results[1]["attachment"])
        self.assertEqual(len(repo.attachments(self.conn, batch_id)), 1)
        self.assertEqual(self.count("reception.certificate_uploaded"), 1)
        identity = results[0]["attachment"]["id"]
        self.assertEqual({item.name for item in self.file_root.iterdir()}, {f"{identity}.pdf", f"{identity}.png"})

    def test_authentication_happens_before_opening_database(self):
        for command in ("GET", "POST", "PUT"):
            handler = Mock(command=command, path="/api/receptions/received-1/registration")
            handler.current_user.return_value = None
            with self.subTest(command=command), patch.object(routes, "connect_db") as connect:
                self.assertEqual(routes.handle(handler, {"batchId": self.batch["id"]}).status, 401)
                connect.assert_not_called()
        for role in ("viewer", "unexpected", "", None):
            handler = Mock(command="PUT", path="/api/receptions/received-1/registration")
            handler.current_user.return_value = {**ACTOR, "role": role}
            with self.subTest(role=role), patch.object(routes, "connect_db") as connect:
                self.assertEqual(routes.handle(handler, {"batchId": self.batch["id"]}).status, 403)
                connect.assert_not_called()
        for role in ("admin", "room_admin"):
            with self.subTest(role=role):
                attachment = self.upload(role.encode(), {**ACTOR, "role": role, "roomIds": []})
                self.assertTrue(attachment["id"])
        with self.assertRaises(PermissionError):
            self.upload(b"inactive", {**ACTOR, "active": False})
        self.assertFalse(certificates.detail(self.conn, {**ACTOR, "role": "viewer"}, self.batch["id"])["canWrite"])

    def test_multiple_certificates_keep_null_filter_zero_and_preserve_number_and_raw_facts(self):
        before = copy.deepcopy(self.batch)
        result, raw = ai.normalize(self.extraction(), "attachment", "run", self.batch)
        rows = result["lines"]
        self.assertEqual(
            [(r["certificateIndex"], r["certificateLineIndex"], r["quantity"]) for r in rows],
            [(1, 1, 3), (1, 2, None), (2, 1, 2)],
        )
        self.assertEqual(rows[0]["certificateNo"], "SCXK(粤)2026-000001-12345678901234567890")
        self.assertEqual(rows[2]["certificateNo"], "SECOND-0002")
        self.assertEqual([r["specification"] for r in rows], ["10-30g / 54d", "", "42-45w"])
        self.assertEqual((rows[0]["grade"], rows[0]["sex"], rows[1]["sex"]), ("SPF", "雄性", "雌性"))
        self.assertTrue(all(r["receiptId"] is None for r in rows))
        self.assertEqual(raw["certificates"][0]["productionLicenseNo"], "PRODUCTION")
        self.assertEqual(raw["certificates"][0]["lines"][2]["quantity"], 0)
        self.assertTrue(any("未明确数量" in warning for warning in result["warnings"]))
        self.assertEqual(self.batch, before)

    def test_standalone_slash_quantity_is_zero_and_does_not_generate_a_review_prompt(self):
        for slash in ("/", "／", " / "):
            with self.subTest(slash=slash):
                extraction = self.extraction()
                extraction["certificates"] = extraction["certificates"][:1]
                certificate = extraction["certificates"][0]
                certificate["lines"] = [
                    {"sex": "male", "quantity": 3, "quantityRaw": "3", "ageRaw": "6周"},
                    {"sex": "female", "quantity": None, "quantityRaw": slash, "ageRaw": "6周"},
                ]
                certificate["uncertainFields"] = ["雌性数量", "quantity"]
                extraction["warnings"] = ["雌性数量原文为“/”，请核对", "证号被印章遮挡，请核对"]
                result, raw = ai.normalize(
                    extraction, "attachment", "run", {"species": "mouse", "sex": "雄性", "quantity": 3}
                )
                self.assertEqual([(line["sex"], line["quantity"]) for line in result["lines"]], [("雄性", 3)])
                self.assertEqual(result["warnings"], ["证号被印章遮挡，请核对"])
                self.assertEqual(raw["certificates"][0]["lines"][1]["quantity"], 0)
                self.assertEqual(raw["certificates"][0]["lines"][1]["quantityRaw"], slash.strip())
                self.assertEqual(raw["certificates"][0]["uncertainFields"], ["雌性数量", "quantity"])
        self.assertEqual(ai._quantity({"quantity": "/"}), (0, "/", True))
        self.assertEqual(ai._quantity({"quantity": 99, "quantityRaw": "/"}), (0, "/", True))

    def test_slash_rule_keeps_blank_ambiguous_and_mixed_issue_warnings(self):
        for raw in ("", "-", "13/8", "看不清"):
            with self.subTest(raw=raw):
                extraction = self.extraction()
                extraction["certificates"] = extraction["certificates"][:1]
                certificate = extraction["certificates"][0]
                certificate["lines"] = [
                    {"sex": "male", "quantity": 3, "quantityRaw": "3", "ageRaw": "6周"},
                    {"sex": "female", "quantity": None, "quantityRaw": raw, "ageRaw": "6周"},
                ]
                result, evidence = ai.normalize(extraction, "attachment", "run", {})
                self.assertIsNone(result["lines"][1]["quantity"])
                self.assertTrue(any("未明确数量" in note for note in result["warnings"]))
                self.assertEqual(evidence["certificates"][0]["lines"][1]["quantityRaw"], raw)
        self.assertEqual(ai._quantity({"quantity": "/", "quantityRaw": "13/8"}), (None, "13/8", False))
        self.assertFalse(ai._slash_quantity_note("雌性数量为/，但雄性数量被印章遮挡", {"雌性"}))
        self.assertFalse(ai._slash_quantity_note("数量为/，但另一张证件数量不清", {"雌性"}))
        self.assertFalse(ai._slash_quantity_note("体重/日龄缺少单位", {"雌性"}))
        self.assertFalse(ai._slash_quantity_note("雄性数量为/，请核对", {"雌性"}))
        self.assertFalse(ai._slash_quantity_note("数量原文为13/8，请核对", {"雌性"}))
        self.assertFalse(ai._slash_quantity_note("雌性数量为/，还有数量13/8需核对", {"雌性"}))

    def test_failed_ai_attempt_is_persisted_audited_and_replayed_without_provider_call(self):
        attachment = self.upload()
        identity = uuid4().hex
        before = self.payload()
        with patch.object(ai, "recognize", side_effect=ValueError("图片模糊，请人工核对")) as provider:
            first = self.recognize(attachment["id"], identity)
            second = self.recognize(attachment["id"], identity)
        self.assertEqual(first, second)
        self.assertEqual(first["status"], "failed")
        self.assertEqual(first["error"], "图片模糊，请人工核对")
        self.assertIsNone(first["result"])
        self.assertEqual(provider.call_count, 1)
        self.assertEqual(self.count("reception.certificate_recognition_started"), 1)
        self.assertEqual(self.count("reception.certificate_recognition_failed"), 1)
        self.assertEqual(self.payload(), before)

    def test_multi_page_source_selection_and_mode_binding_are_audited_without_registration(self):
        attachment = self.upload()
        selection = {"totalPages": 2, "selectedPages": [1, 2], "skippedPhotoPages": [], "mode": "auto"}
        images = [{"pageNumber": number, "image": PNG} for number in (1, 2)]
        self.page_prepare.return_value = (images, selection)
        result, raw = ai.normalize(self.extraction(), attachment["id"], "source-run", self.batch)
        before = self.payload()
        identity = uuid4().hex
        with patch.object(ai, "recognize", return_value=(result, raw, {})) as provider:
            run = self.recognize(attachment["id"], identity)
            self.assertEqual(run["result"]["pageSelection"], selection)
            self.assertEqual(provider.call_args.args[0], images)
            self.assertEqual(self.recognize(attachment["id"], identity), run)
            with self.assertRaises(StaleWriteError):
                self.recognize(attachment["id"], identity, includeAllPages=True)
            self.assertEqual(provider.call_count, 1)
        self.assertEqual(self.payload(), before)
        self.assertIsNone(repo.registration(self.conn, self.batch["id"]))
        stored = json.loads(
            self.conn.execute("SELECT raw_json FROM reception_certificate_runs WHERE id=?", (run["id"],)).fetchone()[0]
        )
        self.assertEqual(stored["pageSelectionMode"], "auto")
        self.assertEqual(stored["pageSelection"], selection)
        self.assertEqual(self.count("reception.certificate_recognized"), 1)

    def test_all_page_failed_requests_replay_in_the_same_mode_without_provider_replay(self):
        attachment = self.upload()
        identity = uuid4().hex
        with patch.object(ai, "recognize", side_effect=ValueError("未识别到合格证")) as provider:
            run = self.recognize(attachment["id"], identity, includeAllPages=True)
            self.assertEqual(run["status"], "failed")
            self.assertEqual(self.recognize(attachment["id"], identity, includeAllPages=True), run)
            with self.assertRaises(StaleWriteError):
                self.recognize(attachment["id"], identity)
            self.assertEqual(provider.call_count, 1)
            self.assertTrue(self.page_prepare.call_args.kwargs["include_all"])
        for invalid in (None, "true", 1, []):
            with self.subTest(value=invalid), self.assertRaises(ValueError):
                self.recognize(attachment["id"], includeAllPages=invalid)

    def test_same_size_pdf_and_preview_tampering_is_rejected_before_download_or_ai(self):
        with patch.object(ai, "recognize") as provider:
            for preview in (False, True):
                with self.subTest(preview=preview):
                    attachment = self.upload(str(preview).encode())
                    target = files.path(attachment["id"], preview=preview)
                    content = target.read_bytes()
                    target.write_bytes(content[:-1] + bytes([content[-1] ^ 1]))
                    self.assertEqual(target.stat().st_size, len(content))
                    with self.assertRaises(files.CertificateUnavailableError):
                        certificates.download(self.conn, ACTOR, self.batch["id"], attachment["id"], preview=preview)
                    if preview:
                        failed = self.recognize(attachment["id"])
                        self.assertEqual(failed["status"], "failed")
                        self.assertIn("校验失败", failed["error"])
                        self.assertEqual(repo.run(self.conn, failed["id"])["status"], "failed")
            provider.assert_not_called()
        self.assertEqual(self.count("reception.certificate_recognition_failed"), 1)

    def test_running_request_replays_without_ai_and_expired_lease_is_recovered_once(self):
        attachment = self.upload()
        at, request_id, run_id = datetime.now(UTC), uuid4().hex, uuid4().hex
        repo.insert_run(
            self.conn,
            {
                "id": run_id,
                "batch_id": self.batch["id"],
                "attachment_id": attachment["id"],
                "actor_id": ACTOR["id"],
                "request_id": request_id,
                "source_batch_version": self.batch["updatedAt"],
                "status": "running",
                "model": "test",
                "created_at": at.isoformat(),
                "updated_at": at.isoformat(),
            },
        )
        self.conn.commit()

        def extract(_image, attachment_id, identity, batch):
            result, raw = ai.normalize(self.extraction(), attachment_id, identity, batch)
            return result, raw, {}

        with patch.object(ai, "recognize", side_effect=extract) as provider:
            self.assertEqual(self.recognize(attachment["id"], request_id)["status"], "running")
            with self.assertRaises(files.CertificateUnavailableError):
                self.recognize(attachment["id"])
            provider.assert_not_called()
            self.assertEqual(repo.run(self.conn, run_id)["status"], "running")
            with patch.object(certificates, "datetime") as clock:
                clock.now.return_value = at + timedelta(
                    seconds=certificates.DEEPSEEK_TIMEOUT_SECONDS + pages.MAX_RENDER_SECONDS + 61
                )
                clock.fromisoformat.side_effect = datetime.fromisoformat
                completed = self.recognize(attachment["id"])
            self.assertEqual(completed["status"], "completed")
            self.assertEqual(self.recognize(attachment["id"], request_id)["status"], "failed")
            self.assertEqual(provider.call_count, 1)
        self.assertEqual(repo.run(self.conn, run_id)["status"], "failed")
        self.assertEqual(self.count("reception.certificate_recognition_interrupted"), 1)
        self.assertEqual(self.count("reception.certificate_recognition_started"), 1)
        self.assertEqual(self.count("reception.certificate_recognized"), 1)

    def test_expired_all_page_request_retains_its_original_scope_on_replay(self):
        attachment = self.upload()
        identity, run_id = uuid4().hex, uuid4().hex
        at = (
            datetime.now(UTC) - timedelta(seconds=certificates.DEEPSEEK_TIMEOUT_SECONDS + pages.MAX_RENDER_SECONDS + 61)
        ).isoformat()
        repo.insert_run(
            self.conn,
            {
                "id": run_id,
                "batch_id": self.batch["id"],
                "attachment_id": attachment["id"],
                "actor_id": ACTOR["id"],
                "request_id": identity,
                "source_batch_version": self.batch["updatedAt"],
                "status": "running",
                "model": "test",
                "created_at": at,
                "updated_at": at,
                "selection_mode": "all",
            },
        )
        self.conn.commit()
        result, raw = ai.normalize(self.extraction(), attachment["id"], "source-run", self.batch)
        with patch.object(ai, "recognize", return_value=(result, raw, {})) as provider:
            self.assertEqual(self.recognize(attachment["id"])["status"], "completed")
            expired = self.recognize(attachment["id"], identity, includeAllPages=True)
            self.assertEqual(expired["id"], run_id)
            self.assertEqual(expired["status"], "failed")
            with self.assertRaises(StaleWriteError):
                self.recognize(attachment["id"], identity)
            self.assertEqual(provider.call_count, 1)

    def test_recognition_request_binding_versions_and_attachment_ownership(self):
        first, second = self.upload(), self.upload(b"second")
        result, raw = ai.normalize(self.extraction(), first["id"], "source-run", self.batch)
        with patch.object(ai, "recognize", return_value=(result, raw, {})) as provider:
            for attachment, version, error in (
                ("missing", self.batch["updatedAt"], LookupError),
                (first["id"], "outdated", StaleWriteError),
            ):
                with self.subTest(attachment=attachment), self.assertRaises(error):
                    self.recognize(attachment, expectedBatchUpdatedAt=version)
            provider.assert_not_called()
            identity = uuid4().hex
            saved = self.recognize(first["id"], identity)
            self.assertEqual(self.recognize(first["id"], identity), saved)
            with self.assertRaises(StaleWriteError):
                self.recognize(second["id"], identity)
            self.put(updatedAt="2026-11-01T02:00:00")
            with self.assertRaises(StaleWriteError):
                self.recognize(first["id"], identity)
            self.assertEqual(provider.call_count, 1)
        self.assertEqual(self.count("reception.certificate_recognized"), 1)

    def test_registration_validation_ack_and_version_conflicts_write_nothing(self):
        attachment = self.upload()
        line = self.line(attachment["id"])
        invalid = [{"lines": []}, {"acknowledged": False}, {"acknowledged": 1}]
        invalid += [{"lines": [{**line, "quantity": value}]} for value in (None, 0, -1, 1.5, True, "2")]
        invalid += [
            {"lines": [{**line, field: ""}]} for field in ("certificateNo", "certificateStrain", "grade", "supplier")
        ]
        invalid += [
            {"lines": [{**line, "attachmentId": "wrong"}]},
            {"lines": [{**line, "receiptId": "wrong"}]},
            {"lines": [{**line, "certificateIndex": 0}]},
            {"lines": [{**line, "sex": "猜测"}]},
            {"lines": [{**line, "specification": "28"}]},
        ]
        for changes in invalid:
            with self.subTest(changes=changes), self.assertRaises(ValueError):
                self.save({**self.body([line]), **changes})
        for changes in (
            {"expectedBatchUpdatedAt": "old"},
            {"expectedRegistrationUpdatedAt": "old"},
            {"expectedApplicationVersion": "old"},
        ):
            with self.subTest(changes=changes), self.assertRaises(StaleWriteError):
                self.save(self.body([line], **changes))
        self.assertIsNone(repo.registration(self.conn, self.batch["id"]))
        self.assertEqual(self.count("reception.registration_confirmed"), 0)

    def test_registration_replay_is_exact_and_does_not_duplicate_audit_or_change_intake(self):
        attachment = self.upload()
        body = self.body([self.line(attachment["id"])])
        before = self.payload()
        first = self.save(body)
        self.assertEqual(self.save(body), first)
        self.assertEqual(first["lines"][0]["receiptId"], "receipt-1")
        self.assertEqual(first["lines"][0]["specification"], "18-22g / 6-8w")
        self.assertEqual(first["lines"][0]["grade"], "SPF")
        self.assertEqual(first["totalQuantity"], 3)
        self.assertEqual(self.count("reception.registration_confirmed"), 1)
        changed = copy.deepcopy(body)
        changed["lines"][0]["quantity"] = 4
        with self.assertRaises(StaleWriteError):
            self.save(changed)
        with self.assertRaises(StaleWriteError):
            self.save(self.body(body["lines"], expectedRegistrationUpdatedAt=None))
        self.assertEqual(self.payload(), before)

    def test_old_recognition_can_be_manually_confirmed_with_history_but_not_wrong_binding(self):
        attachment = self.upload()

        def extract(_image, attachment_id, run_id, batch):
            result, raw = ai.normalize(self.extraction(), attachment_id, run_id, batch)
            return result, raw, {}

        with patch.object(ai, "recognize", side_effect=extract):
            run = self.recognize(attachment["id"])
        old_version = self.batch["updatedAt"]
        self.put(updatedAt="2026-11-01T02:00:00")
        before = self.payload()
        line = {**run["result"]["lines"][0], "id": uuid4().hex}
        saved = self.save(self.body([line]))
        self.assertEqual(saved["sourceBatchUpdatedAt"], self.batch["updatedAt"])
        self.assertEqual(saved["lines"][0]["recognitionBatchUpdatedAt"], old_version)
        self.assertEqual(saved["lines"][0]["fieldOrigins"]["quantity"], "ai_verified")
        self.assertTrue(any("较早的批次" in message for message in saved["warnings"]))
        other = self.upload(b"another")
        for changes in ({"attachmentId": other["id"]}, {"runId": "missing"}, {"certificateLineIndex": 199}):
            with self.subTest(changes=changes), self.assertRaises(ValueError):
                self.save(self.body([{**line, **changes}]))
        self.assertEqual(repo.run(self.conn, run["id"])["source_batch_version"], old_version)
        self.assertEqual(json.loads(repo.run(self.conn, run["id"])["result_json"]), run["result"])
        self.assertEqual(self.payload(), before)

    def test_preview_excel_uses_confirmed_lines_and_preserves_legacy_request_compatibility(self):
        attachment = self.upload()
        saved = self.save(self.body([self.line(attachment["id"])]))
        before = self.payload()
        body = self.export_body()
        document = service.preview(self.conn, ACTOR, body)
        self.assertEqual(document["rowCount"], 1)
        self.assertEqual(document["rows"][0]["quantitySource"], "certificate_confirmed")
        self.assertEqual(document["rows"][0]["project"]["pi"], "申请PI")
        book = load_workbook(BytesIO(workbook.generate(document)))
        self.addCleanup(book.close)
        sheet = book["接收登记"]
        self.assertEqual(
            [sheet[f"{column}4"].value for column in ("K", "L", "N", "O", "P", "Q", "R")],
            [
                "证载C57",
                "SPF",
                "18-22g / 6-8w",
                "雄性",
                3,
                "广东维通利华实验动物技术有限公司",
                saved["lines"][0]["certificateNo"],
            ],
        )
        self.assertEqual(sheet["J4"].value, "C57BL/6J")
        self.assertEqual(sheet["H4"].value.date().isoformat(), "2026-10-31")
        body["expectedRegistrationVersions"] = {self.batch["id"]: saved["updatedAt"]}
        self.assertEqual(service.preview(self.conn, ACTOR, body)["rowCount"], 1)
        with patch.object(registrations, "now_iso", return_value="2026-11-01T03:00:00"):
            self.save(self.body([self.line(attachment["id"], quantity=4)]))
        with self.assertRaises(StaleWriteError):
            service.preview(self.conn, ACTOR, body)
        del body["expectedRegistrationVersions"]
        self.assertEqual(service.preview(self.conn, ACTOR, body)["rows"][0]["quantity"], 4)
        self.assertEqual(self.payload(), before)

    def test_restore_references_include_checked_pdf_and_preview_even_after_source_state_changes(self):
        from scripts.restore_drill.references import references

        attachment = self.upload()
        selected = [item for item in references(self.conn)["local"] if item["kind"].startswith("reception-")]
        self.assertEqual(len(selected), 2)
        original = next(item for item in selected if item["kind"] == "reception-certificate")
        preview = next(item for item in selected if item["kind"] == "reception-certificate-preview")
        self.assertEqual(original["sha256"], attachment["sha256"])
        self.assertEqual(preview["sha256"], hashlib.sha256(files.read(attachment["id"], preview=True)).hexdigest())
        self.assertTrue(original["endpoint"].endswith("/file"))
        self.put(status="printed")
        retained = [item for item in references(self.conn)["local"] if item["kind"].startswith("reception-")]
        self.assertEqual(len(retained), 2)
        self.assertTrue(all(item["endpoint"] is None for item in retained))
        self.assertTrue(
            all((files.RECEPTION_CERTIFICATE_FILES_PATH / Path(item["path"]).name).is_file() for item in retained)
        )

    def test_old_slash_draft_reads_do_not_change_evidence_registration_or_audit(self):
        attachment = self.upload()
        result, raw = ai.normalize(self.extraction(), attachment["id"], "run", self.batch)
        result["lines"] = result["lines"][:2]
        result["warnings"] = [
            "雌性数量原文为“/”，未假定为0，已留空并标记。",
            "第1张合格证有待核对字段：雌性数量（原文为“/”，未给出）",
            "第1张合格证存在未明确数量的明细，须补齐后才能确认保存",
        ]
        with patch.object(ai, "recognize", return_value=(result, raw, {})):
            run = self.recognize(attachment["id"])
        self.save(self.body([self.line(attachment["id"], quantity=9)]))

        def snapshot():
            return {
                table: [tuple(row) for row in self.conn.execute(f"SELECT * FROM {table} ORDER BY rowid")]
                for table in (
                    "intake_batches",
                    "reception_certificate_runs",
                    "reception_registrations",
                    "audit_events",
                )
            }

        before = snapshot()
        with patch.object(ai, "recognize", side_effect=AssertionError("reading must not call AI")):
            for _ in range(2):
                detail = certificates.detail(self.conn, ACTOR, self.batch["id"])
                self.assertEqual(detail["runs"][0]["result"], run["result"])
                self.assertEqual([line["quantity"] for line in run["result"]["lines"]], [3])
                self.assertEqual(run["result"]["warnings"], [])
                self.assertEqual(detail["registration"]["lines"][0]["quantity"], 9)
        self.assertEqual(snapshot(), before)
        archived = json.loads(self.conn.execute("SELECT result_json FROM reception_certificate_runs").fetchone()[0])
        self.assertIsNone(archived["lines"][1]["quantity"])
        self.assertEqual(archived["warnings"], result["warnings"])

    def test_list_uses_registration_summary_without_reading_detail_or_ai_blobs(self):
        before = service.list_records(self.conn, ACTOR, {})["items"][0]
        self.assertEqual((before["registrationStatus"], before["registeredQuantity"]), ("unconfirmed", None))
        attachment = self.upload()
        self.save(self.body([self.line(attachment["id"], quantity=11)]))
        queries = []
        self.conn.set_trace_callback(queries.append)
        with (
            patch.object(repo, "registrations", side_effect=AssertionError("full registration must not load")),
            patch.object(repo, "runs", side_effect=AssertionError("AI detail must not load")),
            patch.object(files, "read", side_effect=AssertionError("file must not load")),
        ):
            item = service.list_records(self.conn, ACTOR, {})["items"][0]
        self.conn.set_trace_callback(None)
        self.assertEqual(
            (item["registrationStatus"], item["registeredQuantity"], item["certificateCount"]), ("confirmed", 11, 1)
        )
        self.assertEqual((item["quantity"], item["sex"], item["specification"]), (6, "雌雄", "6-8周"))
        self.assertFalse(any("SELECT batch_id,payload FROM reception_registrations" in sql for sql in queries))
        self.assertTrue(all(key not in item for key in ("lines", "attachments", "runs")))
        self.put(updatedAt="2026-11-01T04:00:00")
        stale = service.list_records(self.conn, ACTOR, {})["items"][0]
        self.assertEqual((stale["registrationStatus"], stale["registeredQuantity"]), ("stale", 11))
        with self.assertRaises(StaleWriteError):
            service.preview(self.conn, ACTOR, self.export_body())
