"""Disk-backed PDF artifacts and background export jobs."""

from __future__ import annotations

import hashlib
import os
import tempfile
import time
import uuid
from collections.abc import Callable
from dataclasses import dataclass, field
from itertools import count
from pathlib import Path
from queue import PriorityQueue
from threading import Lock, Thread

from server_app.config import PDF_CACHE_MAX_BYTES, PDF_CACHE_PATH, PDF_CACHE_TTL_SECONDS

PDF_JOB_TTL_SECONDS = 24 * 60 * 60
PDF_CACHE_PRUNE_INTERVAL_SECONDS = 60
PDF_PRIORITY_USER = 0
PDF_PRIORITY_WARM = 10
PDF_LATENCY_SAMPLE_LIMIT = 256


@dataclass
class PdfExportJob:
    id: str
    owner_id: str
    key: str
    filename: str
    content_type: str
    total: int
    status: str = "queued"
    completed: int = 0
    error: str = ""
    path: Path | None = None
    updated_at: float = 0
    owner_ids: set[str] = field(default_factory=set)
    priority: int = PDF_PRIORITY_USER


@dataclass(order=True)
class _ScheduledTask:
    priority: int
    sequence: int
    callback: Callable[[], None] = field(compare=False)


class PdfExportCache:
    """Serialize Chromium work while retaining finished artifacts on disk."""

    def __init__(
        self,
        root: Path = PDF_CACHE_PATH,
        *,
        max_bytes: int = PDF_CACHE_MAX_BYTES,
        artifact_ttl_seconds: int = PDF_CACHE_TTL_SECONDS,
    ):
        self.root = root
        self.max_bytes = max(int(max_bytes), 0)
        self.artifact_ttl_seconds = max(int(artifact_ttl_seconds), 0)
        self._jobs: dict[str, PdfExportJob] = {}
        self._active_keys: dict[str, str] = {}
        self._versions: dict[str, int] = {}
        self._key_locks: dict[str, tuple[Lock, int]] = {}
        self._lock = Lock()
        self._tasks: PriorityQueue[_ScheduledTask] = PriorityQueue()
        self._task_sequence = count()
        self._worker: Thread | None = None
        self._last_prune_at = 0.0
        self._metrics = {
            "hits": 0,
            "misses": 0,
            "evictions": 0,
            "completed": 0,
            "failures": 0,
        }
        self._latency_samples: list[float] = []

    def invalidate(self, keys: list[str]):
        with self._lock:
            for key in set(keys):
                self._versions[key] = self._versions.get(key, 0) + 1
                self.artifact_path(key).unlink(missing_ok=True)
                self._active_keys.pop(key, None)

    def invalidate_all(self):
        with self._lock:
            for key in self._active_keys:
                self._versions[key] = self._versions.get(key, 0) + 1
            self._active_keys.clear()
            artifacts = self.root / "artifacts"
            if artifacts.exists():
                for path in artifacts.glob("*.pdf"):
                    path.unlink(missing_ok=True)

    def enqueue_artifact(
        self,
        *,
        owner_id: str,
        key: str,
        filename: str,
        content_type: str,
        render: Callable[[], bytes],
        priority: int = PDF_PRIORITY_USER,
    ) -> PdfExportJob:
        cached = self.artifact_path(key)
        with self._lock:
            self._cleanup_jobs_locked()
            self._prune_artifacts_locked()
            if cached.exists():
                self._metrics["hits"] += 1
                return self._ready_job(owner_id, key, filename, content_type, cached)
            self._metrics["misses"] += 1
            active_id = self._active_keys.get(key)
            if active_id and active_id in self._jobs:
                self._jobs[active_id].owner_ids.add(owner_id)
                return self._jobs[active_id]
            job = self._new_job(owner_id, key, filename, content_type, 1, priority=priority)
            version = self._versions.get(key, 0)
            self._active_keys[key] = job.id
        self._submit(priority, lambda: self._run_artifact(job.id, key, version, render))
        return job

    def enqueue_batch(
        self,
        *,
        owner_id: str,
        filename: str,
        total: int,
        render: Callable[[Callable[[int], None]], bytes],
        priority: int = PDF_PRIORITY_USER,
    ) -> PdfExportJob:
        with self._lock:
            self._cleanup_jobs_locked()
            job = self._new_job(
                owner_id,
                f"batch:{uuid.uuid4().hex}",
                filename,
                "application/zip",
                total,
                priority=priority,
            )
        self._submit(priority, lambda: self._run_batch(job.id, render))
        return job

    def render_cached(self, key: str, render: Callable[[], bytes]) -> bytes:
        key_lock = self._key_lock(key)
        try:
            with key_lock:
                path = self.artifact_path(key)
                if path.exists():
                    with self._lock:
                        self._metrics["hits"] += 1
                    return path.read_bytes()
                with self._lock:
                    self._metrics["misses"] += 1
                version = self._version_for(key)
                started_at = time.perf_counter()
                try:
                    body = render()
                except Exception:
                    self._record_render(time.perf_counter() - started_at, failed=True)
                    raise
                self._record_render(time.perf_counter() - started_at)
                if self._version_for(key) == version:
                    self._write(path, body)
                return body
        finally:
            self._release_key_lock(key, key_lock)

    def snapshot(self):
        with self._lock:
            self._cleanup_jobs_locked()
            self._prune_artifacts_locked()
            jobs = list(self._jobs.values())
            counters = dict(self._metrics)
            samples = list(self._latency_samples)
        artifacts = self._artifact_stats()
        lookups = counters["hits"] + counters["misses"]
        return {
            "cache": {
                **artifacts,
                "capacityBytes": self.max_bytes,
                "ttlSeconds": self.artifact_ttl_seconds,
                "hits": counters["hits"],
                "misses": counters["misses"],
                "evictions": counters["evictions"],
                "hitRate": round(counters["hits"] / lookups, 4) if lookups else None,
            },
            "jobs": {
                "queued": sum(job.status == "queued" for job in jobs),
                "rendering": sum(job.status == "rendering" for job in jobs),
                "ready": sum(job.status == "ready" for job in jobs),
                "failed": sum(job.status == "failed" for job in jobs),
                "active": sum(job.status in {"queued", "rendering"} for job in jobs),
                "backgroundQueued": sum(job.status == "queued" and job.priority >= PDF_PRIORITY_WARM for job in jobs),
            },
            "renders": {
                "completed": counters["completed"],
                "failures": counters["failures"],
                **_latency_summary(samples),
            },
        }

    def get_job(self, job_id: str, user: dict) -> PdfExportJob:
        with self._lock:
            self._cleanup_jobs_locked()
            job = self._jobs.get(job_id)
            if not job:
                raise LookupError("PDF 导出任务已过期，请重新导出")
            if user.get("role") != "admin" and user.get("id") not in job.owner_ids:
                raise PermissionError("无权访问该 PDF 导出任务")
            return job

    def read_job(self, job: PdfExportJob) -> bytes:
        if job.status != "ready" or not job.path or not job.path.exists():
            raise ValueError("PDF 文件仍在生成中")
        return job.path.read_bytes()

    def job_payload(self, job: PdfExportJob) -> dict:
        return {
            "id": job.id,
            "status": job.status,
            "completed": job.completed,
            "total": job.total,
            "filename": job.filename,
            "error": job.error,
            "downloadUrl": f"/api/pdf-export-jobs/{job.id}/download" if job.status == "ready" else "",
        }

    def artifact_path(self, key: str) -> Path:
        digest = hashlib.sha256(key.encode("utf-8")).hexdigest()
        return self.root / "artifacts" / f"{digest}.pdf"

    def _run_artifact(self, job_id: str, key: str, version: int, render: Callable[[], bytes]):
        self._set_status(job_id, "rendering")
        started_at = time.perf_counter()
        try:
            body = render()
            path = self.artifact_path(key)
            if self._version_for(key) == version:
                self._write(path, body)
                self._complete(job_id, path, 1)
                self._record_render(time.perf_counter() - started_at)
            else:
                self._fail(job_id, "源数据已更新，正在刷新 PDF")
                self._record_render(time.perf_counter() - started_at, failed=True)
        except Exception as exc:
            self._fail(job_id, str(exc))
            self._record_render(time.perf_counter() - started_at, failed=True)
        finally:
            with self._lock:
                if self._active_keys.get(key) == job_id:
                    self._active_keys.pop(key, None)

    def _run_batch(self, job_id: str, render: Callable[[Callable[[int], None]], bytes]):
        self._set_status(job_id, "rendering")
        started_at = time.perf_counter()
        try:
            body = render(lambda completed: self._set_completed(job_id, completed))
            path = self.root / "jobs" / f"{job_id}.zip"
            self._write(path, body)
            job = self._jobs[job_id]
            self._complete(job_id, path, job.total)
            self._record_render(time.perf_counter() - started_at)
        except Exception as exc:
            self._fail(job_id, str(exc))
            self._record_render(time.perf_counter() - started_at, failed=True)

    def _new_job(
        self,
        owner_id: str,
        key: str,
        filename: str,
        content_type: str,
        total: int,
        *,
        priority: int = PDF_PRIORITY_USER,
    ) -> PdfExportJob:
        job = PdfExportJob(
            id=uuid.uuid4().hex,
            owner_id=owner_id,
            key=key,
            filename=filename,
            content_type=content_type,
            total=max(total, 1),
            updated_at=time.time(),
            priority=priority,
        )
        self._jobs[job.id] = job
        job.owner_ids.add(owner_id)
        return job

    def _ready_job(self, owner_id: str, key: str, filename: str, content_type: str, path: Path) -> PdfExportJob:
        job = self._new_job(owner_id, key, filename, content_type, 1)
        job.status = "ready"
        job.completed = 1
        job.path = path
        return job

    def _set_status(self, job_id: str, status: str):
        with self._lock:
            job = self._jobs.get(job_id)
            if job:
                job.status = status
                job.updated_at = time.time()

    def _set_completed(self, job_id: str, completed: int):
        with self._lock:
            job = self._jobs.get(job_id)
            if job:
                job.completed = min(completed, job.total)
                job.updated_at = time.time()

    def _complete(self, job_id: str, path: Path, completed: int):
        with self._lock:
            job = self._jobs.get(job_id)
            if job:
                job.status = "ready"
                job.completed = completed
                job.path = path
                job.updated_at = time.time()

    def _fail(self, job_id: str, message: str):
        with self._lock:
            job = self._jobs.get(job_id)
            if job:
                job.status = "failed"
                job.error = message or "PDF 生成失败"
                job.updated_at = time.time()

    def _version_for(self, key: str) -> int:
        with self._lock:
            return self._versions.get(key, 0)

    def _write(self, path: Path, body: bytes):
        path.parent.mkdir(parents=True, exist_ok=True)
        descriptor, temporary_name = tempfile.mkstemp(prefix=f".{path.name}.", suffix=".tmp", dir=path.parent)
        temporary = Path(temporary_name)
        try:
            with os.fdopen(descriptor, "wb") as stream:
                stream.write(body)
            os.replace(temporary, path)
        finally:
            temporary.unlink(missing_ok=True)

    def _cleanup_jobs_locked(self):
        cutoff = time.time() - PDF_JOB_TTL_SECONDS
        stale = [
            job_id
            for job_id, job in self._jobs.items()
            if job.updated_at < cutoff and job.status in {"ready", "failed"}
        ]
        for job_id in stale:
            job = self._jobs.pop(job_id)
            if job.path and job.path.parent == self.root / "jobs":
                job.path.unlink(missing_ok=True)

    def _submit(self, priority: int, callback: Callable[[], None]):
        with self._lock:
            if not self._worker or not self._worker.is_alive():
                self._worker = Thread(target=self._work, name="cageledger-pdf-export", daemon=True)
                self._worker.start()
            sequence = next(self._task_sequence)
        self._tasks.put(_ScheduledTask(priority, sequence, callback))

    def _work(self):
        while True:
            task = self._tasks.get()
            try:
                task.callback()
            finally:
                self._tasks.task_done()

    def _key_lock(self, key: str) -> Lock:
        with self._lock:
            entry = self._key_locks.get(key)
            if entry:
                key_lock, users = entry
                self._key_locks[key] = (key_lock, users + 1)
                return key_lock
            key_lock = Lock()
            self._key_locks[key] = (key_lock, 1)
            return key_lock

    def _release_key_lock(self, key: str, key_lock: Lock):
        with self._lock:
            entry = self._key_locks.get(key)
            if not entry or entry[0] is not key_lock:
                return
            if entry[1] == 1:
                self._key_locks.pop(key, None)
            else:
                self._key_locks[key] = (key_lock, entry[1] - 1)

    def _record_render(self, elapsed_seconds: float, *, failed=False):
        with self._lock:
            self._metrics["failures" if failed else "completed"] += 1
            self._latency_samples.append(max(elapsed_seconds * 1000, 0))
            if len(self._latency_samples) > PDF_LATENCY_SAMPLE_LIMIT:
                del self._latency_samples[:-PDF_LATENCY_SAMPLE_LIMIT]

    def _prune_artifacts_locked(self, *, force=False):
        now_monotonic = time.monotonic()
        if not force and now_monotonic - self._last_prune_at < PDF_CACHE_PRUNE_INTERVAL_SECONDS:
            return
        self._last_prune_at = now_monotonic
        artifacts = self.root / "artifacts"
        if not artifacts.exists():
            return
        now = time.time()
        files = []
        for path in artifacts.glob("*.pdf"):
            try:
                stat = path.stat()
            except OSError:
                continue
            if self.artifact_ttl_seconds and now - stat.st_mtime > self.artifact_ttl_seconds:
                path.unlink(missing_ok=True)
                self._metrics["evictions"] += 1
                continue
            files.append((stat.st_mtime, stat.st_size, path))
        total_bytes = sum(size for _, size, _ in files)
        if not self.max_bytes or total_bytes <= self.max_bytes:
            return
        for _, size, path in sorted(files):
            path.unlink(missing_ok=True)
            total_bytes -= size
            self._metrics["evictions"] += 1
            if total_bytes <= self.max_bytes:
                break

    def _artifact_stats(self):
        entries = 0
        size_bytes = 0
        for path in (self.root / "artifacts").glob("*.pdf"):
            try:
                size_bytes += path.stat().st_size
                entries += 1
            except OSError:
                continue
        return {"entries": entries, "sizeBytes": size_bytes}


def _latency_summary(samples):
    if not samples:
        return {
            "sampleCount": 0,
            "averageMs": None,
            "p50Ms": None,
            "p95Ms": None,
            "maxMs": None,
        }
    ordered = sorted(samples)
    return {
        "sampleCount": len(ordered),
        "averageMs": round(sum(ordered) / len(ordered), 1),
        "p50Ms": round(ordered[(len(ordered) - 1) // 2], 1),
        "p95Ms": round(ordered[max((len(ordered) * 95 + 99) // 100 - 1, 0)], 1),
        "maxMs": round(ordered[-1], 1),
    }


pdf_export_cache = PdfExportCache()
