"""Read original records and retain review observations without business updates."""

import hashlib
import json
from datetime import UTC, datetime

from server_app.repositories.audit_storage import payloads_for_rows


def canonical_json(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"), allow_nan=False)


def digest(value):
    return hashlib.sha256(canonical_json(value).encode()).hexdigest()


def payload_rows(conn, table):
    if table not in ("intake_batches", "placement_tasks", "occupancies"):
        raise ValueError("不支持的数据核查表")
    return {
        identity: {"payloadText": raw, "value": json.loads(raw)}
        for identity, raw in conn.execute(f"SELECT id,payload FROM {table} ORDER BY id")
    }


def slot_ids(conn):
    return {row[0] for row in conn.execute("SELECT id FROM cage_slots")}


def historical_receipts(conn, batch_id, receipt_id):
    rows = conn.execute(
        "SELECT id,payload FROM audit_events WHERE entity_type='intake_batch' AND entity_id=? ORDER BY rowid",
        (batch_id,),
    ).fetchall()
    matches = []
    for row, raw in zip(rows, payloads_for_rows(conn, rows), strict=True):
        event = json.loads(raw)
        for phase in ("before", "after"):
            batch = event.get(phase)
            if not isinstance(batch, dict):
                continue
            for receipt in batch.get("receipts") or []:
                if receipt.get("id") == receipt_id:
                    matches.append({"auditEventId": row[0], "at": event.get("at"), "phase": phase, "receipt": receipt})
    return matches


def orphan_obligations(conn):
    return [
        {"id": row[0], "workflowId": row[1], "payloadText": row[2], "confirmedAllocations": row[3]}
        for row in conn.execute(
            """
            SELECT o.id,o.workflow_id,o.payload,
                   (SELECT COUNT(*) FROM reimbursement_allocations a
                    WHERE a.obligation_id=o.id AND a.status='confirmed')
            FROM reimbursement_settlement_obligations o
            LEFT JOIN billing_workflows w ON w.id=o.workflow_id
            WHERE w.id IS NULL ORDER BY o.id
            """
        )
    ]


def latest_business_at(conn):
    # Planned receipt/service dates and review timestamps are not evidence of actual writes.
    values = [
        row[0]
        for row in conn.execute(
            "SELECT MAX(at) FROM audit_events WHERE action<>'data_quality.issues_archived' "
            "UNION ALL SELECT MAX(updated_at) FROM intake_batches "
            "UNION ALL SELECT MAX(updated_at) FROM quantity_sheets "
            "UNION ALL SELECT MAX(updated_at) FROM occupancies "
            "UNION ALL SELECT MAX(updated_at) FROM placement_tasks "
            "UNION ALL SELECT MAX(latest_event_at) FROM billing_workflows "
            "UNION ALL SELECT MAX(updated_at) FROM reimbursement_records"
        )
        if row[0]
    ]

    def instant(value):
        parsed = datetime.fromisoformat(value)
        return parsed if parsed.tzinfo else parsed.replace(tzinfo=UTC)

    return max(values, key=instant, default="")


def existing_scan(conn, scan_id):
    row = conn.execute("SELECT payload FROM data_quality_scans WHERE id=?", (scan_id,)).fetchone()
    if not row:
        return None
    report = json.loads(row[0])
    observations = {
        identity: (json.loads(raw), checksum)
        for identity, raw, checksum in conn.execute(
            "SELECT issue_id,evidence_json,evidence_sha256 FROM data_quality_observations WHERE scan_id=?", (scan_id,)
        )
    }
    if set(observations) != {item["id"] for item in report["findings"]}:
        raise ValueError("问题留档证据条目不完整")
    for item in report["findings"]:
        evidence, checksum = observations[item["id"]]
        if digest(evidence) != checksum:
            raise ValueError("问题留档证据校验失败")
        item["evidence"] = evidence
    return report


def save_scan(conn, report):
    manifest = {
        **report,
        "findings": [{k: v for k, v in item.items() if k != "evidence"} for item in report["findings"]],
    }
    conn.execute(
        "INSERT INTO data_quality_scans VALUES (?,?,?,?,?,?,?)",
        (
            report["scanId"],
            report["detectorVersion"],
            report["sourceSha256"],
            report["latestBusinessAt"],
            report["scannedAt"],
            len(report["findings"]),
            canonical_json(manifest),
        ),
    )
    for item in report["findings"]:
        conn.execute(
            """
            INSERT INTO data_quality_issues VALUES (?,?,?,?,?,?,?,?,?,?,?)
            ON CONFLICT(id) DO UPDATE SET last_scan_id=excluded.last_scan_id,last_seen_at=excluded.last_seen_at,
                summary=excluded.summary,
                review_status=CASE WHEN excluded.review_status='needs_review' THEN 'needs_review'
                                   ELSE data_quality_issues.review_status END
            """,
            (
                item["id"],
                item["code"],
                item["entityType"],
                item["entityId"],
                item["referenceId"],
                item["summary"],
                item["reviewStatus"],
                report["scanId"],
                report["scanId"],
                report["scannedAt"],
                report["scannedAt"],
            ),
        )
        conn.execute(
            "INSERT INTO data_quality_observations VALUES (?,?,?,?)",
            (report["scanId"], item["id"], digest(item["evidence"]), canonical_json(item["evidence"])),
        )
