import os
import tempfile
import threading
import time
import unittest
from pathlib import Path

from server_app.pdf.cache import PDF_PRIORITY_WARM, PdfExportCache


class PdfExportCacheTests(unittest.TestCase):
    def test_reuses_artifact_until_the_source_is_invalidated(self):
        with tempfile.TemporaryDirectory() as directory:
            cache = PdfExportCache(Path(directory))
            calls = []

            def render():
                calls.append("render")
                return b"%PDF cached"

            user = {"id": "user-1", "role": "admin"}
            first = cache.enqueue_artifact(
                owner_id=user["id"],
                key="quantity-sheet:sheet-1",
                filename="sheet.pdf",
                content_type="application/pdf",
                render=render,
            )
            finished = wait_for(cache, first.id, user)
            self.assertEqual(finished.status, "ready")
            self.assertEqual(cache.read_job(finished), b"%PDF cached")

            second = cache.enqueue_artifact(
                owner_id=user["id"],
                key="quantity-sheet:sheet-1",
                filename="sheet.pdf",
                content_type="application/pdf",
                render=render,
            )
            self.assertEqual(second.status, "ready")
            self.assertEqual(calls, ["render"])

            cache.invalidate(["quantity-sheet:sheet-1"])
            third = cache.enqueue_artifact(
                owner_id=user["id"],
                key="quantity-sheet:sheet-1",
                filename="sheet.pdf",
                content_type="application/pdf",
                render=render,
            )
            self.assertEqual(wait_for(cache, third.id, user).status, "ready")
            self.assertEqual(calls, ["render", "render"])

    def test_batch_reports_progress_and_keeps_user_access_scope(self):
        with tempfile.TemporaryDirectory() as directory:
            cache = PdfExportCache(Path(directory))
            job = cache.enqueue_batch(
                owner_id="user-1",
                filename="batch.zip",
                total=2,
                render=lambda progress: build_batch(progress),
            )
            finished = wait_for(cache, job.id, {"id": "user-1", "role": "manager"})
            self.assertEqual(finished.completed, 2)
            self.assertEqual(cache.read_job(finished), b"batch")
            with self.assertRaises(PermissionError):
                cache.get_job(job.id, {"id": "user-2", "role": "manager"})

    def test_user_job_runs_before_queued_background_warmup(self):
        with tempfile.TemporaryDirectory() as directory:
            cache = PdfExportCache(Path(directory))
            release_first = threading.Event()
            started_first = threading.Event()
            order = []

            def first_warmup():
                order.append("warm-1")
                started_first.set()
                release_first.wait(2)
                return b"%PDF warm-1"

            warm_one = cache.enqueue_artifact(
                owner_id="system",
                key="warm-1",
                filename="warm-1.pdf",
                content_type="application/pdf",
                render=first_warmup,
                priority=PDF_PRIORITY_WARM,
            )
            self.assertTrue(started_first.wait(1))
            warm_two = cache.enqueue_artifact(
                owner_id="system",
                key="warm-2",
                filename="warm-2.pdf",
                content_type="application/pdf",
                render=lambda: order.append("warm-2") or b"%PDF warm-2",
                priority=PDF_PRIORITY_WARM,
            )
            user_job = cache.enqueue_artifact(
                owner_id="user-1",
                key="user-1",
                filename="user.pdf",
                content_type="application/pdf",
                render=lambda: order.append("user") or b"%PDF user",
            )
            release_first.set()
            user = {"id": "user-1", "role": "admin"}
            self.assertEqual(wait_for(cache, user_job.id, user).status, "ready")
            self.assertEqual(wait_for(cache, warm_one.id, user).status, "ready")
            self.assertEqual(wait_for(cache, warm_two.id, user).status, "ready")
            self.assertEqual(order, ["warm-1", "user", "warm-2"])

    def test_invalidated_old_job_does_not_clear_new_singleflight_owner(self):
        with tempfile.TemporaryDirectory() as directory:
            cache = PdfExportCache(Path(directory))
            old_started = threading.Event()
            release_old = threading.Event()
            release_new = threading.Event()
            calls = []

            def old_render():
                calls.append("old")
                old_started.set()
                release_old.wait(2)
                return b"%PDF old"

            old_job = cache.enqueue_artifact(
                owner_id="user-1",
                key="shared",
                filename="shared.pdf",
                content_type="application/pdf",
                render=old_render,
            )
            self.assertTrue(old_started.wait(1))
            cache.invalidate(["shared"])
            new_job = cache.enqueue_artifact(
                owner_id="user-1",
                key="shared",
                filename="shared.pdf",
                content_type="application/pdf",
                render=lambda: wait_for_release(release_new, b"%PDF new"),
            )
            release_old.set()
            wait_for(cache, old_job.id, {"id": "user-1", "role": "admin"})
            duplicate = cache.enqueue_artifact(
                owner_id="user-2",
                key="shared",
                filename="shared.pdf",
                content_type="application/pdf",
                render=lambda: calls.append("duplicate") or b"%PDF duplicate",
            )
            self.assertEqual(duplicate.id, new_job.id)
            release_new.set()
            self.assertEqual(
                wait_for(cache, new_job.id, {"id": "user-1", "role": "admin"}).status,
                "ready",
            )

    def test_prunes_expired_and_over_capacity_artifacts(self):
        with tempfile.TemporaryDirectory() as directory:
            cache = PdfExportCache(Path(directory), max_bytes=12, artifact_ttl_seconds=1)
            artifacts = Path(directory) / "artifacts"
            artifacts.mkdir(parents=True)
            expired = artifacts / "expired.pdf"
            expired.write_bytes(b"12345678")
            old = time.time() - 5
            expired.touch()
            os.utime(expired, (old, old))
            (artifacts / "recent-a.pdf").write_bytes(b"abcdefgh")
            time.sleep(0.01)
            (artifacts / "recent-b.pdf").write_bytes(b"ijklmnop")

            snapshot = cache.snapshot()
            self.assertFalse(expired.exists())
            self.assertLessEqual(snapshot["cache"]["sizeBytes"], 12)
            self.assertGreaterEqual(snapshot["cache"]["evictions"], 2)

    def test_snapshot_reports_cache_jobs_and_render_latency(self):
        with tempfile.TemporaryDirectory() as directory:
            cache = PdfExportCache(Path(directory))
            job = cache.enqueue_artifact(
                owner_id="user-1",
                key="metrics",
                filename="metrics.pdf",
                content_type="application/pdf",
                render=lambda: b"%PDF metrics",
            )
            wait_for(cache, job.id, {"id": "user-1", "role": "admin"})
            cache.enqueue_artifact(
                owner_id="user-1",
                key="metrics",
                filename="metrics.pdf",
                content_type="application/pdf",
                render=lambda: b"unused",
            )
            snapshot = cache.snapshot()
            self.assertEqual(snapshot["cache"]["hits"], 1)
            self.assertEqual(snapshot["cache"]["misses"], 1)
            self.assertEqual(snapshot["renders"]["completed"], 1)
            self.assertIsNotNone(snapshot["renders"]["p95Ms"])

    def test_synchronous_cache_uses_one_render_for_concurrent_callers(self):
        with tempfile.TemporaryDirectory() as directory:
            cache = PdfExportCache(Path(directory))
            render_started = threading.Event()
            release_render = threading.Event()
            calls = []
            results = []

            def render():
                calls.append("render")
                render_started.set()
                release_render.wait(2)
                return b"%PDF singleflight"

            first = threading.Thread(target=lambda: results.append(cache.render_cached("shared", render)))
            second = threading.Thread(target=lambda: results.append(cache.render_cached("shared", render)))
            first.start()
            self.assertTrue(render_started.wait(1))
            second.start()
            release_render.set()
            first.join(2)
            second.join(2)

            self.assertFalse(first.is_alive())
            self.assertFalse(second.is_alive())
            self.assertEqual(calls, ["render"])
            self.assertEqual(results, [b"%PDF singleflight", b"%PDF singleflight"])


def build_batch(progress):
    progress(1)
    progress(2)
    return b"batch"


def wait_for_release(event, payload):
    event.wait(2)
    return payload


def wait_for(cache, job_id, user):
    for _ in range(100):
        job = cache.get_job(job_id, user)
        if job.status in {"ready", "failed"}:
            return job
        time.sleep(0.01)
    raise AssertionError("PDF task did not finish")
