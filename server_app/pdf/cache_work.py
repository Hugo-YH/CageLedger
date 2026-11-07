"""Queued artifact work; callers hold the owning PDF cache lock."""

import time
from collections.abc import Callable
from dataclasses import dataclass, field
from pathlib import Path


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
    priority: int = 0


@dataclass(order=True)
class ScheduledTask:
    priority: int
    sequence: int
    callback: Callable[[], None] = field(compare=False)


@dataclass
class ArtifactWork:
    key: str
    version: tuple[int, int]
    render: Callable[[], bytes]
    scope: str | None


class PendingArtifacts:
    def __init__(self):
        self.requests = {}
        self.scopes = {}

    def coalesce(self, jobs, owner_id, work, filename, content_type):
        job = jobs.get(self.scopes.get(work.scope)) if work.scope else None
        # A user who joined a warm job owns its original request and result.
        if job is None or job.status != "queued" or job.owner_ids != {owner_id}:
            return None
        old_key = job.key
        job.key, job.filename, job.content_type = work.key, filename, content_type
        job.updated_at = time.time()
        self.requests[job.id] = work
        return job, old_key

    def add(self, job, work):
        self.requests[job.id] = work
        if work.scope:
            self.scopes[work.scope] = job.id

    def start(self, job_id):
        work = self.requests.pop(job_id)
        if work.scope and self.scopes.get(work.scope) == job_id:
            self.scopes.pop(work.scope)
        return work
