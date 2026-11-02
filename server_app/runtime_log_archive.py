"""Date/size rotation with background retention and no compression."""

import json
import os
import re
import threading
import time
from datetime import datetime, timedelta, timezone
from logging.handlers import RotatingFileHandler
from pathlib import Path
from uuid import uuid4

BEIJING = timezone(timedelta(hours=8))
_ARCHIVE = re.compile(r"runtime\.(?:\d{4}-\d{2}-\d{2}\.\d{6}\.\d+\.[a-f0-9]{12}\.jsonl|jsonl\.[1-9]\d*)(?:\.gz)?\Z")
_MAINTENANCE_LOCK = threading.Lock()


class ArchiveRotatingFileHandler(RotatingFileHandler):
    def __init__(
        self,
        filename,
        *,
        retentionDays=90,
        totalMaxBytes=1024 * 1024 * 1024,
        report_error=None,
        clock=time.time,
        **kwargs,
    ):
        super().__init__(filename, **kwargs)
        self.retention_days = retentionDays
        self.total_max_bytes = totalMaxBytes
        self.report_error = report_error
        self.clock = clock
        self.directory = Path(self.baseFilename).parent
        self._day, self._legacy = self._existing_day()
        self._stop = threading.Event()
        self._wake = threading.Event()
        self._idle = threading.Event()
        self._state_lock = threading.Lock()
        self._closing = False
        self._worker = threading.Thread(target=self._maintain, name="runtime-log-archive", daemon=True)
        self._worker.start()
        self._schedule()

    def _existing_day(self):
        path = Path(self.baseFilename)
        if not path.exists() or path.stat().st_size == 0:
            return datetime.fromtimestamp(self.clock(), BEIJING).date(), False
        with path.open("rb") as stream:
            first = stream.readline(65536)
            stream.seek(max(0, path.stat().st_size - 65536))
            tail = stream.read()
        fallback = datetime.fromtimestamp(path.stat().st_mtime, BEIJING).date()
        try:
            first_day = datetime.fromisoformat(json.loads(first)["at"]).astimezone(BEIJING).date()
            last_day = datetime.fromisoformat(json.loads(tail.splitlines()[-1])["at"]).astimezone(BEIJING).date()
            # Preserve an old multi-day/partial active file as one intact archive.
            return last_day, first_day != last_day or not tail.endswith(b"\n")
        except (ValueError, KeyError, IndexError, TypeError):
            return fallback, True

    def shouldRollover(self, record):
        message = self.format(record) + self.terminator
        return self._rollover_needed(len(message.encode(self.encoding, self.errors or "strict")))

    def _rollover_needed(self, message_bytes):
        if self.stream is None:
            self.stream = self._open()
        self.stream.seek(0, 2)
        size = self.stream.tell()
        today = datetime.fromtimestamp(self.clock(), BEIJING).date()
        if not size:
            self._day, self._legacy = today, False
            return False
        if self._legacy or self._day != today:
            return True
        return self.maxBytes > 0 and size + message_bytes >= self.maxBytes

    def emit(self, record):
        try:
            # Format once: size accounting and writing use the exact same UTF-8
            # bytes. No compression, directory scan or retention runs here.
            message = self.format(record) + self.terminator
            if self._rollover_needed(len(message.encode(self.encoding, self.errors or "strict"))):
                self.doRollover()
            self.stream.write(message)
            self.flush()
        except Exception:  # noqa: BLE001 - the safe subclass forwards this record to stdout.
            self.handleError(record)

    def doRollover(self):
        if self.stream:
            self.stream.close()
            self.stream = None
        source = Path(self.baseFilename)
        if source.exists() and source.stat().st_size:
            stamp = datetime.fromtimestamp(self.clock(), BEIJING).strftime("%H%M%S")
            target = self.directory / f"runtime.{self._day}.{stamp}.{os.getpid()}.{uuid4().hex[:12]}.jsonl"
            self.rotate(str(source), str(target))
        self._day = datetime.fromtimestamp(self.clock(), BEIJING).date()
        self._legacy = False
        if not self.delay:
            self.stream = self._open()
        self._schedule()

    def _schedule(self):
        with self._state_lock:
            self._idle.clear()
            self._wake.set()

    def _archives(self):
        return [
            path
            for path in self.directory.iterdir()
            if _ARCHIVE.fullmatch(path.name) and not path.is_symlink() and path.is_file()
        ]

    def _sync_directory(self):
        descriptor = os.open(self.directory, os.O_RDONLY)
        try:
            os.fsync(descriptor)
        finally:
            os.close(descriptor)

    def _prune(self):
        paths = sorted(self._archives(), key=lambda p: (p.stat().st_mtime_ns, p.name))
        active = Path(self.baseFilename)
        try:
            active_bytes = active.stat().st_size
        except FileNotFoundError:
            # Rotation briefly renames the active path before reopening it.
            active_bytes = 0
        total = sum(path.stat().st_size for path in paths) + active_bytes
        count = len(paths) + 1
        cutoff = self.clock() - self.retention_days * 86400
        removed = False
        for path in paths:
            metadata = path.stat()
            if metadata.st_mtime >= cutoff and count <= self.backupCount + 1 and total <= self.total_max_bytes:
                continue
            path.unlink()
            removed = True
            count -= 1
            total -= metadata.st_size
        if removed:
            self._sync_directory()

    def _maintenance(self):
        with _MAINTENANCE_LOCK:
            self._prune()

    def _maintain(self):
        while True:
            self._wake.wait(60)
            self._wake.clear()
            try:
                self._maintenance()
            except Exception as error:  # noqa: BLE001 - logging must not take down request/background workers.
                if self.report_error:
                    self.report_error("retention", error)
            with self._state_lock:
                if not self._wake.is_set():
                    self._idle.set()
            if self._stop.is_set():
                return

    def wait_for_archives(self, timeout=5):
        return self._idle.wait(timeout)

    def close(self):
        if getattr(self, "_closing", True):
            super().close()
            return
        self._closing = True
        self._stop.set()
        self._schedule()
        if threading.current_thread() is not self._worker:
            self._worker.join(timeout=2)
        super().close()
