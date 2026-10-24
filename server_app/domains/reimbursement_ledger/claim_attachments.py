"""Claim evidence upload and authorized download."""

import hashlib

from server_app.config import REIMBURSEMENT_ATTACHMENTS_PATH
from server_app.domains.administration import audit_event, merge_audit_logs, write_audit_events
from server_app.runtime_logging import log_operation
from server_app.shared import clean_text, new_id, now_iso

from .claim_rules import _detect_attachment_type, _dump, _require_claim_edit, _require_claim_view
from .repository import attachment_payload as _attachment_payload
from .repository import claim_row as _claim_row
from .repository import refresh_claim_balances as _refresh_claim_balances


@log_operation("reimbursement_upload", component="files")
def add_attachment(conn, actor, claim_id, filename, body, content_type):
    claim = _claim_row(conn, claim_id)
    _require_claim_edit(actor, claim)
    if len(body) > MAX_ATTACHMENT_BYTES:
        raise ValueError("单个报销单附件不能超过 30 MiB")
    count = conn.execute(
        "SELECT COUNT(*) FROM reimbursement_claim_attachments WHERE claim_id = ?", (claim_id,)
    ).fetchone()[0]
    if count >= MAX_ATTACHMENTS_PER_CLAIM:
        raise ValueError("每张报销单最多上传 10 个附件")
    mime_type = _detect_attachment_type(body, content_type, filename)
    if mime_type not in ALLOWED_ATTACHMENT_TYPES:
        raise ValueError("仅支持 PDF、JPEG 或 PNG 附件")
    digest = hashlib.sha256(body).hexdigest()
    duplicate = conn.execute(
        "SELECT id FROM reimbursement_claim_attachments WHERE claim_id = ? AND sha256 = ?", (claim_id, digest)
    ).fetchone()
    if duplicate:
        raise ValueError("该报销单已上传相同附件")
    attachment_id = new_id("reimbursement-attachment")
    suffix = {"application/pdf": ".pdf", "image/jpeg": ".jpg", "image/png": ".png"}[mime_type]
    stored_name = f"{attachment_id}{suffix}"
    target = REIMBURSEMENT_ATTACHMENTS_PATH / claim_id / stored_name
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_bytes(body)
    now = now_iso()
    item = {
        "id": attachment_id,
        "claimId": claim_id,
        "originalName": clean_text(filename) or stored_name,
        "storedName": stored_name,
        "mimeType": mime_type,
        "sizeBytes": len(body),
        "sha256": digest,
        "ocrStatus": "disabled",
        "ocrResult": "",
        "ocrProvider": "",
        "ocrModelVersion": "",
        "ocrRequestedAt": "",
        "ocrCompletedAt": "",
        "ocrError": "",
        "createdBy": actor["id"],
        "createdAt": now,
    }
    conn.execute(
        """INSERT INTO reimbursement_claim_attachments
           (id, claim_id, original_name, stored_name, mime_type, size_bytes, sha256, ocr_status, ocr_result, ocr_provider,
            ocr_model_version, ocr_requested_at, ocr_completed_at, ocr_error, created_by, created_at, payload)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
        (
            item["id"],
            item["claimId"],
            item["originalName"],
            item["storedName"],
            item["mimeType"],
            item["sizeBytes"],
            item["sha256"],
            item["ocrStatus"],
            item["ocrResult"],
            item["ocrProvider"],
            item["ocrModelVersion"],
            None,
            None,
            item["ocrError"],
            item["createdBy"],
            item["createdAt"],
            _dump(item),
        ),
    )
    _refresh_claim_balances(conn, claim_id)
    event = audit_event(
        actor,
        "reimbursement_ledger.attachment_added",
        "reimbursement_claim_attachment",
        attachment_id,
        f"{actor['displayName']} 上传报销单附件 {item['originalName']}",
        [],
        now,
        None,
        item,
    )
    write_audit_events(conn, [event])
    conn.commit()
    return {"item": item, "auditLogs": merge_audit_logs([], [event])}


def get_attachment(conn, actor, attachment_id):
    row = conn.execute("SELECT * FROM reimbursement_claim_attachments WHERE id = ?", (attachment_id,)).fetchone()
    if not row:
        raise LookupError("报销单附件不存在")
    item = _attachment_payload(row)
    _require_claim_view(actor, _claim_row(conn, item["claimId"]))
    target = REIMBURSEMENT_ATTACHMENTS_PATH / item["claimId"] / item["storedName"]
    if not target.is_file():
        raise LookupError("报销单附件文件不存在")
    return item, target.read_bytes()


MAX_ATTACHMENT_BYTES = 30 * 1024 * 1024


MAX_ATTACHMENTS_PER_CLAIM = 10


ALLOWED_ATTACHMENT_TYPES = {"application/pdf", "image/jpeg", "image/png"}
