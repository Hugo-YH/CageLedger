import gzip
import json
import logging
import os
import tempfile
import threading
import time
import unittest
from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime
from pathlib import Path
from unittest.mock import patch

from server_app.runtime_log_archive import ArchiveRotatingFileHandler


class RuntimeLogArchiveTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.now = time.time()
        self.errors = []

    def handler(self, **settings):
        handler = ArchiveRotatingFileHandler(
            self.root / "runtime.jsonl",
            maxBytes=settings.pop("maxBytes", 10000),
            backupCount=settings.pop("backupCount", 364),
            retentionDays=settings.pop("retentionDays", 90),
            totalMaxBytes=settings.pop("totalMaxBytes", 1000000),
            encoding="utf-8",
            clock=lambda: self.now,
            report_error=lambda stage, error: self.errors.append((stage, type(error).__name__)),
            **settings,
        )
        handler.setFormatter(logging.Formatter("%(message)s"))
        self.addCleanup(handler.close)
        self.assertTrue(handler.wait_for_archives())
        return handler

    def emit(self, handler, event):
        record = logging.makeLogRecord(
            {
                "msg": json.dumps(
                    {"at": datetime.fromtimestamp(self.now, UTC).isoformat(), "event": event}, ensure_ascii=False
                )
            }
        )
        handler.handle(record)

    def records(self):
        items = []
        for path in self.root.glob("runtime.*"):
            content = gzip.decompress(path.read_bytes()) if path.suffix == ".gz" else path.read_bytes()
            items.extend(json.loads(line) for line in content.decode().splitlines())
        return items

    def legacy(self, number, payload=b'{"event":"legacy"}\n', age=0, compressed=False):
        path = self.root / f"runtime.jsonl.{number}{'.gz' if compressed else ''}"
        path.write_bytes(gzip.compress(payload) if compressed else payload)
        stamp = self.now - age * 86400
        os.utime(path, (stamp, stamp))
        return path

    def test_cross_beijing_midnight_rotates_and_same_day_restart_appends(self):
        self.now = datetime(2026, 11, 2, 15, 59, tzinfo=UTC).timestamp()
        handler = self.handler()
        self.emit(handler, "before-midnight")
        handler.close()
        handler = self.handler()
        self.emit(handler, "same-day-restart")
        self.assertEqual(len(list(self.root.glob("runtime.*"))), 1)
        self.now += 120
        self.emit(handler, "after-midnight")
        self.assertTrue(handler.wait_for_archives())
        archives = list(self.root.glob("runtime.2026-11-02.*.jsonl"))
        self.assertEqual(len(archives), 1)
        self.assertEqual(
            {r["event"] for r in self.records()}, {"before-midnight", "same-day-restart", "after-midnight"}
        )
        self.assertIn("after-midnight", (self.root / "runtime.jsonl").read_text())

    def test_size_segments_keep_every_utf8_record_and_unique_names(self):
        handler = self.handler(maxBytes=350)
        events = [f"记录-{index}-" + "实验动物" * 8 for index in range(20)]
        for event in events:
            self.emit(handler, event)
        self.assertTrue(handler.wait_for_archives())
        self.assertEqual(sorted(r["event"] for r in self.records()), sorted(events))
        paths = list(self.root.glob("runtime.*"))
        self.assertGreater(len(paths), 2)
        self.assertEqual(len({p.name for p in paths}), len(paths))
        for path in paths:
            content = gzip.decompress(path.read_bytes()) if path.suffix == ".gz" else path.read_bytes()
            self.assertLess(len(content), 350)
        self.assertFalse(self.errors)

    def test_legacy_numeric_files_are_retained_without_rewriting(self):
        original = b'{"event":"first"}\n{"event":"second"}\n'
        old = self.legacy(1, original)
        handler = self.handler()
        self.assertEqual(old.read_bytes(), original)
        self.assertFalse(list(self.root.glob("*.gz")))
        self.assertFalse(self.errors)
        self.emit(handler, "new-record")

    def test_old_multiday_or_partial_active_file_is_preserved_intact(self):
        for partial in (False, True):
            with self.subTest(partial=partial):
                content = b'{"at":"2026-11-01T00:00:00+00:00","event":"old"}\n'
                content += b'{"at":"2026-11-02T00:00:00+00:00","event":"last"}'
                if not partial:
                    content += b"\n"
                (self.root / "runtime.jsonl").write_bytes(content)
                handler = self.handler()
                self.emit(handler, "new-format")
                self.assertTrue(handler.wait_for_archives())
                archives = list(self.root.glob("runtime.2026-11-02.*.jsonl"))
                self.assertTrue(any(p.read_bytes() == content for p in archives))
                self.assertEqual(json.loads((self.root / "runtime.jsonl").read_text())["event"], "new-format")
                handler.close()

    def test_retention_never_removes_active_foreign_files_or_symlinks(self):
        expired = self.legacy(1, age=91)
        recent = self.legacy(2, age=89)
        foreign = self.root / "database.sqlite"
        foreign.write_bytes(b"never touch")
        link = self.root / "runtime.jsonl.3"
        link.symlink_to(foreign)
        handler = self.handler()
        self.emit(handler, "current")
        self.assertFalse(expired.exists())
        self.assertTrue(recent.exists())
        self.assertEqual(foreign.read_bytes(), b"never touch")
        self.assertTrue(link.is_symlink())
        self.assertTrue((self.root / "runtime.jsonl").exists())

    def test_explicit_old_file_count_still_includes_active(self):
        files = [self.legacy(i, age=i, compressed=True) for i in range(1, 5)]
        self.handler(backupCount=2)
        self.assertTrue(files[0].exists())
        self.assertTrue(files[1].exists())
        self.assertFalse(files[2].exists())
        self.assertFalse(files[3].exists())

    def test_total_budget_removes_oldest_segments(self):
        files = [self.legacy(i, os.urandom(500), age=i) for i in range(1, 5)]
        self.handler(totalMaxBytes=1200)
        self.assertTrue(files[0].exists())
        self.assertFalse(files[-1].exists())
        self.assertLessEqual(sum(p.stat().st_size for p in self.root.glob("runtime.*")), 1200)

    def test_cleanup_failure_retains_original_and_retries(self):
        handler = self.handler()
        source = self.legacy(1, age=91)
        content = source.read_bytes()
        with patch.object(Path, "unlink", side_effect=PermissionError("simulated permission failure")):
            handler._schedule()
            self.assertTrue(handler.wait_for_archives())
        self.assertEqual(source.read_bytes(), content)
        self.assertIn(("retention", "PermissionError"), self.errors)
        self.emit(handler, "requests-still-work")
        handler._schedule()
        self.assertTrue(handler.wait_for_archives())
        self.assertFalse(source.exists())
        self.assertIn("requests-still-work", (self.root / "runtime.jsonl").read_text())

    def test_rename_failure_keeps_the_existing_active_file(self):
        handler = self.handler(maxBytes=200)
        self.emit(handler, "first" * 10)
        original = (self.root / "runtime.jsonl").read_bytes()
        with (
            patch.object(handler, "rotate", side_effect=OSError("rename failed")),
            patch.object(handler, "handleError") as failed,
        ):
            self.emit(handler, "second" * 10)
        failed.assert_called_once()
        self.assertEqual((self.root / "runtime.jsonl").read_bytes(), original)

    def test_slow_cleanup_does_not_block_request_logging(self):
        handler = self.handler(maxBytes=200)
        entered, release = threading.Event(), threading.Event()
        original = handler._prune

        def paused():
            entered.set()
            self.assertTrue(release.wait(timeout=5))
            original()

        with patch.object(handler, "_prune", side_effect=paused):
            pool = ThreadPoolExecutor(max_workers=1)
            try:
                self.emit(handler, "first" * 10)
                self.emit(handler, "second" * 10)
                self.assertTrue(entered.wait(timeout=5))
                pool.submit(self.emit, handler, "request-keeps-working").result(timeout=2)
            finally:
                release.set()
                pool.shutdown(wait=True)
            self.assertTrue(handler.wait_for_archives())
        self.assertEqual(len(self.records()), 3)
        handler.close()
        self.assertFalse(handler._worker.is_alive())

    def test_each_record_is_formatted_once_and_never_compressed(self):
        handler = self.handler()
        with patch.object(handler, "format", wraps=handler.format) as formatter:
            self.emit(handler, "one-format")
        formatter.assert_called_once()
        self.assertFalse(list(self.root.glob("*.gz")))

    def test_cleanup_tolerates_active_file_rename_window(self):
        handler = self.handler()
        original_stat = Path.stat

        def during_rotation(path, *args, **kwargs):
            if path == self.root / "runtime.jsonl":
                raise FileNotFoundError("active path is being reopened")
            return original_stat(path, *args, **kwargs)

        with patch.object(Path, "stat", during_rotation):
            handler._maintenance()
        self.assertTrue((self.root / "runtime.jsonl").exists())

    def test_concurrent_writers_preserve_all_records(self):
        handler = self.handler(maxBytes=350)
        events = [f"concurrent-{index}" for index in range(100)]
        with ThreadPoolExecutor(max_workers=4) as pool:
            list(pool.map(lambda event: self.emit(handler, event), events))
        self.assertTrue(handler.wait_for_archives())
        self.assertEqual(sorted(r["event"] for r in self.records()), sorted(events))
