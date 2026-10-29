import sqlite3
import tempfile
import unittest
from contextlib import contextmanager
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from server_app.cache import (
    cache_generation,
    cache_get,
    cache_set,
    invalidate_data_cache,
)
from server_app.domains.iacuc import auto_import
from server_app.web import handler_support, reimbursement_actions, technical_services, workflow_actions


class Handler(
    handler_support.HandlerSupportMixin,
    reimbursement_actions.ReimbursementActionsMixin,
    workflow_actions.WorkflowActionsMixin,
):
    headers = {"Content-Type": "multipart/form-data"}

    def require_user(self):
        return {"id": "admin", "username": "admin", "displayName": "Admin", "role": "admin"}

    def read_json_body(self):
        return {}

    def read_optional_json_body(self):
        return {}

    def read_raw_body(self):
        return b"upload"

    def send_json(self, payload, status=200):
        self.response = payload, int(status)


class PostCommitCacheInvalidationTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.db = Path(self.directory.name) / "test.sqlite"
        self.reader = sqlite3.connect(self.db)
        self.reader.execute("PRAGMA journal_mode=WAL")
        self.reader.execute("CREATE TABLE sample (amount INTEGER NOT NULL)")
        self.reader.execute("INSERT INTO sample VALUES (1)")
        self.reader.commit()
        self.handler = Handler()
        self.keys = []

    def tearDown(self):
        invalidate_data_cache(*self.keys)
        self.reader.close()
        self.directory.cleanup()

    @contextmanager
    def connect(self):
        conn = sqlite3.connect(self.db)
        try:
            yield conn
        finally:
            conn.close()

    def update_and_fill_old(self, conn, keys):
        conn.execute("UPDATE sample SET amount=2")
        invalidate_data_cache(*keys)
        generation = cache_generation()
        old = self.reader.execute("SELECT amount FROM sample").fetchone()[0]
        self.assertEqual(old, 1)
        for key in keys:
            cache_set(key, {"amount": old}, expected_generation=generation)
            self.assertEqual(cache_get(key), {"amount": 1})

    def assert_after_commit(self, keys):
        updated = self.reader.execute("SELECT amount FROM sample").fetchone()[0]
        self.assertEqual(updated, 2)
        for key in keys:
            self.assertIsNone(cache_get(key), key)
            cache_set(key, {"amount": updated}, expected_generation=cache_generation())
            self.assertEqual(cache_get(key), {"amount": 2})
        self.assertIn("auditLogs", self.handler.response[0])

    def test_imports_clear_repopulated_data_after_commit(self):
        for method, function in (
            ("handle_reimbursement_monthly_import", "import_monthly_reimbursement_workbook"),
            ("handle_reimbursement_arrears_import", "import_arrears_reimbursement_workbook"),
        ):
            with self.subTest(method=method):
                self.reader.execute("UPDATE sample SET amount=1")
                self.reader.commit()
                keys = ["reimbursement_records::test", "billing_workflows::test"]
                self.keys.extend(keys)

                def perform(conn, *_, target_keys=keys):
                    self.update_and_fill_old(conn, target_keys)
                    return {"auditLogs": ["audit"], "amount": 2}

                with (
                    patch.object(reimbursement_actions, "connect_db", self.connect),
                    patch.object(reimbursement_actions, "parse_multipart_upload", return_value=("file.xlsx", b"x")),
                    patch.object(reimbursement_actions, function, perform),
                ):
                    getattr(self.handler, method)()
                self.assert_after_commit(keys)
                self.assertEqual(self.handler.response[0]["amount"], 2)

    def test_principal_and_quantity_writes_clear_repopulated_data(self):
        keys = [
            "principal_identities",
            "principal_types_by_pi",
            "quantity_sheets::test",
            "billing_workflows::test",
            "dashboard_overview::test",
        ]
        for method in ("handle_principal_identity_save", "handle_quantity_sheet_save", "handle_quantity_sheet_delete"):
            with self.subTest(method=method):
                self.reader.execute("UPDATE sample SET amount=1")
                self.reader.commit()
                self.keys.extend(keys)

                def principal(conn, *_):
                    self.update_and_fill_old(conn, keys)
                    return {"amount": 2}, ["audit"]

                def save(conn, *_):
                    self.update_and_fill_old(conn, keys)
                    return {"id": "s", "month": "m", "pi": "p"}, None, [], ["audit"], 200, {}

                def delete(conn, *_):
                    self.update_and_fill_old(conn, keys)
                    return {"id": "s", "month": "m", "pi": "p"}, ["audit"]

                ports = SimpleNamespace(
                    save_quantity_sheet=save, delete_quantity_sheet=delete, generate_billing_statement_by_pi=None
                )
                with (
                    patch.object(handler_support, "connect_db", self.connect),
                    patch.object(handler_support, "app_ports", return_value=ports),
                    patch.object(handler_support, "save_principal_identity", principal),
                    patch.object(handler_support, "invalidate_quantity_sheet_candidate_snapshots"),
                    patch.object(handler_support, "invalidate_quantity_sheet_candidate_snapshots_by_pi"),
                    patch.object(handler_support, "invalidate_all_pdf_cache"),
                    patch.object(handler_support, "invalidate_pdf_cache_for_sheets"),
                    patch.object(handler_support, "schedule_pdf_cache_refresh"),
                ):
                    getattr(self.handler, method)("p" if "principal" in method else "s")
                expected = keys if "principal" in method else [key for key in keys if key != "principal_types_by_pi"]
                self.assert_after_commit(expected)

    def test_failed_commit_keeps_old_data_and_never_sends_success(self):
        keys = ["reimbursement_records::test", "billing_workflows::test"]
        self.keys.extend(keys)

        class FailedCommit(sqlite3.Connection):
            def commit(self):
                raise sqlite3.OperationalError("commit failed")

        @contextmanager
        def failing_connect():
            conn = sqlite3.connect(self.db, factory=FailedCommit)
            try:
                yield conn
            finally:
                conn.close()

        def perform(conn, *_):
            self.update_and_fill_old(conn, keys)
            return {"auditLogs": ["audit"], "amount": 2}

        with (
            patch.object(reimbursement_actions, "connect_db", failing_connect),
            patch.object(reimbursement_actions, "parse_multipart_upload", return_value=("file.xlsx", b"x")),
            patch.object(reimbursement_actions, "import_monthly_reimbursement_workbook", perform),
            self.assertRaises(sqlite3.OperationalError),
        ):
            self.handler.handle_reimbursement_monthly_import()
        self.assertFalse(hasattr(self.handler, "response"))
        self.assertEqual(self.reader.execute("SELECT amount FROM sample").fetchone()[0], 1)
        for key in keys:
            self.assertEqual(cache_get(key), {"amount": 1})

    def test_technical_settlement_clears_old_values_only_after_successful_commit(self):
        keys = [
            "billing_workflows::test",
            "billing_statements::test",
            "reimbursement_records::test",
            "quantity_sheets::settlement_candidates::test",
        ]
        self.keys.extend(keys)
        self.handler.path = "/api/technical-services/settlements"

        @contextmanager
        def transactional_connect():
            conn = sqlite3.connect(self.db)
            try:
                with conn:
                    yield conn
            finally:
                conn.close()

        def initiate(conn, *_):
            self.update_and_fill_old(conn, keys)
            return {"statement": {"totalAmount": 2}, "auditLogs": ["audit"]}

        with (
            patch.object(technical_services, "connect_db", transactional_connect),
            patch.object(technical_services.service, "authorize"),
            patch.object(technical_services.settlement, "initiate", initiate),
        ):
            self.assertTrue(technical_services.handle(self.handler, "POST", self.handler.path))
        self.assert_after_commit(keys)
        self.assertEqual(self.handler.response[0]["statement"]["totalAmount"], 2)

    def test_technical_settlement_commit_failure_does_not_refresh_or_succeed(self):
        keys = ["billing_workflows::test", "billing_statements::test", "reimbursement_records::test"]
        self.keys.extend(keys)
        self.handler.path = "/api/technical-services/settlements"

        @contextmanager
        def failing_connect():
            conn = sqlite3.connect(self.db)
            try:
                yield conn
                raise sqlite3.OperationalError("commit failed")
            finally:
                conn.close()

        def initiate(conn, *_):
            self.update_and_fill_old(conn, keys)
            return {"statement": {"totalAmount": 2}}

        with (
            patch.object(technical_services, "connect_db", failing_connect),
            patch.object(technical_services.service, "authorize"),
            patch.object(technical_services.settlement, "initiate", initiate),
            patch.object(technical_services, "invalidate_data_cache_prefixes") as invalidate,
            self.assertRaises(sqlite3.OperationalError),
        ):
            technical_services.handle(self.handler, "POST", self.handler.path)
        invalidate.assert_not_called()
        self.assertFalse(hasattr(self.handler, "response"))
        self.assertEqual(self.reader.execute("SELECT amount FROM sample").fetchone()[0], 1)
        for key in keys:
            self.assertEqual(cache_get(key), {"amount": 1})

    def test_technical_get_does_not_invalidate(self):
        self.handler.path = "/api/technical-services/catalog"
        with (
            patch.object(technical_services, "connect_db", self.connect),
            patch.object(technical_services.service, "authorize"),
            patch.object(technical_services.repo, "catalog", return_value=[]),
            patch.object(technical_services, "invalidate_data_cache_prefixes") as invalidate,
        ):
            technical_services.handle(self.handler, "GET", self.handler.path)
        invalidate.assert_not_called()

    def test_statement_generators_invalidate_after_commit_and_not_on_failure(self):
        keys = ["billing_workflows::test", "billing_statements::test", "reimbursement_records::test"]
        self.keys.extend(keys)
        for method in (
            "handle_billing_statement_generate",
            "handle_billing_statement_generate_by_pi",
            "handle_quantity_sheet_statement_generate",
        ):
            for fail in (False, True):
                with self.subTest(method=method, fail=fail):
                    self.reader.execute("UPDATE sample SET amount=1")
                    self.reader.commit()
                    self.handler = Handler()

                    def generate(conn, *_):
                        self.update_and_fill_old(conn, keys)
                        return {"totalAmount": 2}, [], ["audit"]

                    ports = SimpleNamespace(
                        generate_billing_statement=generate,
                        generate_billing_statement_by_pi=generate,
                        generate_quantity_sheet_statement=generate,
                    )
                    module = (
                        handler_support if method == "handle_quantity_sheet_statement_generate" else workflow_actions
                    )
                    with (
                        patch.object(module, "connect_db", self.controlled_connect(fail)),
                        patch.object(module, "app_ports", return_value=ports),
                    ):
                        if fail:
                            with self.assertRaises(sqlite3.OperationalError):
                                getattr(self.handler, method)(*(["s"] if module is handler_support else []))
                        else:
                            getattr(self.handler, method)(*(["s"] if module is handler_support else []))
                    self.assert_commit_outcome(keys, fail)

    def controlled_connect(self, fail):
        @contextmanager
        def connect():
            class Controlled(sqlite3.Connection):
                def commit(self):
                    if fail:
                        raise sqlite3.OperationalError("commit failed")
                    super().commit()

            conn = sqlite3.connect(self.db, factory=Controlled)
            try:
                yield conn
                conn.commit()
            finally:
                conn.close()

        return connect

    def assert_commit_outcome(self, keys, fail):
        amount = self.reader.execute("SELECT amount FROM sample").fetchone()[0]
        self.assertEqual(amount, 1 if fail else 2)
        self.assertEqual(hasattr(self.handler, "response"), not fail)
        for key in keys:
            self.assertEqual(cache_get(key), {"amount": 1} if fail else None)
            if not fail:
                cache_set(key, {"amount": amount}, expected_generation=cache_generation())
                self.assertEqual(cache_get(key), {"amount": 2})

    def test_iacuc_upload_invalidation_after_commit_and_not_on_failure(self):
        keys = ["applications_by_iacuc", "dashboard_overview::test"]
        self.keys.extend(keys)
        for fail in (False, True):
            with self.subTest(fail=fail):
                self.reader.execute("UPDATE sample SET amount=1")
                self.reader.commit()
                self.handler = Handler()

                def write(conn, *_):
                    self.update_and_fill_old(conn, keys)

                ports = SimpleNamespace(save_iacuc_index_file=lambda *_: None)
                with (
                    patch.object(workflow_actions, "connect_db", self.controlled_connect(fail)),
                    patch.object(workflow_actions, "app_ports", return_value=ports),
                    patch.object(workflow_actions, "parse_multipart_upload", return_value=("data.csv", b"x")),
                    patch.object(workflow_actions, "parse_iacuc_csv", return_value={"items": [], "summary": {}}),
                    patch.object(workflow_actions, "read_current_applications", return_value=[]),
                    patch.object(workflow_actions, "write_experiment_applications", write),
                    patch.object(workflow_actions, "sync_project_derived_fields_after_iacuc_upload", return_value={}),
                    patch.object(workflow_actions, "invalidate_all_quantity_sheet_candidate_snapshots"),
                    patch.object(workflow_actions, "write_audit_events"),
                    patch.object(workflow_actions, "publish_committed_iacuc_index"),
                    patch.object(workflow_actions, "invalidate_all_pdf_cache"),
                ):
                    if fail:
                        with self.assertRaises(sqlite3.OperationalError):
                            self.handler.handle_iacuc_upload()
                    else:
                        self.handler.handle_iacuc_upload()
                self.assert_commit_outcome(keys, fail)

    def test_iacuc_auto_import_invalidation_after_commit_and_not_on_failure(self):
        keys = ["applications_by_iacuc", "dashboard_overview::test"]
        self.keys.extend(keys)
        path = Path(self.directory.name) / "input.csv"
        path.write_text("fixture")
        stat = path.stat()
        identity = (stat.st_mtime_ns, stat.st_size, stat.st_ino, stat.st_dev)
        for fail in (False, True):
            with self.subTest(fail=fail):
                self.reader.execute("UPDATE sample SET amount=1")
                self.reader.commit()

                def perform(_path, *, conn, now):
                    self.update_and_fill_old(conn, keys)
                    return {"count": 1}

                with (
                    patch.object(auto_import, "connect_db", self.controlled_connect(fail)),
                    patch.object(auto_import, "_summary_candidates", return_value=[(path, identity)]),
                    patch.object(auto_import, "import_summary_file", perform),
                    patch.object(auto_import, "_archive_imported"),
                ):
                    if fail:
                        with self.assertRaises(sqlite3.OperationalError):
                            auto_import.scan_and_import_once(now="t")
                    else:
                        result = auto_import.scan_and_import_once(now="t")
                        self.assertEqual(result["count"], 1)
                self.assertEqual(self.reader.execute("SELECT amount FROM sample").fetchone()[0], 1 if fail else 2)
                for key in keys:
                    self.assertEqual(cache_get(key), {"amount": 1} if fail else None)


if __name__ == "__main__":
    unittest.main()
