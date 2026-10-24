import threading
import time
import types
import unittest
from concurrent.futures import ThreadPoolExecutor
from unittest.mock import patch

from server_app.pdf.renderer import PersistentChromiumRenderer, PlaywrightUnavailable


class FakePlaywright:
    def __init__(self, *, fail=None, started=None, release=None, on_pdf=None):
        self.fail = fail
        self.started = started
        self.release = release
        self.on_pdf = on_pdf
        self.ready = threading.Event()
        self.close_threads = []
        self.exits = 0
        self.launches = 0
        self.markup = ""

    def enter(self):
        if self.fail == "context":
            self.fail = None
            raise RuntimeError("context initialization failed")
        return types.SimpleNamespace(chromium=types.SimpleNamespace(launch=self.launch))

    def __enter__(self):
        return self.enter()

    def __exit__(self, *_args):
        self.exits += 1

    def launch(self, **_kwargs):
        self.launches += 1
        self.maybe_fail("launch")
        return types.SimpleNamespace(new_page=self.new_page, close=self.close)

    def new_page(self):
        self.maybe_fail("page")
        return types.SimpleNamespace(
            emulate_media=self.media, set_content=self.content, evaluate=lambda *_: None, pdf=self.pdf
        )

    def media(self, **_kwargs):
        self.maybe_fail("media")
        self.ready.set()

    def content(self, markup, **_kwargs):
        self.markup = markup

    def pdf(self, **_kwargs):
        if self.started:
            self.started.set()
        if self.release:
            if not self.release.wait(3):
                raise RuntimeError("test did not release active PDF")
        if self.on_pdf:
            self.on_pdf()
        return b"%PDF:" + self.markup.encode()

    def close(self):
        self.close_threads.append(threading.current_thread().name)
        self.maybe_fail("close")

    def maybe_fail(self, stage):
        if self.fail == stage:
            self.fail = None
            raise RuntimeError(f"{stage} initialization failed")


class PdfRendererLifecycleTests(unittest.TestCase):
    def fake(self, fake):
        self.addCleanup(patch.stopall)
        patch.dict("sys.modules", {"playwright.sync_api": types.SimpleNamespace(sync_playwright=lambda: fake)}).start()
        patch("server_app.pdf.renderer.required_chromium_binary", return_value="generated-fake-browser").start()
        renderer = PersistentChromiumRenderer()
        self.addCleanup(renderer.shutdown)
        return renderer

    def test_idle_prewarm_closes_once_on_the_owner_thread(self):
        fake = FakePlaywright()
        renderer = self.fake(fake)
        renderer.prewarm()
        self.assertTrue(fake.ready.wait(1))
        self.assertTrue(renderer.shutdown(1))
        self.assertTrue(renderer.shutdown(1))
        self.assertEqual(fake.close_threads, ["cageledger-pdf"])
        self.assertEqual(fake.exits, 1)
        self.assertEqual(renderer.snapshot()["queueDepth"], 0)
        with self.assertRaisesRegex(RuntimeError, "停止"):
            renderer.render("must not reopen")

    def test_active_work_finishes_queued_work_is_released_and_concurrent_close_is_idempotent(self):
        for _ in range(5):
            started, release = threading.Event(), threading.Event()
            fake = FakePlaywright(started=started, release=release)
            renderer = self.fake(fake)
            with ThreadPoolExecutor(max_workers=4) as pool:
                active = pool.submit(renderer.render, "active")
                self.assertTrue(started.wait(1))
                queued = pool.submit(renderer.render, "pending")
                deadline = time.monotonic() + 1
                while renderer.snapshot()["queueDepth"] != 1 and time.monotonic() < deadline:
                    time.sleep(0.001)
                self.assertEqual(renderer.snapshot()["queueDepth"], 1)
                close1 = pool.submit(renderer.shutdown, 2)
                close2 = pool.submit(renderer.shutdown, 2)
                self.assertFalse(renderer.shutdown(0.01))
                with self.assertRaisesRegex(RuntimeError, "停止"):
                    renderer.prewarm()
                release.set()
                self.assertEqual(active.result(1), b"%PDF:active")
                with self.assertRaisesRegex(RuntimeError, "停止"):
                    queued.result(1)
                self.assertTrue(close1.result(1))
                self.assertTrue(close2.result(1))
            self.assertEqual(fake.close_threads, ["cageledger-pdf"])
            self.assertEqual(fake.exits, 1)
            self.assertEqual(renderer.snapshot()["queueDepth"], 0)

    def test_context_initialization_failure_releases_waiter_and_next_request_can_recover(self):
        fake = FakePlaywright(fail="context")
        renderer = self.fake(fake)
        with self.assertRaisesRegex(RuntimeError, "context initialization"):
            renderer.render("first")
        self.assertEqual(renderer.render("recovered"), b"%PDF:recovered")
        self.assertTrue(renderer.shutdown(1))
        self.assertEqual(fake.exits, 1)

    def test_partial_browser_initialization_failure_and_recovery_close_owned_resources(self):
        for stage in ["launch", "page", "media"]:
            with self.subTest(stage=stage):
                fake = FakePlaywright(fail=stage)
                renderer = self.fake(fake)
                with self.assertRaisesRegex(RuntimeError, f"{stage} initialization"):
                    renderer.render("first")
                self.assertEqual(renderer.render("next"), b"%PDF:next")
                self.assertTrue(renderer.shutdown(1))
                self.assertEqual(len(fake.close_threads), 1 if stage == "launch" else 2)
                self.assertEqual(set(fake.close_threads), {"cageledger-pdf"})
                self.assertEqual(fake.exits, 1)

    def test_close_failure_still_stops_driver_and_releases_all_waiters(self):
        fake = FakePlaywright(fail="close")
        renderer = self.fake(fake)
        self.assertEqual(renderer.render("done"), b"%PDF:done")
        self.assertTrue(renderer.shutdown(1))
        self.assertEqual(fake.exits, 1)
        self.assertEqual(renderer.snapshot()["queueDepth"], 0)

    def test_shutdown_before_first_use_does_not_start_a_browser(self):
        fake = FakePlaywright()
        renderer = self.fake(fake)
        self.assertTrue(renderer.shutdown(1))
        self.assertEqual(renderer.snapshot()["queueDepth"], 0)
        with self.assertRaisesRegex(RuntimeError, "停止"):
            renderer.render("late")
        self.assertEqual(fake.launches, 0)

    def test_owner_thread_shutdown_does_not_join_itself(self):
        result = []
        fake = FakePlaywright(on_pdf=lambda: result.append(renderer.shutdown()))
        renderer = self.fake(fake)
        self.assertEqual(renderer.render("self-close"), b"%PDF:self-close")
        self.assertTrue(renderer.shutdown(1))
        self.assertEqual(result, [False])
        self.assertEqual(fake.close_threads, ["cageledger-pdf"])

    def test_missing_playwright_fails_promptly_instead_of_stranding_admitted_job(self):
        renderer = PersistentChromiumRenderer()
        self.addCleanup(renderer.shutdown)
        with patch.dict("sys.modules", {"playwright.sync_api": None}):
            with self.assertRaises(PlaywrightUnavailable):
                renderer.render("unavailable")
        self.assertEqual(renderer.snapshot()["queueDepth"], 0)

    def test_shutdown_waits_for_in_progress_browser_initialization_on_its_owner(self):
        started, release = threading.Event(), threading.Event()

        class DelayedLaunch(FakePlaywright):
            def launch(self, **kwargs):
                started.set()
                if not release.wait(3):
                    raise RuntimeError("test did not release browser initialization")
                return super().launch(**kwargs)

        fake = DelayedLaunch()
        renderer = self.fake(fake)
        renderer.prewarm()
        self.assertTrue(started.wait(1))
        self.assertFalse(renderer.shutdown(0.01))
        release.set()
        self.assertTrue(renderer.shutdown(1))
        self.assertEqual(fake.close_threads, ["cageledger-pdf"])
        self.assertEqual(fake.exits, 1)

    def test_worker_thread_start_failure_does_not_leave_an_admitted_job_queued(self):
        renderer = PersistentChromiumRenderer()
        with patch("server_app.pdf.renderer.Thread") as thread:
            thread.return_value.start.side_effect = RuntimeError("thread cannot start")
            thread.return_value.is_alive.return_value = False
            with self.assertRaisesRegex(RuntimeError, "thread cannot start"):
                renderer.render("never started")
        self.assertEqual(renderer.snapshot()["queueDepth"], 0)
        self.assertTrue(renderer.shutdown(1))

    def test_interrupt_before_worker_start_does_not_make_shutdown_join_an_unstarted_thread(self):
        renderer = PersistentChromiumRenderer()
        with patch("server_app.pdf.renderer.Thread") as thread:
            thread.return_value.start.side_effect = KeyboardInterrupt
            thread.return_value.is_alive.return_value = False
            with self.assertRaises(KeyboardInterrupt):
                renderer.render("interrupted startup")
        self.assertEqual(renderer.snapshot()["queueDepth"], 0)
        self.assertTrue(renderer.shutdown(1))
