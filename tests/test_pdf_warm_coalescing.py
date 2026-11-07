"""Queued warmups reuse one slot without replacing a user's export snapshot."""

import tempfile
import threading
import unittest
from pathlib import Path
from unittest.mock import patch

from server_app.pdf.cache import PDF_PRIORITY_WARM, PdfExportCache
from tests.test_pdf_export_cache import wait_for


class PdfWarmCoalescingTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.cache = PdfExportCache(Path(temporary.name), max_pending=3)
        self.user = {"id": "admin", "role": "admin"}
        self.started, self.release = threading.Event(), threading.Event()
        self.addCleanup(self.release.set)

        def blocker():
            self.started.set()
            self.release.wait(3)
            return b"%PDF blocker"

        self.blocker = self.enqueue("blocker", blocker)
        self.assertTrue(self.started.wait(1))

    def enqueue(self, key, render, warm=False, scope=None):
        return self.cache.enqueue_artifact(
            owner_id="system" if warm else "admin",
            key=key,
            filename=key + ".pdf",
            content_type="application/pdf",
            render=render,
            priority=PDF_PRIORITY_WARM if warm else 0,
            warm_scope=scope,
        )

    def finish(self, *jobs):
        self.release.set()
        for job in (self.blocker, *jobs):
            wait_for(self.cache, job.id, self.user)

    def test_many_quantity_versions_share_one_bounded_queue_slot_and_render_only_latest(self):
        calls = []
        job = self.enqueue("quantity:0", lambda: calls.append(0) or b"%PDF old", True, "quantity:sheet")
        original_id = job.id
        for number in range(1, 51):
            self.cache.invalidate([f"quantity:{number - 1}"])
            job = self.enqueue(
                f"quantity:{number}", lambda n=number: calls.append(n) or f"%PDF {n}".encode(), True, "quantity:sheet"
            )
            self.assertEqual(job.id, original_id)
        self.assertEqual(self.cache._tasks.qsize(), 1)
        self.assertEqual(len(self.cache._pending_artifacts.requests), 1)
        self.finish(job)
        self.assertEqual(job.status, "ready")
        self.assertEqual(calls, [50])
        self.assertEqual(self.cache.read_job(job), b"%PDF 50")
        self.assertFalse(self.cache._pending_artifacts.requests)
        self.assertFalse(self.cache._pending_artifacts.scopes)

    def test_same_pi_key_uses_new_invalidation_version(self):
        calls = []
        old = self.enqueue("pi:month", lambda: calls.append("old") or b"old", True, "pi:month")
        self.cache.invalidate(["pi:month"])
        latest = self.enqueue("pi:month", lambda: calls.append("latest") or b"latest", True, "pi:month")
        self.assertEqual(latest.id, old.id)
        self.finish(latest)
        self.assertEqual(calls, ["latest"])
        self.assertEqual(latest.status, "ready")

    def test_invalidated_queued_user_export_fails_before_render_but_fresh_request_succeeds(self):
        calls = []
        old = self.enqueue("user-key", lambda: calls.append("old") or b"old")
        self.cache.invalidate(["user-key"])
        fresh = self.enqueue("user-key", lambda: calls.append("fresh") or b"fresh")
        self.finish(old, fresh)
        self.assertEqual(old.status, "failed")
        self.assertIn("源数据已更新", old.error)
        self.assertEqual(fresh.status, "ready")
        self.assertEqual(calls, ["fresh"])

    def test_warmup_joined_by_user_is_never_rebound_to_a_different_version(self):
        self.cache.max_pending = 5
        calls = []
        old = self.enqueue("quantity:old", lambda: calls.append("old") or b"old", True, "sheet")
        joined = self.enqueue("quantity:old", lambda: b"unused")
        self.assertEqual(joined.id, old.id)
        latest = self.enqueue("quantity:new", lambda: calls.append("latest") or b"latest", True, "sheet")
        self.assertNotEqual(latest.id, old.id)
        self.finish(old, latest)
        self.assertEqual(self.cache.read_job(joined), b"old")
        self.assertEqual(self.cache.read_job(latest), b"latest")
        self.assertEqual(calls, ["old", "latest"])

    def test_invalidate_all_skips_waiting_work_without_publishing_a_file(self):
        calls = []
        old = self.enqueue("old", lambda: calls.append("old") or b"old", True, "sheet")
        self.cache.invalidate_all()
        self.finish(old)
        self.assertEqual(old.status, "failed")
        self.assertFalse(calls)
        self.assertFalse(self.cache.artifact_path("old").exists())

    def test_submit_failure_cleans_a_rebound_scope_and_allows_a_fresh_export(self):
        def fail_submission(_priority, _callback):
            self.enqueue("new-key", lambda: b"new", True, "submission")
            raise RuntimeError("cannot start")

        with patch.object(self.cache, "_submit", side_effect=fail_submission):
            with self.assertRaisesRegex(RuntimeError, "cannot start"):
                self.enqueue("old-key", lambda: b"old", True, "submission")
        self.assertNotIn("new-key", self.cache._active_keys)
        self.assertFalse(self.cache._pending_artifacts.requests)
        self.assertFalse(self.cache._pending_artifacts.scopes)
        fresh = self.enqueue("new-key", lambda: b"fresh", True, "submission")
        self.finish(fresh)
        self.assertEqual(fresh.status, "ready")
