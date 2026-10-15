"""Explicit offline archiving with one atomic, attributable audit event per scan."""

import re
from contextlib import contextmanager

from server_app.domains.administration.audit import audit_event, write_audit_events
from server_app.persistence.data_quality import ensure_schema
from server_app.shared import now_iso

from . import repository
from .detection import detect


@contextmanager
def archive_write(conn):
    if not conn.in_transaction:
        conn.execute("BEGIN IMMEDIATE")
    conn.execute("SAVEPOINT data_quality_archive")
    try:
        yield
    except BaseException:
        conn.execute("ROLLBACK TO data_quality_archive")
        conn.execute("RELEASE data_quality_archive")
        raise
    else:
        conn.execute("RELEASE data_quality_archive")


def archive_issues(conn, *, source_sha256, actor):
    if not re.fullmatch(r"[a-f0-9]{64}", source_sha256):
        raise ValueError("必须记录来源数据库的SHA-256")
    if not all(actor.get(key) for key in ("id", "username", "displayName")):
        raise ValueError("必须记录核查操作者")
    with archive_write(conn):
        ensure_schema(conn)
        report = detect(conn)
        report["sourceSha256"] = source_sha256
        scan_id = "dqscan-" + repository.digest(report)
        previous = repository.existing_scan(conn, scan_id)
        if previous:
            return {**previous, "reused": True}
        at = now_iso()
        report.update({"scanId": scan_id, "scannedAt": at, "actor": actor})
        repository.save_scan(conn, report)
        write_audit_events(
            conn,
            [
                audit_event(
                    actor,
                    "data_quality.issues_archived",
                    "data_quality_scan",
                    scan_id,
                    "历史数据问题已标记并留档，业务记录未改写",
                    [],
                    at,
                    None,
                    {"scanId": scan_id, "sourceSha256": source_sha256, **report["summary"]},
                )
            ],
        )
        return {**report, "reused": False}
