"""One bounded CPU/memory budget shared by external document converters."""

import threading
import time
from contextlib import contextmanager

from server_app.config import HEAVY_MAX_WORKERS
from server_app.performance import record_stage


class HeavyWorkBusy(RuntimeError):
    pass


class HeavyWorkBudget:
    def __init__(self, capacity):
        self.capacity = max(int(capacity), 1)
        self._slots = threading.BoundedSemaphore(self.capacity)
        self._lock = threading.Lock()
        self._local = threading.local()
        self._active = self._waiting = self._rejected = 0

    @contextmanager
    def slot(self, *, timeout=0):
        # Nested synchronous work on the same thread shares its parent's slot.
        # Queue submitters never acquire this budget; only executing converters do.
        if getattr(self._local, "active", False):
            yield
            return
        started = time.perf_counter()
        with self._lock:
            self._waiting += 1
        acquired = False
        try:
            acquired = self._slots.acquire(timeout=max(float(timeout), 0))
        finally:
            with self._lock:
                self._waiting -= 1
                self._active += int(acquired)
                self._rejected += int(not acquired)
            try:
                record_stage("heavy.wait", (time.perf_counter() - started) * 1000)
            except BaseException:
                if acquired:
                    with self._lock:
                        self._active -= 1
                    self._slots.release()
                raise
        if not acquired:
            raise HeavyWorkBusy("文档处理繁忙，请稍后重试")
        self._local.active = True
        try:
            yield
        finally:
            self._local.active = False
            with self._lock:
                self._active -= 1
            self._slots.release()

    def snapshot(self):
        with self._lock:
            return {
                "capacity": self.capacity,
                "active": self._active,
                "waiting": self._waiting,
                "rejected": self._rejected,
            }


DOCUMENT_WORK = HeavyWorkBudget(HEAVY_MAX_WORKERS)
