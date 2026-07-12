"""Disk-backed PDF artifacts and background export jobs."""

from __future__ import annotations

import hashlib
import os
import time
import uuid
from collections.abc import Callable
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field
from pathlib import Path
from threading import Lock

from server_app.config import PDF_CACHE_PATH

PDF_JOB_TTL_SECONDS = 24 * 60 * 60


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


class PdfExportCache:
    """Serialize Chromium work while retaining finished artifacts on disk."""

    def __init__(self, root: Path = PDF_CACHE_PATH):
        self.root = root
        self._jobs: dict[str, PdfExportJob] = {}
        self._active_keys: dict[str, str] = {}
        self._versions: dict[str, int] = {}
        self._lock = Lock()
        self._executor = ThreadPoolExecutor(max_workers=1, thread_name_prefix="cageledger-pdf-export")

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
    ) -> PdfExportJob:
        cached = self.artifact_path(key)
        with self._lock:
            self._cleanup_jobs_locked()
            if cached.exists():
                return self._ready_job(owner_id, key, filename, content_type, cached)
            active_id = self._active_keys.get(key)
            if active_id and active_id in self._jobs:
                self._jobs[active_id].owner_ids.add(owner_id)
                return self._jobs[active_id]
            job = self._new_job(owner_id, key, filename, content_type, 1)
            version = self._versions.get(key, 0)
            self._active_keys[key] = job.id
            self._executor.submit(self._run_artifact, job.id, key, version, render)
            return job

    def enqueue_batch(
        self,
        *,
        owner_id: str,
        filename: str,
        total: int,
        render: Callable[[Callable[[int], None]], bytes],
    ) -> PdfExportJob:
        with self._lock:
            self._cleanup_jobs_locked()
            job = self._new_job(owner_id, f"batch:{uuid.uuid4().hex}", filename, "application/zip", total)
            self._executor.submit(self._run_batch, job.id, render)
            return job

    def render_cached(self, key: str, render: Callable[[], bytes]) -> bytes:
        path = self.artifact_path(key)
        if path.exists():
            return path.read_bytes()
        version = self._version_for(key)
        body = render()
        if self._version_for(key) == version:
            self._write(path, body)
        return body

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
        try:
            body = render()
            path = self.artifact_path(key)
            if self._version_for(key) == version:
                self._write(path, body)
                self._complete(job_id, path, 1)
            else:
                self._fail(job_id, "源数据已更新，正在刷新 PDF")
        except Exception as exc:
            self._fail(job_id, str(exc))
        finally:
            with self._lock:
                self._active_keys.pop(key, None)

    def _run_batch(self, job_id: str, render: Callable[[Callable[[int], None]], bytes]):
        self._set_status(job_id, "rendering")
        try:
            body = render(lambda completed: self._set_completed(job_id, completed))
            path = self.root / "jobs" / f"{job_id}.zip"
            self._write(path, body)
            job = self._jobs[job_id]
            self._complete(job_id, path, job.total)
        except Exception as exc:
            self._fail(job_id, str(exc))

    def _new_job(self, owner_id: str, key: str, filename: str, content_type: str, total: int) -> PdfExportJob:
        job = PdfExportJob(
            id=uuid.uuid4().hex,
            owner_id=owner_id,
            key=key,
            filename=filename,
            content_type=content_type,
            total=max(total, 1),
            updated_at=time.time(),
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
        temporary = path.with_suffix(f"{path.suffix}.tmp")
        temporary.write_bytes(body)
        os.replace(temporary, path)

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


pdf_export_cache = PdfExportCache()
