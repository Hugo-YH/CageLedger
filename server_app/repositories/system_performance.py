"""SQLite persistence for low-frequency service performance snapshots."""

from __future__ import annotations

import json
from datetime import UTC, datetime, timedelta


def insert_snapshot(conn, snapshot):
    conn.execute(
        """
        INSERT INTO system_performance_snapshots
            (id, observed_at, interval_seconds, process_started_at, app_version, revision, payload)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        """,
        (
            snapshot["id"],
            snapshot["observedAt"],
            snapshot["intervalSeconds"],
            snapshot["processStartedAt"],
            snapshot["appVersion"],
            snapshot["revision"],
            json.dumps(snapshot, ensure_ascii=False, separators=(",", ":")),
        ),
    )


def delete_expired_snapshots(conn, retention_days):
    cutoff = (datetime.now(UTC) - timedelta(days=retention_days)).isoformat(timespec="seconds")
    conn.execute("DELETE FROM system_performance_snapshots WHERE observed_at < ?", (cutoff,))


def list_snapshots(conn, *, since, limit):
    rows = conn.execute(
        """
        SELECT payload FROM system_performance_snapshots
        WHERE observed_at >= ?
        ORDER BY observed_at ASC
        LIMIT ?
        """,
        (since, limit),
    ).fetchall()
    return [json.loads(row["payload"]) for row in rows]
