import sqlite3
import tempfile
import threading
import unittest
from pathlib import Path
from unittest.mock import patch

from server_app.domains.reimbursement_ledger import claim_attachments as attachments
from server_app.domains.reimbursement_ledger import service
from server_app.domains.reimbursement_ledger.attachment_paths import attachment_path, claim_directory
from server_app.legacy import initialize_schema

ACTOR = {"id": "admin", "username": "admin", "displayName": "Admin", "role": "admin"}


class ControlledConnection(sqlite3.Connection):
    commit_mode = None
    fail_rollback = False
    fail_lookup = False

    def commit(self):
        if self.commit_mode == "before":
            raise sqlite3.OperationalError("commit failure")
        super().commit()
        if self.commit_mode == "after":
            raise sqlite3.OperationalError("commit outcome unknown")

    def rollback(self):
        if self.fail_rollback:
            raise sqlite3.OperationalError("rollback failure")
        super().rollback()

    def execute(self, sql, parameters=()):
        if self.fail_lookup and sql.startswith("SELECT 1 FROM reimbursement_claim_attachments"):
            raise sqlite3.OperationalError("lookup failure")
        return super().execute(sql, parameters)


class AttachmentSafetyTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.patch = patch.object(attachments, "REIMBURSEMENT_ATTACHMENTS_PATH", self.root / "files")
        self.patch.start()
        self.database = self.root / "test.sqlite"
        self.conn = self.connect()
        initialize_schema(self.conn)
        self.conn.execute(
            "INSERT INTO reimbursement_claims(id,document_number,created_by,created_by_name,created_at,updated_at,payload) VALUES ('c','doc','admin','Admin','t','t','{}')"
        )
        self.conn.commit()
        (self.root / "files" / "c").mkdir(parents=True)
        self.original = self.root / "files" / "c" / "existing.pdf"
        self.original.write_bytes(b"existing")

    def tearDown(self):
        self.conn.close()
        self.patch.stop()
        self.temp.cleanup()

    def connect(self):
        conn = sqlite3.connect(self.database, timeout=5, factory=ControlledConnection)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA foreign_keys=ON")
        return conn

    def upload(self, conn=None, body=b"%PDF-content"):
        return attachments.add_attachment(conn or self.conn, ACTOR, "c", "file.pdf", body, "application/pdf")

    def assert_no_new_files(self):
        self.assertEqual([self.original], list((self.root / "files" / "c").iterdir()))
        self.assertEqual(self.original.read_bytes(), b"existing")
        self.assertEqual(self.conn.execute("SELECT COUNT(*) FROM reimbursement_claim_attachments").fetchone()[0], 0)

    def test_partial_write_failure_cleans_new_file(self):
        original_open = Path.open

        class PartialWrite:
            def __init__(self, stream):
                self.stream = stream

            def __enter__(self):
                return self

            def __exit__(self, *args):
                self.stream.close()

            def write(self, body):
                self.stream.write(body[:4])
                raise OSError("simulated write failure")

        def failing_open(path, mode="r", *args, **kwargs):
            stream = original_open(path, mode, *args, **kwargs)
            return PartialWrite(stream) if mode == "xb" else stream

        with patch.object(Path, "open", failing_open), self.assertRaises(OSError):
            self.upload()
        self.assert_no_new_files()

    def test_existing_filename_is_never_overwritten_or_deleted(self):
        with patch.object(attachments, "new_id", return_value="existing"), self.assertRaises(FileExistsError):
            self.upload()
        self.assert_no_new_files()
        self.conn.rollback()

    def test_sql_and_audit_failures_roll_back_and_clean(self):
        self.conn.execute(
            "CREATE TRIGGER fail_attachment BEFORE INSERT ON reimbursement_claim_attachments BEGIN SELECT RAISE(ABORT, 'fail'); END"
        )
        self.conn.commit()
        with self.assertRaises(sqlite3.IntegrityError):
            self.upload()
        self.assert_no_new_files()
        self.conn.execute("DROP TRIGGER fail_attachment")
        self.conn.commit()
        with patch.object(attachments, "write_audit_events", side_effect=RuntimeError("audit")):
            with self.assertRaises(RuntimeError):
                self.upload()
        self.assert_no_new_files()

    def test_commit_failures_and_uncertain_cleanup(self):
        self.conn.commit_mode = "before"
        with self.assertRaises(sqlite3.OperationalError):
            self.upload()
        self.assert_no_new_files()
        self.conn.commit_mode = "after"
        with self.assertRaises(sqlite3.OperationalError):
            self.upload()
        row = self.conn.execute("SELECT stored_name FROM reimbursement_claim_attachments").fetchone()
        self.assertEqual((self.original.parent / row[0]).read_bytes(), b"%PDF-content")

    def test_rollback_or_lookup_failure_retains_new_file(self):
        for failure in ("rollback", "lookup"):
            with self.subTest(failure=failure):
                conn = self.connect()
                conn.commit_mode = "before"
                conn.fail_rollback = failure == "rollback"
                conn.fail_lookup = failure == "lookup"
                before = set(self.original.parent.iterdir())
                with self.assertRaises(sqlite3.OperationalError):
                    self.upload(conn, body=f"%PDF-{failure}".encode())
                self.assertEqual(len(set(self.original.parent.iterdir()) - before), 1)
                conn.fail_rollback = False
                conn.rollback()
                conn.close()

    def test_success_duplicate_and_concurrent_limit(self):
        first = self.upload(body=b"%PDF-0")
        self.assertEqual((self.original.parent / first["item"]["storedName"]).read_bytes(), b"%PDF-0")
        with self.assertRaisesRegex(ValueError, "相同附件"):
            self.upload(body=b"%PDF-0")
        self.conn.rollback()
        for index in range(1, 9):
            self.upload(body=f"%PDF-{index}".encode())
        barrier = threading.Barrier(2)
        outcomes = []

        def worker(index):
            conn = self.connect()
            try:
                barrier.wait()
                self.upload(conn, f"%PDF-concurrent-{index}".encode())
                outcomes.append("ok")
            except ValueError:
                outcomes.append("limit")
                conn.rollback()
            finally:
                conn.close()

        threads = [threading.Thread(target=worker, args=(i,)) for i in range(2)]
        for thread in threads:
            thread.start()
        for thread in threads:
            thread.join(10)
            self.assertFalse(thread.is_alive())
        self.assertCountEqual(outcomes, ["ok", "limit"])
        self.assertEqual(self.conn.execute("SELECT COUNT(*) FROM reimbursement_claim_attachments").fetchone()[0], 10)
        self.assertEqual(self.original.read_bytes(), b"existing")

    def test_legacy_parent_id_cannot_upload_download_or_delete_outside_root(self):
        self.conn.execute(
            "INSERT INTO reimbursement_claims(id,document_number,created_by,created_by_name,created_at,updated_at,payload) VALUES ('..','legacy','admin','Admin','t','t','{}')"
        )
        self.conn.execute(
            """INSERT INTO reimbursement_claim_attachments
               (id,claim_id,original_name,stored_name,mime_type,size_bytes,sha256,created_by,created_at,payload)
               VALUES ('legacy-att','..','sentinel.pdf','sentinel.pdf','application/pdf',4,'hash','admin','t','{}')"""
        )
        self.conn.commit()
        sentinel = self.root / "sentinel.pdf"
        sentinel.write_bytes(b"safe")
        with self.assertRaisesRegex(LookupError, "附件路径无效"):
            attachments.add_attachment(self.conn, ACTOR, "..", "test.pdf", b"%PDF-test", "application/pdf")
        self.conn.rollback()
        with self.assertRaisesRegex(LookupError, "附件路径无效"):
            attachments.get_attachment(self.conn, ACTOR, "legacy-att")
        with patch.object(service, "REIMBURSEMENT_ATTACHMENTS_PATH", self.root / "files"):
            with self.assertRaisesRegex(LookupError, "附件路径无效"):
                service.delete_claim(self.conn, ACTOR, "..")
        self.assertEqual(sentinel.read_bytes(), b"safe")
        self.assertEqual(self.conn.execute("SELECT COUNT(*) FROM reimbursement_claims WHERE id='..'").fetchone()[0], 1)
        self.assertEqual(
            self.conn.execute("SELECT COUNT(*) FROM reimbursement_claim_attachments WHERE id='legacy-att'").fetchone()[
                0
            ],
            1,
        )

    def test_symlink_and_unsafe_stored_name_are_rejected(self):
        item = self.upload()["item"]
        target = self.original.parent / item["storedName"]
        outside = self.root / "outside.pdf"
        outside.write_bytes(b"outside")
        target.unlink()
        target.symlink_to(outside)
        with self.assertRaisesRegex(LookupError, "附件路径无效"):
            attachments.get_attachment(self.conn, ACTOR, item["id"])
        target.unlink()
        self.conn.execute(
            "UPDATE reimbursement_claim_attachments SET stored_name='../outside.pdf' WHERE id=?", (item["id"],)
        )
        self.conn.commit()
        with self.assertRaisesRegex(LookupError, "附件路径无效"):
            attachments.get_attachment(self.conn, ACTOR, item["id"])
        self.assertEqual(outside.read_bytes(), b"outside")

    def test_symlink_claim_directory_cannot_be_uploaded_or_deleted(self):
        external = self.root / "external"
        external.mkdir()
        sentinel = external / "sentinel"
        sentinel.write_bytes(b"safe")
        self.original.unlink()
        self.original.parent.rmdir()
        self.original.parent.symlink_to(external, target_is_directory=True)
        with self.assertRaisesRegex(LookupError, "附件路径无效"):
            self.upload()
        self.conn.rollback()
        with patch.object(service, "REIMBURSEMENT_ATTACHMENTS_PATH", self.root / "files"):
            with self.assertRaisesRegex(LookupError, "附件路径无效"):
                service.delete_claim(self.conn, ACTOR, "c")
        self.assertEqual(sentinel.read_bytes(), b"safe")
        self.assertEqual(self.conn.execute("SELECT COUNT(*) FROM reimbursement_claims WHERE id='c'").fetchone()[0], 1)

    def test_normal_claim_can_be_deleted(self):
        self.upload()
        before = self.conn.execute("SELECT COUNT(*) FROM audit_events").fetchone()[0]
        with patch.object(service, "REIMBURSEMENT_ATTACHMENTS_PATH", self.root / "files"):
            result = service.delete_claim(self.conn, ACTOR, "c")
        self.assertFalse(self.original.parent.exists())
        self.assertEqual(self.conn.execute("SELECT COUNT(*) FROM reimbursement_claims WHERE id='c'").fetchone()[0], 0)
        self.assertEqual(self.conn.execute("SELECT COUNT(*) FROM audit_events").fetchone()[0], before + 1)
        self.assertEqual(result["auditLogs"][0]["action"], "reimbursement_ledger.claim_deleted")

    def test_delete_audit_or_commit_failure_preserves_files_and_metadata(self):
        item = self.upload()["item"]
        target = self.original.parent / item["storedName"]
        audit_count = self.conn.execute("SELECT COUNT(*) FROM audit_events").fetchone()[0]
        with patch.object(service, "REIMBURSEMENT_ATTACHMENTS_PATH", self.root / "files"):
            with patch.object(service, "write_audit_events", side_effect=RuntimeError("audit")):
                with self.assertRaises(RuntimeError):
                    service.delete_claim(self.conn, ACTOR, "c")
            self.conn.rollback()
            self.assertEqual(target.read_bytes(), b"%PDF-content")
            self.assertEqual(
                self.conn.execute("SELECT COUNT(*) FROM reimbursement_claims WHERE id='c'").fetchone()[0], 1
            )
            self.assertEqual(self.conn.execute("SELECT COUNT(*) FROM reimbursement_claim_attachments").fetchone()[0], 1)
            self.conn.commit_mode = "before"
            with self.assertRaises(sqlite3.OperationalError):
                service.delete_claim(self.conn, ACTOR, "c")
            self.conn.rollback()
            self.assertEqual(target.read_bytes(), b"%PDF-content")
            self.assertEqual(
                self.conn.execute("SELECT COUNT(*) FROM reimbursement_claims WHERE id='c'").fetchone()[0], 1
            )
            self.assertEqual(self.conn.execute("SELECT COUNT(*) FROM reimbursement_claim_attachments").fetchone()[0], 1)
            self.assertEqual(self.conn.execute("SELECT COUNT(*) FROM audit_events").fetchone()[0], audit_count)

    def test_delete_commit_outcome_unknown_preserves_files(self):
        item = self.upload()["item"]
        target = self.original.parent / item["storedName"]
        self.conn.commit_mode = "after"
        with patch.object(service, "REIMBURSEMENT_ATTACHMENTS_PATH", self.root / "files"):
            with self.assertRaises(sqlite3.OperationalError):
                service.delete_claim(self.conn, ACTOR, "c")
        self.assertEqual(target.read_bytes(), b"%PDF-content")
        self.assertEqual(self.conn.execute("SELECT COUNT(*) FROM reimbursement_claims WHERE id='c'").fetchone()[0], 0)

    def test_cleanup_failure_after_commit_is_success_and_logs_without_path(self):
        self.upload()
        with (
            patch.object(service, "REIMBURSEMENT_ATTACHMENTS_PATH", self.root / "files"),
            patch.object(service.shutil, "rmtree", side_effect=OSError("private-path")),
            patch.object(service, "emit_event") as log,
        ):
            result = service.delete_claim(self.conn, ACTOR, "c")
        self.assertTrue(result["ok"])
        self.assertEqual(self.conn.execute("SELECT COUNT(*) FROM reimbursement_claims WHERE id='c'").fetchone()[0], 0)
        self.assertNotIn("private-path", str(log.call_args))
        self.assertEqual(self.original.read_bytes(), b"existing")

    def test_delete_holds_writer_lock_during_allocation_check(self):
        entered = threading.Event()
        release = threading.Event()
        results = []

        def check(*_):
            entered.set()
            self.assertTrue(release.wait(5))
            return False

        def delete():
            conn = self.connect()
            try:
                results.append(service.delete_claim(conn, ACTOR, "c"))
            finally:
                conn.close()

        with (
            patch.object(service, "REIMBURSEMENT_ATTACHMENTS_PATH", self.root / "files"),
            patch.object(service, "_claim_has_confirmed_allocations", check),
        ):
            thread = threading.Thread(target=delete)
            thread.start()
            try:
                self.assertTrue(entered.wait(5))
                other = sqlite3.connect(self.database, timeout=0.1)
                try:
                    with self.assertRaisesRegex(sqlite3.OperationalError, "locked"):
                        other.execute("BEGIN IMMEDIATE")
                finally:
                    other.close()
            finally:
                release.set()
                thread.join(5)
            self.assertFalse(thread.is_alive())
            self.assertTrue(results[0]["ok"])

    def test_rejects_path_components_without_disclosing_root(self):
        root = self.root / "files"
        with self.assertRaises(LookupError):
            claim_directory(root, "workflows")
        for component in ("..", ".", "../outside", "/absolute", "a/b", "a\\b", "\x00"):
            for call in (
                lambda value=component: claim_directory(root, value),
                lambda value=component: attachment_path(root, "c", value),
            ):
                with self.subTest(component=component), self.assertRaises(LookupError) as error:
                    call()
                self.assertNotIn(str(self.root), str(error.exception))


if __name__ == "__main__":
    unittest.main()
