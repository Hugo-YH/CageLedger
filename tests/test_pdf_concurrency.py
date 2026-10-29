import tempfile
import threading
import unittest
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from unittest.mock import patch

from server_app.pdf.cache import PDF_PRIORITY_WARM, PdfExportCache, PdfQueueFull
from tests.test_pdf_export_cache import wait_for

USER = {"id": "user", "role": "admin"}


class PdfConcurrencyTests(unittest.TestCase):
    def test_invalidating_during_staging_never_republishes_sync_artifact(self):
        for all_keys in (False, True):
            with self.subTest(all_keys=all_keys), tempfile.TemporaryDirectory() as directory:
                cache = PdfExportCache(Path(directory))
                staged, release = threading.Event(), threading.Event()
                original = cache._stage

                def stage(path, body, *, original=original, staged=staged, release=release):
                    temporary = original(path, body)
                    staged.set()
                    if not release.wait(2):
                        raise AssertionError("staging was not released")
                    return temporary

                with patch.object(cache, "_stage", side_effect=stage), ThreadPoolExecutor(max_workers=1) as executor:
                    result = executor.submit(cache.render_cached, "key", lambda: b"old")
                    try:
                        self.assertTrue(staged.wait(1))
                        cache.invalidate_all() if all_keys else cache.invalidate(["key"])
                    finally:
                        release.set()
                    self.assertEqual(result.result(2), b"old")
                self.assertFalse(cache.artifact_path("key").exists())
                self.assertEqual(list(cache.root.rglob("*.tmp")), [])
                self.assertEqual(cache.render_cached("key", lambda: b"fresh"), b"fresh")

    def test_async_invalidation_and_finished_job_identity(self):
        with tempfile.TemporaryDirectory() as directory:
            cache = PdfExportCache(Path(directory))
            started, release = threading.Event(), threading.Event()

            def render():
                started.set()
                if not release.wait(2):
                    raise AssertionError("render was not released")
                return b"old"

            job = cache.enqueue_artifact(
                owner_id="user", key="key", filename="test.pdf", content_type="application/pdf", render=render
            )
            try:
                self.assertTrue(started.wait(1))
                cache.invalidate_all()
            finally:
                release.set()
            self.assertEqual(wait_for(cache, job.id, USER).status, "failed")
            fresh = cache.enqueue_artifact(
                owner_id="user", key="key", filename="test.pdf", content_type="application/pdf", render=lambda: b"fresh"
            )
            self.assertEqual(wait_for(cache, fresh.id, USER).status, "ready")
            cache.invalidate(["key"])
            newer = cache.enqueue_artifact(
                owner_id="user", key="key", filename="test.pdf", content_type="application/pdf", render=lambda: b"newer"
            )
            self.assertEqual(wait_for(cache, newer.id, USER).status, "ready")
            self.assertEqual(cache.get_job(fresh.id, USER).status, "failed")
            with self.assertRaises(ValueError):
                cache.read_job(fresh)
            self.assertEqual(cache.read_job(newer), b"newer")

    def test_invalidation_between_publish_and_complete_fails_the_old_job(self):
        with tempfile.TemporaryDirectory() as directory:
            cache = PdfExportCache(Path(directory))
            original = cache._publish_artifact

            def publish(*args):
                result = original(*args)
                cache.invalidate(["key"])
                return result

            with patch.object(cache, "_publish_artifact", side_effect=publish):
                job = cache.enqueue_artifact(
                    owner_id="user",
                    key="key",
                    filename="test.pdf",
                    content_type="application/pdf",
                    render=lambda: b"old",
                )
                self.assertEqual(wait_for(cache, job.id, USER).status, "failed")

    def test_bounded_queue_reserves_user_capacity_without_losing_tasks(self):
        with tempfile.TemporaryDirectory() as directory:
            cache = PdfExportCache(Path(directory), max_pending=2)
            started, release = threading.Event(), threading.Event()

            def render():
                started.set()
                if not release.wait(2):
                    raise AssertionError("render was not released")
                return b"warm"

            warm = cache.enqueue_artifact(
                owner_id="user",
                key="warm",
                filename="warm.pdf",
                content_type="application/pdf",
                render=render,
                priority=PDF_PRIORITY_WARM,
            )
            try:
                self.assertTrue(started.wait(1))
                with self.assertRaises(PdfQueueFull):
                    cache.enqueue_batch(
                        owner_id="user",
                        filename="warm.zip",
                        total=1,
                        render=lambda progress: b"warm",
                        priority=PDF_PRIORITY_WARM,
                    )
                duplicate = cache.enqueue_artifact(
                    owner_id="user2",
                    key="warm",
                    filename="warm.pdf",
                    content_type="application/pdf",
                    render=lambda: b"unused",
                )
                self.assertEqual(duplicate.id, warm.id)
                user = cache.enqueue_batch(
                    owner_id="user", filename="user.zip", total=1, render=lambda progress: b"zip"
                )
                with self.assertRaises(PdfQueueFull):
                    cache.enqueue_batch(
                        owner_id="user", filename="extra.zip", total=1, render=lambda progress: b"unused"
                    )
                self.assertEqual(cache.snapshot()["jobs"]["active"], 2)
                self.assertEqual(cache._tasks.maxsize, 2)
            finally:
                release.set()
            self.assertEqual(wait_for(cache, warm.id, USER).status, "ready")
            self.assertEqual(wait_for(cache, user.id, USER).status, "ready")

    def test_finished_job_metadata_is_bounded_without_read_evictions(self):
        with tempfile.TemporaryDirectory() as directory, patch("server_app.pdf.cache.PDF_MAX_RETAINED_JOBS", 3):
            cache = PdfExportCache(Path(directory))
            cache.render_cached("key", lambda: b"cached")
            jobs = [
                cache.enqueue_artifact(
                    owner_id="user",
                    key="key",
                    filename="test.pdf",
                    content_type="application/pdf",
                    render=lambda: b"unused",
                )
                for _ in range(3)
            ]
            self.assertEqual(cache.get_job(jobs[0].id, USER).status, "ready")
            self.assertEqual(len(cache._jobs), 3)
            cache.enqueue_artifact(
                owner_id="user",
                key="key",
                filename="test.pdf",
                content_type="application/pdf",
                render=lambda: b"unused",
            )
            self.assertEqual(len(cache._jobs), 3)
            with self.assertRaises(LookupError):
                cache.get_job(jobs[0].id, USER)
            cache.invalidate([f"missing-{index}" for index in range(1000)])
            self.assertEqual(cache._versions, {})

    def test_render_error_does_not_leak_paths_or_stop_worker(self):
        with tempfile.TemporaryDirectory() as directory:
            cache = PdfExportCache(Path(directory))

            def fail():
                raise OSError("secret /private/database/path")

            failed = cache.enqueue_artifact(
                owner_id="user", key="bad", filename="bad.pdf", content_type="application/pdf", render=fail
            )
            self.assertEqual(wait_for(cache, failed.id, USER).status, "failed")
            self.assertNotIn("private", cache.job_payload(failed)["error"])
            good = cache.enqueue_artifact(
                owner_id="user", key="good", filename="good.pdf", content_type="application/pdf", render=lambda: b"good"
            )
            self.assertEqual(wait_for(cache, good.id, USER).status, "ready")


if __name__ == "__main__":
    unittest.main()
