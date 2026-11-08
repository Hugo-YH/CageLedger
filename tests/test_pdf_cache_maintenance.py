"""Disk maintenance keeps PDF job metadata responsive and publication current."""

import os
import tempfile
import threading
import time
import unittest
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from unittest.mock import patch

from server_app.pdf.cache import PdfExportCache

USER = {"id": "synthetic-admin", "role": "admin"}


class PdfCacheMaintenanceTests(unittest.TestCase):
    def ready_job(self, cache, key="old"):
        cache.render_cached(key, lambda: b"old artifact")
        return cache.enqueue_artifact(
            owner_id=USER["id"],
            key=key,
            filename="synthetic.pdf",
            content_type="application/pdf",
            render=lambda: b"unused",
        )

    def test_directory_scan_keeps_job_metadata_and_snapshot_available(self):
        with tempfile.TemporaryDirectory() as directory:
            cache = PdfExportCache(Path(directory))
            job = self.ready_job(cache)
            entered, release = threading.Event(), threading.Event()
            original = Path.glob

            def scan(path, pattern):
                files = list(original(path, pattern))
                if path == cache.root / "artifacts":
                    entered.set()
                    if not release.wait(2):
                        raise AssertionError("scan was not released")
                return iter(files)

            with patch.object(Path, "glob", scan), ThreadPoolExecutor(max_workers=3) as pool:
                maintenance = pool.submit(cache._prune_artifacts, force=True)
                try:
                    self.assertTrue(entered.wait(1))
                    self.assertEqual(pool.submit(cache.get_job, job.id, USER).result(1).status, "ready")
                    snapshot = pool.submit(cache.snapshot).result(1)
                    self.assertEqual(snapshot["cache"]["entries"], 1)
                    self.assertEqual(snapshot["cache"]["sizeBytes"], len(b"old artifact"))
                finally:
                    release.set()
                maintenance.result(2)

    def test_stale_scan_does_not_delete_a_new_atomic_publication(self):
        with tempfile.TemporaryDirectory() as directory:
            cache = PdfExportCache(Path(directory), artifact_ttl_seconds=1)
            path = cache.artifact_path("same")
            cache.render_cached("same", lambda: b"expired")
            old = time.time() - 10
            os.utime(path, (old, old))
            scanned, release = threading.Event(), threading.Event()
            original = sorted

            def after_observation(values, *args, **kwargs):
                ordered = original(values, *args, **kwargs)
                if ordered and isinstance(ordered[0], tuple) and len(ordered[0]) == 3:
                    scanned.set()
                    if not release.wait(2):
                        raise AssertionError("observed scan was not released")
                return ordered

            with (
                patch("server_app.pdf.cache.sorted", side_effect=after_observation, create=True),
                ThreadPoolExecutor(max_workers=1) as pool,
            ):
                maintenance = pool.submit(cache._prune_artifacts, force=True)
                try:
                    self.assertTrue(scanned.wait(1))
                    self.assertTrue(
                        cache._publish_artifact("same", cache._version_for("same"), path, b"fresh publication")
                    )
                finally:
                    release.set()
                maintenance.result(2)
            self.assertEqual(path.read_bytes(), b"fresh publication")
            snapshot = cache.snapshot()["cache"]
            self.assertEqual(
                (snapshot["entries"], snapshot["sizeBytes"], snapshot["evictions"]), (1, len(b"fresh publication"), 0)
            )

    def test_full_invalidation_preserves_later_publication_and_keeps_metadata_available(self):
        for pause in ("scan", "unlink"):
            with self.subTest(pause=pause), tempfile.TemporaryDirectory() as directory:
                cache = PdfExportCache(Path(directory))
                old_job = self.ready_job(cache)
                entered, release, staged = threading.Event(), threading.Event(), threading.Event()
                original_glob, original_unlink, original_stage = Path.glob, Path.unlink, cache._stage

                def wait(entered=entered, release=release):
                    entered.set()
                    if not release.wait(2):
                        raise AssertionError("full cleanup was not released")

                def scan(path, pattern, *, pause=pause, cache=cache, original=original_glob, wait=wait):
                    files = list(original(path, pattern))
                    if pause == "scan" and path == cache.root / "artifacts":
                        wait()
                    return iter(files)

                def unlink(path, *args, pause=pause, cache=cache, original=original_unlink, wait=wait, **kwargs):
                    if pause == "unlink" and path == cache.artifact_path("old"):
                        wait()
                    return original(path, *args, **kwargs)

                def stage(path, body, *, original=original_stage, staged=staged):
                    temporary = original(path, body)
                    if body == b"new artifact":
                        staged.set()
                    return temporary

                with (
                    patch.object(Path, "glob", scan),
                    patch.object(Path, "unlink", unlink),
                    patch.object(cache, "_stage", side_effect=stage),
                    ThreadPoolExecutor(max_workers=4) as pool,
                ):
                    invalidating = pool.submit(cache.invalidate_all)
                    try:
                        self.assertTrue(entered.wait(1))
                        self.assertEqual(pool.submit(cache.get_job, old_job.id, USER).result(1).status, "failed")
                        self.assertEqual(pool.submit(cache.snapshot).result(1)["jobs"]["failed"], 1)
                        fresh = pool.submit(cache.render_cached, "new", lambda: b"new artifact")
                        self.assertTrue(staged.wait(1))
                        self.assertFalse(fresh.done())
                    finally:
                        release.set()
                    invalidating.result(2)
                    self.assertEqual(fresh.result(2), b"new artifact")
                self.assertFalse(cache.artifact_path("old").exists())
                self.assertEqual(
                    cache.render_cached("new", lambda: self.fail("fresh artifact should hit")), b"new artifact"
                )
                self.assertEqual(list(cache.root.rglob("*.tmp")), [])
                stats = cache.snapshot()["cache"]
                self.assertEqual((stats["entries"], stats["sizeBytes"]), (1, len(b"new artifact")))

    def test_failed_full_cleanup_releases_locks_and_never_reuses_previous_generation(self):
        with tempfile.TemporaryDirectory() as directory:
            cache = PdfExportCache(Path(directory))
            job = self.ready_job(cache)
            path = cache.artifact_path("old")
            original = Path.unlink

            def unlink(target, *args, **kwargs):
                if target == path:
                    raise OSError("synthetic cleanup failure")
                return original(target, *args, **kwargs)

            with patch.object(Path, "unlink", unlink), self.assertRaisesRegex(OSError, "cleanup failure"):
                cache.invalidate_all()
            self.assertTrue(path.exists())
            self.assertIsNone(cache._read_artifact(path))
            self.assertEqual(cache.get_job(job.id, USER).status, "failed")
            with self.assertRaises(ValueError):
                cache.read_job(job)
            for lock in (cache._maintenance_lock, cache._publication_lock):
                self.assertTrue(lock.acquire(blocking=False))
                lock.release()
            with patch.object(cache, "_submit"):
                replacement = cache.enqueue_artifact(
                    owner_id=USER["id"],
                    key="old",
                    filename="new.pdf",
                    content_type="application/pdf",
                    render=lambda: b"new generation",
                )
            self.assertEqual(replacement.status, "queued")
            cache._run_artifact(replacement.id)
            self.assertEqual(cache.read_job(replacement), b"new generation")
            self.assertEqual(
                cache.render_cached("old", lambda: self.fail("new generation should hit")), b"new generation"
            )
            stats = cache.snapshot()["cache"]
            self.assertEqual((stats["entries"], stats["sizeBytes"]), (1, len(b"new generation")))

    def test_warm_snapshot_reuses_file_statistics_without_another_directory_scan(self):
        with tempfile.TemporaryDirectory() as directory:
            cache = PdfExportCache(Path(directory))
            self.ready_job(cache)
            with patch.object(Path, "glob", side_effect=AssertionError("warm snapshot enumerated files")):
                snapshot = cache.snapshot()["cache"]
            self.assertEqual((snapshot["entries"], snapshot["sizeBytes"]), (1, len(b"old artifact")))
