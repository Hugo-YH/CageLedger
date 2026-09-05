"""Collect and expose durable, low-overhead service performance history."""

from __future__ import annotations

import logging
import sqlite3
import threading
from datetime import UTC, datetime, timedelta

from server_app.config import (
    CAGELEDGER_APP_VERSION,
    CAGELEDGER_REVISION,
    DB_PATH,
    PERFORMANCE_HISTORY_ENABLED,
    PERFORMANCE_HISTORY_INTERVAL_SECONDS,
    PERFORMANCE_HISTORY_RETENTION_DAYS,
)
from server_app.repositories.system_performance import delete_expired_snapshots, insert_snapshot, list_snapshots
from server_app.shared import new_id, now_iso
from server_app.shared.sqlite import ClosingConnection

_LOGGER = logging.getLogger(__name__)
_PROCESS_STARTED_AT = now_iso()
_SAMPLER_LOCK = threading.Lock()
_SAMPLER_STARTED = False
_PREVIOUS_PERFORMANCE = None
_SAMPLER_STOP_EVENT = threading.Event()


def start_performance_history_sampler(snapshot_factory):
    """Start one daemon sampler after the database is ready; never block HTTP requests."""
    global _SAMPLER_STARTED
    if not PERFORMANCE_HISTORY_ENABLED:
        return
    with _SAMPLER_LOCK:
        if _SAMPLER_STARTED:
            return
        _SAMPLER_STARTED = True
    _capture_safely(snapshot_factory)
    threading.Thread(
        target=_run_sampler,
        args=(snapshot_factory,),
        daemon=True,
        name="cageledger-performance-history",
    ).start()


def list_performance_history(hours):
    bounded_hours = min(max(int(hours), 1), 24 * PERFORMANCE_HISTORY_RETENTION_DAYS)
    since = (datetime.now(UTC) - timedelta(hours=bounded_hours)).isoformat(timespec="seconds")
    with _connect_history_db() as conn:
        snapshots = list_snapshots(conn, since=since, limit=10_000)
    return {
        "items": [_history_item(snapshot) for snapshot in snapshots],
        "intervalSeconds": PERFORMANCE_HISTORY_INTERVAL_SECONDS,
        "retentionDays": PERFORMANCE_HISTORY_RETENTION_DAYS,
    }


def _run_sampler(snapshot_factory):
    while not _SAMPLER_STOP_EVENT.wait(PERFORMANCE_HISTORY_INTERVAL_SECONDS):
        _capture_safely(snapshot_factory)


def _capture_safely(snapshot_factory):
    try:
        _capture(snapshot_factory())
    except Exception:  # noqa: BLE001 - monitoring must never affect the application.
        _LOGGER.exception("[performance-history] snapshot skipped")


def _capture(environment):
    global _PREVIOUS_PERFORMANCE
    performance = environment["performance"]
    snapshot = {
        "id": new_id("metric"),
        "observedAt": now_iso(),
        "intervalSeconds": PERFORMANCE_HISTORY_INTERVAL_SECONDS if _PREVIOUS_PERFORMANCE else 0,
        "processStartedAt": _PROCESS_STARTED_AT,
        "appVersion": CAGELEDGER_APP_VERSION,
        "revision": CAGELEDGER_REVISION,
        "metrics": {
            "requests": _counter_interval(performance["requests"], _PREVIOUS_PERFORMANCE, "requests", "total", "slow"),
            "database": _counter_interval(
                performance["database"], _PREVIOUS_PERFORMANCE, "database", "operations", "slowOperations", "lockErrors"
            ),
            "cache": _counter_interval(
                performance["cache"], _PREVIOUS_PERFORMANCE, "cache", "hits", "misses", "expirations", "evictions"
            ),
            "pdf": {"activeJobs": performance["pdf"]["jobs"]["active"]},
            "requestP95Ms": performance["requests"]["p95Ms"],
            "databaseP95Ms": performance["database"]["p95Ms"],
            "cacheHitRate": performance["cache"]["hitRate"],
            "databaseSizeBytes": environment["database"]["sizeBytes"],
        },
    }
    with _connect_history_db() as conn:
        insert_snapshot(conn, snapshot)
        delete_expired_snapshots(conn, PERFORMANCE_HISTORY_RETENTION_DAYS)
        conn.commit()
    _PREVIOUS_PERFORMANCE = performance


def _counter_interval(current, previous, section, *keys):
    previous_section = previous.get(section, {}) if previous else {}
    return {key: max(0, int(current[key]) - int(previous_section.get(key, 0))) for key in keys}


def _connect_history_db():
    conn = sqlite3.connect(DB_PATH, factory=ClosingConnection)
    try:
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA busy_timeout=100")
    except BaseException:
        conn.close()
        raise
    return conn


def _history_item(snapshot):
    metrics = snapshot["metrics"]
    return {
        "observedAt": snapshot["observedAt"],
        "intervalSeconds": snapshot["intervalSeconds"],
        "appVersion": snapshot["appVersion"],
        "processStartedAt": snapshot["processStartedAt"],
        "requestCount": metrics["requests"]["total"],
        "slowRequestCount": metrics["requests"]["slow"],
        "requestP95Ms": metrics["requestP95Ms"],
        "databaseOperationCount": metrics["database"]["operations"],
        "databaseLockErrorCount": metrics["database"]["lockErrors"],
        "databaseP95Ms": metrics["databaseP95Ms"],
        "cacheHitRate": metrics["cacheHitRate"],
        "pdfActiveJobs": metrics["pdf"]["activeJobs"],
        "databaseSizeBytes": metrics["databaseSizeBytes"],
    }
