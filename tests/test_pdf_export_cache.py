import tempfile
import time
import unittest
from pathlib import Path

from server_app.pdf.cache import PdfExportCache


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


def build_batch(progress):
    progress(1)
    progress(2)
    return b"batch"


def wait_for(cache, job_id, user):
    for _ in range(100):
        job = cache.get_job(job_id, user)
        if job.status in {"ready", "failed"}:
            return job
        time.sleep(0.01)
    raise AssertionError("PDF task did not finish")
