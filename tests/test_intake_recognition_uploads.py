import base64
import hashlib
import sqlite3
import unittest
from io import BytesIO
from types import SimpleNamespace
from unittest.mock import Mock, patch

from PIL import Image

from server_app.domains.intake import recognition_uploads as uploads
from server_app.domains.intake.recognition_uploads import RecognitionBusy, RecognitionUploads, UploadExpired
from server_app.domains.state import intake_commands
from server_app.web import intake_ai
from tests import test_intake_recognition_images as image_fixtures
from tests.test_intake_recognition_images import ACTOR, batch, image_input, sample_result


def original(name="预约.png", color="red"):
    item = image_input(color, name)
    return name, base64.b64decode(item["dataUrl"].split(",", 1)[1])


def reference(item):
    return {"uploadId": item["uploadId"]}


class RecognitionUploadTests(unittest.TestCase):
    def setUp(self):
        self.now = 10
        self.store = RecognitionUploads(ttl=30, clock=lambda: self.now)
        self.addCleanup(self.store.close)

    def test_account_owned_originals_keep_order_and_reuse_validation_but_always_verify_bytes(self):
        a, b = original("../红色.png"), original("蓝色.png", "blue")
        receipts = self.store.add(ACTOR["id"], [a, b])
        refs = [reference(item) for item in receipts]
        with patch.object(uploads, "validate_image", side_effect=AssertionError("already validated")):
            decoded = self.store.resolve(ACTOR["id"], refs[::-1])
        self.assertEqual([(item.name, item.body) for item in decoded], [(b[0], b[1]), ("红色.png", a[1])])
        self.assertEqual(receipts[0]["sha256"], hashlib.sha256(a[1]).hexdigest())
        with self.assertRaisesRegex(ValueError, "当前账号"):
            self.store.resolve("another-account", refs)
        record = self.store.records[refs[0]["uploadId"]]
        record.path.write_bytes(b"X" + a[1][1:])
        with self.assertRaisesRegex(ValueError, "校验失败"):
            self.store.resolve(ACTOR["id"], refs)

    def test_expiration_prunes_files_and_invalid_refs_do_not_read_paths(self):
        receipt = self.store.add(ACTOR["id"], [original()])[0]
        path = self.store.records[receipt["uploadId"]].path
        self.now += 31
        with self.assertRaises(UploadExpired):
            self.store.resolve(ACTOR["id"], [reference(receipt)])
        self.assertFalse(path.exists())
        for ref in ({"uploadId": "../source"}, {"uploadId": receipt["uploadId"], "name": "override"}, None):
            with self.subTest(ref=ref), self.assertRaises(ValueError):
                self.store.resolve(ACTOR["id"], [ref])
        with self.assertRaises(UploadExpired):
            RecognitionUploads().resolve(ACTOR["id"], [reference(receipt)])

    def test_exclusive_create_failure_keeps_previous_owned_upload_unchanged(self):
        with patch.object(uploads, "uuid4", return_value=SimpleNamespace(hex="a" * 32)):
            first = self.store.add(ACTOR["id"], [original()])[0]
            path = self.store.records[first["uploadId"]].path
            with self.assertRaises(FileExistsError):
                self.store.add(ACTOR["id"], [original("other.png", "blue")])
        self.assertEqual(path.read_bytes(), original()[1])
        self.assertEqual(self.store.resolve(ACTOR["id"], [reference(first)])[0].body, original()[1])

    def test_capacity_is_bounded_and_invalid_batch_does_not_leave_partial_uploads(self):
        store = RecognitionUploads(max_files=1)
        self.addCleanup(store.close)
        first = store.add(ACTOR["id"], [original()])[0]
        with self.assertRaises(RecognitionBusy):
            store.add(ACTOR["id"], [original("new.png")])
        self.assertEqual(store.resolve(ACTOR["id"], [reference(first)])[0].body, original()[1])
        with self.assertRaises(ValueError):
            self.store.add(ACTOR["id"], [original(), ("broken.png", b"not an image")])
        self.assertEqual(self.store.records, {})
        store.mark_saved(ACTOR["id"], [reference(first)])
        replacement = store.add(ACTOR["id"], [original("next.png")])[0]
        self.assertNotEqual(first["uploadId"], replacement["uploadId"])
        with self.assertRaises(UploadExpired):
            store.resolve(ACTOR["id"], [reference(first)])

    def test_multipart_upload_authenticates_before_read_and_ai_receives_referenced_originals(self):
        handler = Mock(headers={"Content-Type": "multipart/form-data; boundary=synthetic"})
        handler.current_user.return_value = None
        self.assertEqual(intake_ai.intake_recognition_upload_handler(handler, {}).status, 401)
        handler.read_raw_body.assert_not_called()
        handler.current_user.return_value = ACTOR
        jpeg = BytesIO()
        Image.new("RGB", (12, 12), "red").save(jpeg, format="JPEG")
        files = [("one.png", jpeg.getvalue()), original("two.png", "blue")]
        handler.read_raw_body.return_value = (
            b"".join(
                b'--synthetic\r\nContent-Disposition: form-data; name="file"; filename="'
                + name.encode()
                + b'"\r\nContent-Type: image/png\r\n\r\n'
                + content
                + b"\r\n"
                for name, content in files
            )
            + b"--synthetic--\r\n"
        )
        with patch.object(intake_ai, "UPLOADS", self.store), patch.object(uploads, "UPLOADS", self.store):
            response = intake_ai.intake_recognition_upload_handler(handler, {})
            self.assertEqual(response.status, 201)
            receipts = response.payload["items"]
            self.assertEqual(
                [(item["name"], item["mime"], item["size"], item["sha256"]) for item in receipts],
                [
                    (name, mime, len(content), hashlib.sha256(content).hexdigest())
                    for (name, content), mime in zip(files, ["image/jpeg", "image/png"], strict=True)
                ],
            )
            refs = [reference(item) for item in receipts]
            handler.read_json_body.return_value = {"imageRefs": refs}
            with patch(
                "server_app.domains.intake.ai_parse.deepseek_chat_json", return_value=(sample_result(), {})
            ) as ai:
                parsed = intake_ai.intake_ai_parse_handler(handler, {})
            self.assertEqual(parsed.status, 200)
            image_urls = ai.call_args.kwargs["image_urls"]
            self.assertEqual(
                [url.split(",", 1)[0] for url in image_urls], ["data:image/jpeg;base64", "data:image/png;base64"]
            )
            self.assertEqual(
                [base64.b64decode(url.split(",", 1)[1]) for url in image_urls], [body for _, body in files]
            )
            self.assertEqual(
                [item["sha256"] for item in parsed.payload["recognition"]["inputImages"]],
                [item["sha256"] for item in receipts],
            )
            self.now += 31
            with patch("server_app.domains.intake.ai_parse.deepseek_chat_json") as ai:
                expired = intake_ai.intake_ai_parse_handler(handler, {})
            self.assertEqual((expired.status, expired.payload["code"]), (410, "INTAKE_UPLOAD_EXPIRED"))
            ai.assert_not_called()


class ReferencedImagePersistenceTests(unittest.TestCase):
    # Reuse only setup/helpers, without rediscovering the existing persistence cases.
    setUp = image_fixtures.ImagePersistenceTests.setUp
    connect = image_fixtures.ImagePersistenceTests.connect
    save = image_fixtures.ImagePersistenceTests.save
    stored_files = image_fixtures.ImagePersistenceTests.stored_files

    def test_reference_save_preserves_originals_without_base64_or_upload_ids_in_business_payload(self):
        store = RecognitionUploads()
        self.addCleanup(store.close)
        receipt = store.add(ACTOR["id"], [original()])[0]
        with patch.object(uploads, "UPLOADS", store):
            saved = self.save(batch(), recognitionImageRefs=[reference(receipt)])
        self.assertEqual(saved["recognition"]["images"][0]["sha256"], receipt["sha256"])
        self.assertEqual(self.stored_files()[0].read_bytes(), original()[1])
        self.assertNotIn("recognitionImageRefs", saved)
        self.assertNotIn("recognitionImages", saved)

    def test_file_fsync_occurs_before_sqlite_write_lock_and_later_failure_removes_owned_files(self):
        from server_app.domains.intake import recognition_images

        fsync = recognition_images.os.fsync
        probes = []

        def write_without_lock(fd):
            with sqlite3.connect(self.path, timeout=0) as competing:
                competing.execute("BEGIN IMMEDIATE")
                competing.rollback()
                probes.append(True)
            fsync(fd)

        with patch.object(recognition_images.os, "fsync", side_effect=write_without_lock):
            self.save(batch("outside-lock"), recognitionImages=[image_input()])
        self.assertEqual(probes, [True])
        before = set(self.stored_files())
        with patch.object(intake_commands, "begin_write", side_effect=RuntimeError("interrupted")):
            with self.assertRaisesRegex(RuntimeError, "interrupted"):
                self.save(batch("failed-attempt"), recognitionImages=[image_input("blue")])
        self.assertEqual(set(self.stored_files()), before)

    def test_expired_reference_fails_before_file_preparation_or_business_transaction(self):
        with (
            patch.object(uploads, "UPLOADS", RecognitionUploads()),
            patch.object(intake_commands, "begin_write") as begin,
        ):
            with self.assertRaises(UploadExpired):
                self.save(batch(), recognitionImageRefs=[{"uploadId": "a" * 32}])
        begin.assert_not_called()
        self.assertEqual(self.stored_files(), [])
