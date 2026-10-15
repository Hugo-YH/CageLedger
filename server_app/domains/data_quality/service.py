"""Transactional upgrade checks and explicit offline evidence archiving."""

import re
from contextlib import contextmanager

from server_app.domains.administration.audit import audit_event, write_audit_events
from server_app.persistence.data_quality import ensure_schema
from server_app.shared import now_iso

from . import detection, repository


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
        report = detection.detect(conn)
        report["sourceSha256"] = source_sha256
        return archive_report(conn, report, actor)


def archive_upgrade_issues(conn):
    """Run once per detector version, using this database's current transaction.

    The completed marker, evidence, and audit commit or roll back together.
    Later business edits do not turn restarts into an ongoing monitoring job.
    """
    with archive_write(conn):
        ensure_schema(conn)
        previous = repository.completed_upgrade_scan(conn, detection.DETECTOR_VERSION)
        if previous:
            return {**previous, "reused": True}
        snapshot = repository.source_snapshot(conn)
        report = {
            **detection.detect(conn),
            "sourceSha256": snapshot["sha256"],
            "trigger": "upgrade",
            "sourceSnapshot": {"format": snapshot["format"], "tables": snapshot["tables"]},
        }
        # Empty installations record completion without adding a business audit entry.
        has_business = any(count for table, count in snapshot["tables"].items() if table != "cage_slots")
        actor = {"id": "system:data-quality-upgrade", "username": "system", "displayName": "系统升级核查"}
        result = archive_report(conn, report, actor, audit=has_business)
        repository.complete_upgrade_scan(conn, result)
        return result


def archive_report(conn, report, actor, *, audit=True):
    scan_id = "dqscan-" + repository.digest(report)
    previous = repository.existing_scan(conn, scan_id)
    if previous:
        return {**previous, "reused": True}
    at = now_iso()
    report = {**report, "scanId": scan_id, "scannedAt": at, "actor": actor}
    repository.save_scan(conn, report)
    if audit:
        write_audit_events(
            conn,
            [
                audit_event(
                    actor,
                    "data_quality.issues_archived",
                    "data_quality_scan",
                    scan_id,
                    "数据核查已留档，业务记录未改写",
                    [],
                    at,
                    None,
                    {"scanId": scan_id, "sourceSha256": report["sourceSha256"], **report["summary"]},
                )
            ],
        )
    return {**report, "reused": False}
