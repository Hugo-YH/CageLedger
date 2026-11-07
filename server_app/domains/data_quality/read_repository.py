"""Read archived manifests and individual observations without running detectors."""

import hashlib
import json

from .archive_cache import REPORTS, Archive
from .repository import digest


class ArchiveIntegrityError(ValueError):
    pass


def scan_rows(conn, limit, offset):
    total = conn.execute("SELECT COUNT(*) FROM data_quality_scans").fetchone()[0]
    rows = conn.execute(
        "SELECT * FROM data_quality_scans ORDER BY scanned_at DESC,id DESC LIMIT ? OFFSET ?", (limit, offset)
    ).fetchall()
    return rows, total


def latest_scan(conn):
    row = conn.execute("SELECT * FROM data_quality_scans ORDER BY scanned_at DESC,id DESC LIMIT 1").fetchone()
    return manifest(row) if row else None


def scan(conn, identity):
    row = conn.execute("SELECT * FROM data_quality_scans WHERE id=?", (identity,)).fetchone()
    if not row:
        raise LookupError("核查留档不存在")
    return manifest(row)


def fingerprint(row):
    checksum = hashlib.sha256()
    for key in (
        "id",
        "detector_version",
        "source_sha256",
        "latest_business_at",
        "scanned_at",
        "finding_count",
        "payload",
    ):
        value = row[key]
        tag = type(value).__name__.encode()
        checksum.update(len(tag).to_bytes(4, "big"))
        checksum.update(tag)
        encoded = value if isinstance(value, bytes) else str(value).encode()
        checksum.update(len(encoded).to_bytes(8, "big"))
        checksum.update(encoded)
    return checksum.digest()


def manifest(row, *, remember=True):
    key = fingerprint(row)
    cached = REPORTS.get(key)
    if cached is not None:
        return cached
    try:
        value = json.loads(row["payload"])
        findings = value["findings"]
        if (
            value["scanId"] != row["id"]
            or value["scannedAt"] != row["scanned_at"]
            or value["detectorVersion"] != row["detector_version"]
            or value.get("sourceSha256", "") != row["source_sha256"]
            or value.get("latestBusinessAt", "") != row["latest_business_at"]
            or not isinstance(findings, list)
            or len(findings) != row["finding_count"]
            or len({item["id"] for item in findings}) != len(findings)
        ):
            raise ValueError("manifest mismatch")
        for item in findings:
            if item["reviewStatus"] not in ("needs_review", "retained_history") or any(
                not isinstance(item[key], str)
                for key in ("id", "code", "entityType", "entityId", "referenceId", "summary")
            ):
                raise ValueError("invalid finding")
        archive = Archive(value, key)
        # Conservative estimate includes parsed objects and bounded sort/filter
        # reference arrays. Large inputs remain readable without being cached.
        raw = row["payload"]
        size = len(raw if isinstance(raw, bytes) else raw.encode())
        return REPORTS.put(key, archive, size * 8) if remember else archive
    except (ValueError, TypeError, KeyError) as exc:
        raise ArchiveIntegrityError("核查留档清单校验失败，无法展示") from exc


def evidence(conn, scan_id, issue_id):
    row = conn.execute(
        "SELECT evidence_json,evidence_sha256 FROM data_quality_observations WHERE scan_id=? AND issue_id=?",
        (scan_id, issue_id),
    ).fetchone()
    if not row:
        raise ArchiveIntegrityError("问题留档证据缺失，无法展示")
    try:
        value = json.loads(row["evidence_json"])
        if digest(value) != row["evidence_sha256"]:
            raise ValueError("checksum mismatch")
    except (ValueError, TypeError) as exc:
        raise ArchiveIntegrityError("问题留档证据校验失败，无法展示") from exc
    return value, row["evidence_sha256"]
