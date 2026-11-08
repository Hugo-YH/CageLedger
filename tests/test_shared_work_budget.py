import sqlite3
import subprocess
import threading
import types
import unittest
from concurrent.futures import ThreadPoolExecutor
from contextlib import contextmanager
from pathlib import Path
from unittest.mock import Mock, patch

from server_app import heavy_work
from server_app.domains.quarantine import pdf as quarantine_pdf
from server_app.domains.reception import certificate_files
from server_app.heavy_work import HeavyWorkBudget, HeavyWorkBusy
from server_app.pdf import renderer
from tests.test_pdf_renderer_lifecycle import FakePlaywright


class SharedWorkBudgetTests(unittest.TestCase):
    def test_nested_same_thread_reuses_one_slot_and_body_failure_releases_it(self):
        budget = HeavyWorkBudget(1)
        with self.assertRaisesRegex(ValueError, "synthetic failure"):
            with budget.slot():
                with budget.slot():
                    self.assertEqual(budget.snapshot()["active"], 1)
                with ThreadPoolExecutor(max_workers=1) as pool:
                    future = pool.submit(self.enter, budget)
                    with self.assertRaises(HeavyWorkBusy):
                        future.result(1)
                raise ValueError("synthetic failure")
        self.assertEqual(budget.snapshot(), {"capacity": 1, "active": 0, "waiting": 0, "rejected": 1})
        self.enter(budget)
        self.assertEqual(budget.snapshot()["active"], 0)

    @staticmethod
    def enter(budget):
        with budget.slot():
            return budget.snapshot()["active"]

    def test_metrics_failure_does_not_leak_an_acquired_slot(self):
        budget = HeavyWorkBudget(1)
        with patch.object(heavy_work, "record_stage", side_effect=RuntimeError("metrics failure")):
            with self.assertRaisesRegex(RuntimeError, "metrics failure"), budget.slot():
                self.fail("failed admission must not execute work")
        self.assertEqual(budget.snapshot()["active"], 0)
        self.assertEqual(budget.snapshot()["waiting"], 0)
        self.assertEqual(self.enter(budget), 1)

    def test_persistent_converter_blocks_other_converters_but_not_metadata_or_sql(self):
        budget = HeavyWorkBudget(1)
        started, release = threading.Event(), threading.Event()
        fake = FakePlaywright(started=started, release=release)
        persistent = renderer.PersistentChromiumRenderer()
        self.addCleanup(persistent.shutdown, 1)
        with (
            patch.dict("sys.modules", {"playwright.sync_api": types.SimpleNamespace(sync_playwright=lambda: fake)}),
            patch.object(renderer, "required_chromium_binary", return_value="synthetic-chromium"),
            patch.object(renderer, "DOCUMENT_WORK", budget),
            patch.object(quarantine_pdf, "DOCUMENT_WORK", budget),
            patch.object(certificate_files, "DOCUMENT_WORK", budget),
            patch.object(subprocess, "run") as run,
            ThreadPoolExecutor(max_workers=1) as pool,
        ):
            result = pool.submit(persistent.render, "synthetic markup")
            try:
                self.assertTrue(started.wait(1))
                self.assertEqual(budget.snapshot()["active"], 1)
                with self.assertRaises(certificate_files.CertificateUnavailableError):
                    certificate_files.prepare("valid.pdf", b"%PDF-synthetic")
                # Validation still has its original error even when converters are busy.
                with self.assertRaises(ValueError):
                    certificate_files.prepare("invalid.png", b"invalid")
                with self.assertRaises(certificate_files.CertificateUnavailableError), certificate_files.rendering():
                    self.fail("busy Poppler work must not start")
                with patch.object(quarantine_pdf, "TIMEOUT_SECONDS", 0):
                    with self.assertRaises(quarantine_pdf.PdfRenderError):
                        quarantine_pdf._convert_docx(b"synthetic", "synthetic-writer")
                with patch.object(renderer, "RENDER_TIMEOUT_SECONDS", 0):
                    with self.assertRaises(HeavyWorkBusy):
                        renderer.command_line_render("synthetic markup")
                run.assert_not_called()
                self.assertTrue(persistent.snapshot()["active"])
                with sqlite3.connect(":memory:") as conn:
                    self.assertEqual(conn.execute("SELECT 1").fetchone()[0], 1)
            finally:
                release.set()
            self.assertEqual(result.result(2), b"%PDF:synthetic markup")
            self.assertTrue(persistent.shutdown(1))
        self.assertEqual(budget.snapshot()["active"], 0)

    def test_renderer_submit_does_not_acquire_the_executors_budget(self):
        budget = HeavyWorkBudget(1)
        waiting = threading.Event()
        fake = FakePlaywright()
        persistent = renderer.PersistentChromiumRenderer()
        self.addCleanup(persistent.shutdown, 1)

        @contextmanager
        def tracked_slot(*, timeout=0):
            waiting.set()
            with budget.slot(timeout=timeout):
                yield

        with (
            patch.dict("sys.modules", {"playwright.sync_api": types.SimpleNamespace(sync_playwright=lambda: fake)}),
            patch.object(renderer, "required_chromium_binary", return_value="synthetic-chromium"),
            patch.object(renderer, "DOCUMENT_WORK", types.SimpleNamespace(slot=tracked_slot)),
        ):
            job = renderer.RenderJob(markup="queued", completed=threading.Event())
            try:
                with budget.slot():
                    persistent._enqueue(job, 0)
                    self.assertTrue(waiting.wait(1))
                    self.assertFalse(job.completed.is_set())
                    self.assertTrue(persistent.snapshot()["active"])
                self.assertTrue(job.completed.wait(2))
                self.assertEqual(job.result, b"%PDF:queued")
            finally:
                persistent.shutdown(1)
        self.assertEqual(budget.snapshot()["active"], 0)

    def test_command_line_and_node_fallback_share_one_slot_and_release_on_failure(self):
        budget = HeavyWorkBudget(1)
        observed = []

        def run(command, **_kwargs):
            observed.append((command[0], budget.snapshot()["active"]))
            if command[0] == "node":
                Path(command[-1]).write_bytes(b"%PDF-node-fallback")
            return subprocess.CompletedProcess(command, 1 if command[0] != "node" else 0)

        with (
            patch.object(renderer, "DOCUMENT_WORK", budget),
            patch.object(renderer, "required_chromium_binary", return_value="synthetic-chromium"),
            patch.object(renderer.shutil, "which", return_value="synthetic-node"),
            patch.object(renderer.subprocess, "run", side_effect=run),
        ):
            self.assertEqual(renderer.command_line_render("markup"), b"%PDF-node-fallback")
        self.assertEqual(observed, [("synthetic-chromium", 1), ("node", 1)])
        self.assertEqual(budget.snapshot()["active"], 0)
        with (
            patch.object(renderer, "DOCUMENT_WORK", budget),
            patch.object(renderer, "required_chromium_binary", return_value="synthetic-chromium"),
            patch.object(renderer.subprocess, "run", side_effect=subprocess.TimeoutExpired("chromium", 120)),
        ):
            with self.assertRaisesRegex(RuntimeError, "启动失败"):
                renderer.command_line_render("markup")
        self.assertEqual(self.enter(budget), 1)

    def test_quarantine_combines_queue_waits_but_preserves_full_conversion_timeout(self):
        clock = [0.0]

        @contextmanager
        def wait_for_budget(**_kwargs):
            clock[0] = 40.0
            yield

        budget = Mock(slot=Mock(side_effect=wait_for_budget))
        local = Mock(acquire=Mock(return_value=True))

        def run(command, **kwargs):
            self.assertEqual(kwargs["timeout"], 120)
            (Path(kwargs["cwd"]) / "report.pdf").write_bytes(b"%PDF-1.7\nsynthetic\n%%EOF")
            return subprocess.CompletedProcess(command, 0)

        with (
            patch.object(quarantine_pdf, "DOCUMENT_WORK", budget),
            patch.object(quarantine_pdf, "_RENDER_SLOT", local),
            patch.object(quarantine_pdf.time, "monotonic", side_effect=lambda: clock[0]),
            patch.object(quarantine_pdf.subprocess, "run", side_effect=run),
        ):
            self.assertTrue(quarantine_pdf._convert_docx(b"source", "writer").startswith(b"%PDF-"))
        budget.slot.assert_called_once_with(timeout=120)
        local.acquire.assert_called_once_with(timeout=80)
        local.release.assert_called_once_with()
