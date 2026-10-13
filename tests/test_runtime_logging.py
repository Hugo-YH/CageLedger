import io
import json
import logging
import os
import sqlite3
import subprocess
import sys
import tempfile
import threading
import unittest
from http.client import HTTPConnection
from http.server import ThreadingHTTPServer
from pathlib import Path
from unittest.mock import patch

from server_app import config, runtime_logging
from server_app.db import ObservedConnection
from server_app.performance import performance_snapshot, reset_performance_metrics
from server_app.runtime_logging import configure_runtime_logging, emit_event, log_context, shutdown_runtime_logging
from server_app.shared.sqlite import ClosingConnection
from server_app.web.handler import CageLedgerHttpHandler


class RuntimeLoggingTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.root = Path(self.directory.name)
        self.console = io.StringIO()
        self.settings = patch.multiple(
            config,
            LOG_DIR=self.root / "logs",
            LOG_PERSISTENCE_ENABLED=True,
            LOG_MAX_BYTES=100_000,
            LOG_FILE_COUNT=3,
        )
        self.settings.start()
        self.addCleanup(self.settings.stop)
        self.stdout = patch.object(sys, "stdout", self.console)
        self.stdout.start()
        self.addCleanup(self.stdout.stop)
        configure_runtime_logging()
        self.addCleanup(shutdown_runtime_logging)
        self.addCleanup(reset_performance_metrics)

    def records(self):
        return [json.loads(line) for line in (config.LOG_DIR / "runtime.jsonl").read_text().splitlines()]

    def test_log_survives_separate_process_recreation_and_keeps_versions(self):
        env = {**os.environ, "CAGELEDGER_DATA_ROOT": str(self.root), "CAGELEDGER_LOG_DIR": str(self.root / "shared")}
        code = (
            "from server_app.runtime_logging import configure_runtime_logging,emit_event;"
            "configure_runtime_logging();emit_event('process_probe')"
        )
        for version in ("test-before", "test-after"):
            subprocess.run(
                [sys.executable, "-c", code],
                env={**env, "CAGELEDGER_APP_VERSION": version},
                cwd=config.ROOT,
                check=True,
                capture_output=True,
                timeout=10,
            )
        records = [json.loads(line) for line in (self.root / "shared" / "runtime.jsonl").read_text().splitlines()]
        probes = [record for record in records if record["event"] == "process_probe"]
        self.assertEqual([record["appVersion"] for record in probes], ["test-before", "test-after"])
        self.assertNotEqual(probes[0]["processId"], probes[1]["processId"])

    def test_rotation_limits_file_count_and_keeps_valid_json(self):
        with patch.object(config, "LOG_MAX_BYTES", 1200):
            configure_runtime_logging()
            for count in range(40):
                emit_event("rotation_probe", count=count)
        paths = list(config.LOG_DIR.glob("runtime.jsonl*"))
        self.assertEqual(len(paths), 3)
        for path in paths:
            self.assertLessEqual(path.stat().st_size, 1200)
            for line in path.read_text().splitlines():
                self.assertEqual(json.loads(line)["event"], "rotation_probe")
        self.assertEqual(self.records()[-1]["count"], 39)

    def test_error_omits_exception_message_sql_values_and_local_variables(self):
        secret = "password-token-private-query"
        try:
            raise ValueError(secret)
        except ValueError as error:
            emit_event("redaction_probe", level=logging.ERROR, error=error, sql=secret, token=secret, payload=secret)
        text = (config.LOG_DIR / "runtime.jsonl").read_text()
        self.assertNotIn(secret, text)
        record = self.records()[-1]
        self.assertEqual(record["errorType"], "ValueError")
        self.assertTrue(any(frame["function"].startswith("test_error_") for frame in record["frames"]))
        self.assertTrue(all(set(frame) == {"file", "function", "line"} for frame in record["frames"]))

    def test_request_context_does_not_leak_to_next_request_or_other_thread(self):
        with log_context(requestId="first", component="http"):
            emit_event("first_request")
            thread = threading.Thread(target=lambda: emit_event("background_probe"), name="background-test")
            thread.start()
            thread.join(timeout=5)
            self.assertFalse(thread.is_alive())
        emit_event("next_request")
        records = {record["event"]: record for record in self.records()}
        self.assertEqual(records["first_request"]["requestId"], "first")
        self.assertNotIn("requestId", records["background_probe"])
        self.assertNotIn("requestId", records["next_request"])

    def test_real_sqlite_lock_is_logged_without_changing_exception_or_metrics(self):
        path = self.root / "isolated.sqlite"
        with sqlite3.connect(path, factory=ClosingConnection) as setup:
            setup.execute("PRAGMA journal_mode=WAL")
            setup.execute("CREATE TABLE probe(value TEXT)")
        writer = sqlite3.connect(path)
        contender = sqlite3.connect(path, factory=ObservedConnection)
        self.addCleanup(writer.close)
        self.addCleanup(contender.close)
        contender.execute("PRAGMA busy_timeout=0")
        writer.execute("BEGIN IMMEDIATE")
        reset_performance_metrics()
        with log_context(requestId="lock-request", method="POST", route="/api/probe"):
            with self.assertRaises(sqlite3.OperationalError):
                contender.execute("INSERT INTO probe VALUES(?)", ("private-bind-value",))
        record = self.records()[-1]
        self.assertEqual(record["event"], "database_lock_error")
        self.assertEqual(record["requestId"], "lock-request")
        self.assertEqual(record["sqliteCode"], sqlite3.SQLITE_BUSY)
        self.assertEqual(record["sqlOperation"], "INSERT")
        self.assertTrue(record["frames"])
        self.assertEqual(performance_snapshot()["database"]["lockErrors"], 1)
        self.assertNotIn("private-bind-value", (config.LOG_DIR / "runtime.jsonl").read_text())
        writer.rollback()
        contender.execute("INSERT INTO probe VALUES(?)", ("successful-retry",))
        contender.commit()

    def test_repeated_background_errors_are_limited_and_summarized(self):
        with patch.object(runtime_logging.time, "monotonic", side_effect=[0, 1, 2, 61]):
            for _ in range(4):
                emit_event("background_failed", error=ValueError("private"), stage="import", rate_limit=True)
        records = [record for record in self.records() if record["event"] == "background_failed"]
        self.assertEqual(len(records), 2)
        self.assertEqual(records[-1]["suppressedCount"], 2)

    def test_unwritable_directory_keeps_console_logging_and_startup(self):
        invalid = self.root / "not-a-directory"
        invalid.write_text("occupied")
        with patch.object(config, "LOG_DIR", invalid):
            configure_runtime_logging()
            emit_event("still_running")
        records = [json.loads(line) for line in self.console.getvalue().splitlines()]
        self.assertIn("runtime_log_unavailable", [record["event"] for record in records])
        self.assertFalse(
            [record for record in records if record["event"] == "runtime_logging_started"][-1]["persistent"]
        )
        self.assertEqual(records[-1]["event"], "still_running")

    def test_file_write_failure_falls_back_once_without_interrupting_business(self):
        handler = next(h for h in runtime_logging._HANDLERS if isinstance(h, runtime_logging.SafeRotatingFileHandler))
        with patch.object(handler, "shouldRollover", side_effect=OSError("private filesystem error")):
            emit_event("write_failure_probe")
            emit_event("business_continues")
        self.assertTrue(handler.failed)
        records = [json.loads(line) for line in self.console.getvalue().splitlines()]
        self.assertEqual(sum(record["event"] == "runtime_log_unavailable" for record in records), 1)
        self.assertEqual(sum(record["event"] == "write_failure_probe" for record in records), 1)
        self.assertEqual(records[-1]["event"], "business_continues")
        self.assertNotIn("private filesystem error", self.console.getvalue())

    def test_persistence_can_be_disabled_without_creating_directory(self):
        path = self.root / "disabled"
        with patch.multiple(config, LOG_DIR=path, LOG_PERSISTENCE_ENABLED=False):
            configure_runtime_logging()
            emit_event("console_only")
        self.assertFalse(path.exists())
        self.assertIn('"event":"console_only"', self.console.getvalue())

    def test_persistent_logs_have_one_normal_sink_without_console_duplication(self):
        self.console.seek(0)
        self.console.truncate()
        emit_event("single_sink_probe")
        self.assertEqual(self.records()[-1]["event"], "single_sink_probe")
        self.assertEqual(self.console.getvalue(), "")

    def test_http_failure_and_response_share_request_id_and_omit_url_values(self):
        class ProbeHandler(CageLedgerHttpHandler):
            def do_GET(self):
                raise ValueError("private-exception-body")

        server = ThreadingHTTPServer(("127.0.0.1", 0), ProbeHandler)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            connection = HTTPConnection("127.0.0.1", server.server_port, timeout=5)
            connection.request("GET", "/api/probe/private-record?token=private-query")
            response = connection.getresponse()
            self.assertEqual(response.status, 500)
            request_id = response.getheader("X-Request-ID")
            self.assertEqual(json.loads(response.read())["requestId"], request_id)
            connection.close()
        finally:
            server.shutdown()
            server.server_close()
            thread.join(timeout=5)
        records = [record for record in self.records() if record.get("requestId") == request_id]
        self.assertEqual({record["event"] for record in records}, {"request_failed", "http_request"})
        self.assertTrue(all(record["route"] == "/api/probe" for record in records))
        self.assertEqual([record for record in records if record["event"] == "http_request"][0]["level"], "ERROR")
        text = (config.LOG_DIR / "runtime.jsonl").read_text()
        for value in ("private-record", "private-query", "private-exception-body"):
            self.assertNotIn(value, text)

    def test_background_callback_keeps_request_context_and_error_without_argument_values(self):
        with log_context(requestId="pdf-request", component="http"):
            callback = runtime_logging.bind_log_context(lambda: emit_event("pdf_background_probe"))
        thread = threading.Thread(target=callback, name="pdf-background-test")
        thread.start()
        thread.join(timeout=5)
        record = self.records()[-1]
        self.assertEqual(record["requestId"], "pdf-request")
        self.assertEqual(record["thread"], "pdf-background-test")

    def test_operation_records_wrapped_error_cause_and_preserves_result(self):
        @runtime_logging.log_operation("operation_probe", component="exports")
        def probe(fail=False):
            if fail:
                try:
                    raise OSError("private-child-error")
                except OSError as cause:
                    raise ValueError("private-wrapper-error") from cause
            return "original-result"

        self.assertEqual(probe(), "original-result")
        with self.assertRaisesRegex(ValueError, "private-wrapper-error"):
            probe(True)
        record = self.records()[-1]
        self.assertEqual(record["event"], "operation_probe_failed")
        self.assertEqual(record["causes"], [{"errorType": "OSError"}])
        self.assertNotIn("private-", (config.LOG_DIR / "runtime.jsonl").read_text())

    def test_uncaught_thread_exception_is_persisted_without_raw_exception_text(self):
        def crash():
            raise RuntimeError("private-thread-error")

        thread = threading.Thread(target=crash, name="unexpected-worker")
        thread.start()
        thread.join(timeout=5)
        record = self.records()[-1]
        self.assertEqual(record["event"], "thread_failed")
        self.assertEqual(record["thread"], "unexpected-worker")
        self.assertNotIn("private-thread-error", (config.LOG_DIR / "runtime.jsonl").read_text())

    def test_ai_timeout_keeps_http_cause_and_omits_credentials_and_prompts(self):
        from server_app.services import ai

        with (
            patch.object(ai, "DEEPSEEK_API_KEY", "private-api-key"),
            patch.object(ai, "_ssl_context", return_value=None),
            patch.object(ai, "urlopen", side_effect=TimeoutError("private-upstream-detail")),
        ):
            with self.assertRaisesRegex(ValueError, "超时"):
                ai.deepseek_chat_json("private-system-prompt", "private-user-prompt")
        record = self.records()[-1]
        self.assertEqual(record["event"], "ai_request_failed")
        self.assertEqual(record["causes"], [{"errorType": "TimeoutError"}])
        self.assertNotIn("private-", (config.LOG_DIR / "runtime.jsonl").read_text())

    def test_word_export_failure_is_logged_without_document_content(self):
        from server_app.domains.quarantine import pdf

        with patch.object(pdf, "libreoffice_binary", side_effect=pdf.PdfRenderError("private-renderer-detail")):
            with self.assertRaises(pdf.PdfRenderError):
                pdf.convert_docx(b"private-document")
        record = self.records()[-1]
        self.assertEqual(record["event"], "word_pdf_conversion_failed")
        self.assertNotIn("private-", (config.LOG_DIR / "runtime.jsonl").read_text())

    def test_pdf_export_worker_error_retains_original_request_id(self):
        from server_app.pdf.cache import PdfExportCache

        cache = PdfExportCache(self.root / "pdf-cache")

        def fail():
            raise OSError("private-export-error")

        with log_context(requestId="original-export-request", component="http"):
            job = cache.enqueue_artifact(
                owner_id="test-owner",
                key="test-cache-key",
                filename="test.pdf",
                content_type="application/pdf",
                render=fail,
            )
        cache._tasks.join()
        record = self.records()[-1]
        self.assertEqual(record["event"], "pdf_export_failed")
        self.assertEqual(record["requestId"], "original-export-request")
        self.assertEqual(record["jobId"], job.id)
        self.assertNotIn("private-export-error", (config.LOG_DIR / "runtime.jsonl").read_text())

    def test_non_lock_sqlite_failure_keeps_code_and_omits_raw_sql(self):
        with sqlite3.connect(":memory:", factory=ObservedConnection) as conn:
            with self.assertRaises(sqlite3.OperationalError):
                conn.execute("SELECT private_column FROM private_missing_table")
        record = self.records()[-1]
        self.assertEqual(record["event"], "database_operation_failed")
        self.assertEqual(record["sqliteName"], "SQLITE_ERROR")
        self.assertEqual(record["sqlOperation"], "SELECT")
        self.assertNotIn("private_column", (config.LOG_DIR / "runtime.jsonl").read_text())


if __name__ == "__main__":
    unittest.main()
