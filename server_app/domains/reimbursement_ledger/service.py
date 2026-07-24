import hashlib
import json
import mimetypes

from server_app.config import REIMBURSEMENT_ATTACHMENTS_PATH
from server_app.domains.administration import audit_event, merge_audit_logs, write_audit_events
from server_app.shared import clean_text, new_id, now_iso

from .repository import (
    allocation_payload as _allocation_payload,
)
from .repository import (
    allocation_row as _allocation_row,
)
from .repository import (
    attachment_payload as _attachment_payload,
)
from .repository import (
    claim_has_confirmed_allocations as _claim_has_confirmed_allocations,
)
from .repository import (
    claim_payload as _claim_payload,
)
from .repository import (
    claim_row as _claim_row,
)
from .repository import (
    confirmed_amount_for_line as _confirmed_amount_for_line,
)
from .repository import (
    confirmed_amount_for_obligation as _confirmed_amount_for_obligation,
)
from .repository import (
    funding_line_row as _funding_line_row,
)
from .repository import (
    obligation_payload as _obligation_payload,
)
from .repository import (
    obligation_row as _obligation_row,
)
from .repository import (
    refresh_claim_balances as _refresh_claim_balances,
)
from .repository import (
    refresh_line_balance as _refresh_line_balance,
)
from .repository import (
    refresh_obligation_balance as _refresh_obligation_balance,
)
from .repository import (
    upsert_allocation as _upsert_allocation,
)
from .repository import (
    upsert_claim as _upsert_claim,
)
from .repository import (
    upsert_funding_line as _upsert_funding_line,
)
from .repository import (
    upsert_obligation as _upsert_obligation,
)

MAX_ATTACHMENT_BYTES = 30 * 1024 * 1024
MAX_ATTACHMENTS_PER_CLAIM = 10
ALLOWED_ATTACHMENT_TYPES = {"application/pdf", "image/jpeg", "image/png"}
CLAIM_STATUSES = {"pending_submission", "reimbursing", "completed", "void"}
ALLOCATION_STATUSES = {"draft", "confirmed", "reversed"}


def list_obligations(conn, actor, filters):
    _require_authenticated(actor)
    sync_settlement_obligations(conn)
    clauses, params = _obligation_filters(filters)
    where = f" WHERE {' AND '.join(clauses)}" if clauses else ""
    total = conn.execute(f"SELECT COUNT(*) FROM reimbursement_settlement_obligations{where}", params).fetchone()[0]
    rows = conn.execute(
        f"""SELECT * FROM reimbursement_settlement_obligations{where}
            ORDER BY month DESC, source_pi COLLATE NOCASE, iacuc, updated_at DESC LIMIT ? OFFSET ?""",
        (*params, _limit(filters), _offset(filters)),
    ).fetchall()
    return {"items": [_obligation_payload(conn, row) for row in rows], "page": _page(filters, total)}


def get_obligation(conn, actor, obligation_id):
    _require_authenticated(actor)
    sync_settlement_obligations(conn)
    row = conn.execute("SELECT * FROM reimbursement_settlement_obligations WHERE id = ?", (obligation_id,)).fetchone()
    if not row:
        raise LookupError("结算应收不存在")
    return {"item": _obligation_payload(conn, row)}


def list_claims(conn, actor, filters):
    _require_authenticated(actor)
    clauses, params = [], []
    status = clean_text(filters.get("status", ""))
    owner = clean_text(filters.get("fundingOwner", ""))
    keyword = clean_text(filters.get("keyword", ""))
    if status and status != "all":
        clauses.append("status = ?")
        params.append(status)
    if owner:
        clauses.append("funding_owner LIKE ?")
        params.append(f"%{owner}%")
    if keyword:
        clauses.append("(document_number LIKE ? OR funding_owner LIKE ?)")
        params.extend([f"%{keyword}%", f"%{keyword}%"])
    if actor.get("role") != "admin":
        clauses.append("created_by = ?")
        params.append(actor["id"])
    where = f" WHERE {' AND '.join(clauses)}" if clauses else ""
    total = conn.execute(f"SELECT COUNT(*) FROM reimbursement_claims{where}", params).fetchone()[0]
    rows = conn.execute(
        f"SELECT * FROM reimbursement_claims{where} ORDER BY updated_at DESC, rowid DESC LIMIT ? OFFSET ?",
        (*params, _limit(filters), _offset(filters)),
    ).fetchall()
    return {"items": [_claim_payload(conn, row, include_detail=False) for row in rows], "page": _page(filters, total)}


def get_claim(conn, actor, claim_id):
    claim = _claim_row(conn, claim_id)
    _require_claim_view(actor, claim)
    return {"item": _claim_payload(conn, claim, include_detail=True)}


def save_claim(conn, actor, claim_id, payload):
    _require_authenticated(actor)
    existing = _claim_row(conn, claim_id) if claim_id else None
    if existing:
        _require_claim_edit(actor, existing)
    document_number = clean_text(payload.get("documentNumber", existing["document_number"] if existing else ""))
    if not document_number:
        raise ValueError("请填写报销单号")
    status = clean_text(payload.get("status", existing["status"] if existing else "pending_submission"))
    if status not in CLAIM_STATUSES:
        raise ValueError("报销单状态无效")
    if status == "void" and actor.get("role") != "admin":
        raise PermissionError("需要管理员权限才能作废报销单")
    line_input = payload.get("fundingLines", [])
    if not isinstance(line_input, list) or not line_input:
        raise ValueError("请至少添加一条经费明细")
    normalized_lines = [_normalize_funding_line(item, index) for index, item in enumerate(line_input, start=1)]
    owners = {item["fundingOwner"] for item in normalized_lines}
    if len(owners) != 1:
        raise ValueError("同一张报销单的经费明细必须使用同一位经费负责人")
    if existing and _claim_has_confirmed_allocations(conn, claim_id):
        existing_ids = {
            row["id"]
            for row in conn.execute("SELECT id FROM reimbursement_claim_funding_lines WHERE claim_id = ?", (claim_id,))
        }
        submitted_ids = {item["id"] for item in normalized_lines if item["id"]}
        if existing_ids != submitted_ids:
            raise ValueError("存在已确认核销时，请保留原经费明细行")
        for line in normalized_lines:
            if line["id"] and _confirmed_amount_for_line(conn, line["id"]) > line["reimbursementAmount"] + 0.00001:
                raise ValueError("报销金额不能低于已确认核销金额")
    now = now_iso()
    claim = {
        "id": claim_id or new_id("reimbursement-claim"),
        "documentNumber": document_number,
        "fundingOwner": next(iter(owners)),
        "status": status,
        "createdBy": existing["created_by"] if existing else actor["id"],
        "createdByName": existing["created_by_name"] if existing else actor["displayName"],
        "createdAt": existing["created_at"] if existing else now,
        "updatedAt": now,
    }
    _upsert_claim(conn, claim)
    for line in normalized_lines:
        line["id"] = line["id"] or new_id("reimbursement-fund")
        line["claimId"] = claim["id"]
        line["createdAt"] = line.get("createdAt") or now
        line["updatedAt"] = now
        _upsert_funding_line(conn, line)
    submitted_ids = {line["id"] for line in normalized_lines}
    if not _claim_has_confirmed_allocations(conn, claim["id"]):
        placeholders = ",".join("?" for _ in submitted_ids) or "''"
        conn.execute(
            f"DELETE FROM reimbursement_claim_funding_lines WHERE claim_id = ? AND id NOT IN ({placeholders})",
            (claim["id"], *submitted_ids),
        )
    _refresh_claim_balances(conn, claim["id"])
    refreshed = _claim_row(conn, claim["id"])
    event = audit_event(
        actor,
        "reimbursement_ledger.claim_created" if not existing else "reimbursement_ledger.claim_updated",
        "reimbursement_claim",
        claim["id"],
        f"{actor['displayName']} {'新建' if not existing else '更新'}报销单 {document_number}",
        [],
        now,
        _claim_payload(conn, existing, True) if existing else None,
        _claim_payload(conn, refreshed, True),
    )
    write_audit_events(conn, [event])
    conn.commit()
    return {"item": _claim_payload(conn, refreshed, True), "auditLogs": merge_audit_logs([], [event])}


def create_allocation(conn, actor, payload):
    _require_authenticated(actor)
    line = _funding_line_row(conn, clean_text(payload.get("fundingLineId", "")))
    claim = _claim_row(conn, line["claim_id"])
    if clean_text(payload.get("claimId", "")) != claim["id"]:
        raise ValueError("核销经费明细与报销单不匹配")
    _require_claim_edit(actor, claim)
    obligation = _obligation_row(conn, clean_text(payload.get("obligationId", "")))
    amount = _money(payload.get("amount"))
    if amount <= 0:
        raise ValueError("核销金额应大于 0")
    record = {
        "id": new_id("reimbursement-allocation"),
        "fundingLineId": line["id"],
        "obligationId": obligation["id"],
        "amount": amount,
        "status": "draft",
        "createdBy": actor["id"],
        "createdByName": actor["displayName"],
        "createdAt": now_iso(),
        "updatedAt": now_iso(),
    }
    _upsert_allocation(conn, record)
    event = audit_event(
        actor,
        "reimbursement_ledger.allocation_drafted",
        "reimbursement_allocation",
        record["id"],
        f"{actor['displayName']} 创建核销草稿",
        [],
        record["createdAt"],
        None,
        record,
    )
    write_audit_events(conn, [event])
    conn.commit()
    return {
        "item": _allocation_payload(conn, _allocation_row(conn, record["id"])),
        "auditLogs": merge_audit_logs([], [event]),
    }


def confirm_allocation(conn, actor, allocation_id):
    _require_admin(actor)
    allocation = _allocation_row(conn, allocation_id)
    before = _allocation_payload(conn, allocation)
    if allocation["status"] != "draft":
        raise ValueError("只有核销草稿可以确认")
    line = _funding_line_row(conn, allocation["funding_line_id"])
    obligation = _obligation_row(conn, allocation["obligation_id"])
    if _confirmed_amount_for_line(conn, line["id"]) + allocation["amount"] > line["reimbursement_amount"] + 0.00001:
        raise ValueError("本次核销超过经费明细可分摊余额")
    if (
        _confirmed_amount_for_obligation(conn, obligation["id"]) + allocation["amount"]
        > obligation["payable_amount"] + 0.00001
    ):
        raise ValueError("本次核销超过结算应收待核销金额")
    now = now_iso()
    conn.execute(
        "UPDATE reimbursement_allocations SET status = 'confirmed', confirmed_by = ?, confirmed_at = ?, updated_at = ? WHERE id = ?",
        (actor["id"], now, now, allocation_id),
    )
    _refresh_line_balance(conn, line["id"])
    _refresh_obligation_balance(conn, obligation["id"])
    _refresh_claim_balances(conn, line["claim_id"])
    event = audit_event(
        actor,
        "reimbursement_ledger.allocation_confirmed",
        "reimbursement_allocation",
        allocation_id,
        f"{actor['displayName']} 确认核销 {allocation['amount']:.2f} 元",
        [],
        now,
        before,
        _allocation_payload(conn, _allocation_row(conn, allocation_id)),
    )
    write_audit_events(conn, [event])
    conn.commit()
    return {
        "item": _allocation_payload(conn, _allocation_row(conn, allocation_id)),
        "auditLogs": merge_audit_logs([], [event]),
    }


def reverse_allocation(conn, actor, allocation_id, reason):
    _require_admin(actor)
    allocation = _allocation_row(conn, allocation_id)
    before = _allocation_payload(conn, allocation)
    if allocation["status"] != "confirmed":
        raise ValueError("只有已确认核销可以撤销")
    note = clean_text(reason)
    if not note:
        raise ValueError("请填写撤销原因")
    now = now_iso()
    conn.execute(
        """UPDATE reimbursement_allocations
           SET status = 'reversed', reversed_by = ?, reversed_at = ?, reversal_reason = ?, updated_at = ? WHERE id = ?""",
        (actor["id"], now, note, now, allocation_id),
    )
    line = _funding_line_row(conn, allocation["funding_line_id"])
    _refresh_line_balance(conn, line["id"])
    _refresh_obligation_balance(conn, allocation["obligation_id"])
    _refresh_claim_balances(conn, line["claim_id"])
    event = audit_event(
        actor,
        "reimbursement_ledger.allocation_reversed",
        "reimbursement_allocation",
        allocation_id,
        f"{actor['displayName']} 撤销核销：{note}",
        [],
        now,
        before,
        _allocation_payload(conn, _allocation_row(conn, allocation_id)),
    )
    write_audit_events(conn, [event])
    conn.commit()
    return {
        "item": _allocation_payload(conn, _allocation_row(conn, allocation_id)),
        "auditLogs": merge_audit_logs([], [event]),
    }


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


def list_legacy_records(conn, actor, filters):
    _require_authenticated(actor)
    limit, offset = _limit(filters), _offset(filters)
    rows = conn.execute(
        "SELECT payload FROM reimbursement_records ORDER BY month DESC, latest_event_at DESC, rowid DESC LIMIT ? OFFSET ?",
        (limit, offset),
    ).fetchall()
    total = conn.execute("SELECT COUNT(*) FROM reimbursement_records").fetchone()[0]
    items = []
    for row in rows:
        item = json.loads(row["payload"])
        item["migrationEligible"] = bool(item.get("reimbursementFormNo") and item.get("fundBookNo"))
        items.append(item)
    return {"items": items, "page": _page(filters, total)}


def migrate_legacy_record(conn, actor, record_id):
    _require_admin(actor)
    row = conn.execute("SELECT payload FROM reimbursement_records WHERE id = ?", (record_id,)).fetchone()
    if not row:
        raise LookupError("历史台账不存在")
    legacy = json.loads(row["payload"])
    number, fund_book = clean_text(legacy.get("reimbursementFormNo", "")), clean_text(legacy.get("fundBookNo", ""))
    if not number or not fund_book:
        raise ValueError("历史记录缺少报销单号或经费本号，需保留待核对")
    obligation = conn.execute(
        """SELECT * FROM reimbursement_settlement_obligations
           WHERE month = ? AND source_pi = ? ORDER BY obligation_kind, updated_at DESC LIMIT 1""",
        (legacy.get("month", ""), legacy.get("pi", "")),
    ).fetchone()
    if not obligation:
        raise ValueError("未找到可迁入的结算应收，需保留待核对")
    amount = _money(legacy.get("paidAmount", 0))
    claim_response = save_claim(
        conn,
        actor,
        None,
        {
            "documentNumber": number,
            "status": legacy.get("reimbursementStatus", "pending_submission"),
            "fundingLines": [
                {
                    "fundBookNo": fund_book,
                    "fundingOwner": legacy.get("pi", ""),
                    "reimbursementAmount": max(amount, _money(legacy.get("payableAmount", 0))),
                }
            ],
        },
    )
    claim = claim_response["item"]
    if amount > 0:
        allocation = create_allocation(
            conn,
            actor,
            {"fundingLineId": claim["fundingLines"][0]["id"], "obligationId": obligation["id"], "amount": amount},
        )
        confirm_allocation(conn, actor, allocation["item"]["id"])
    return get_claim(conn, actor, claim["id"])


def sync_settlement_obligations(conn):
    rows = conn.execute(
        """SELECT workflows.id AS workflow_id, workflows.month, workflows.iacuc, workflows.current_version_id,
                  workflows.current_version_no, versions.payload
           FROM billing_workflows AS workflows
           JOIN billing_statement_versions AS versions ON versions.id = workflows.current_version_id
           WHERE workflows.current_version_id <> '' AND versions.version_status <> 'voided'"""
    ).fetchall()
    changed = False
    for row in rows:
        version = json.loads(row["payload"])
        statement = dict(version.get("statement") or {})
        payable = _money(statement.get("totalAmount", 0))
        source_pi = clean_text(statement.get("pi", ""))
        statement_iacucs = [clean_text(value) for value in statement.get("iacucs", []) if clean_text(value)]
        statement_iacuc = "、".join(dict.fromkeys(statement_iacucs)) or clean_text(statement.get("iacuc", row["iacuc"]))
        if not source_pi:
            continue
        existing = conn.execute(
            """SELECT * FROM reimbursement_settlement_obligations
               WHERE workflow_id = ? ORDER BY created_at LIMIT 1""",
            (row["workflow_id"],),
        ).fetchone()
        now = now_iso()
        if not existing:
            _upsert_obligation(
                conn,
                {
                    "id": new_id("settlement-obligation"),
                    "workflowId": row["workflow_id"],
                    "statementVersionId": row["current_version_id"],
                    "statementVersionNo": row["current_version_no"],
                    "month": row["month"],
                    "sourcePi": source_pi,
                    "iacuc": statement_iacuc,
                    "payableAmount": payable,
                    "obligationKind": "statement",
                    "status": "open",
                    "createdAt": now,
                    "updatedAt": now,
                },
            )
            changed = True
            continue
        confirmed = _confirmed_amount_for_obligation(conn, existing["id"])
        if existing["statement_version_id"] == row["current_version_id"]:
            if existing["iacuc"].startswith("pi::") and statement_iacuc:
                payload = _obligation_payload(conn, existing)
                payload.update({"iacuc": statement_iacuc, "updatedAt": now})
                _upsert_obligation(conn, payload)
                changed = True
            continue
        if confirmed <= 0.00001:
            payload = _obligation_payload(conn, existing)
            payload.update(
                {
                    "statementVersionId": row["current_version_id"],
                    "statementVersionNo": row["current_version_no"],
                    "payableAmount": payable,
                    "updatedAt": now,
                }
            )
            _upsert_obligation(conn, payload)
            _refresh_obligation_balance(conn, existing["id"])
            changed = True
            continue
        delta = round(payable - float(existing["payable_amount"]), 2)
        if abs(delta) <= 0.00001:
            continue
        adjustment = conn.execute(
            """SELECT id FROM reimbursement_settlement_obligations
               WHERE workflow_id = ? AND statement_version_id = ? AND obligation_kind = 'adjustment'""",
            (row["workflow_id"], row["current_version_id"]),
        ).fetchone()
        if adjustment:
            continue
        _upsert_obligation(
            conn,
            {
                "id": new_id("settlement-adjustment"),
                "workflowId": row["workflow_id"],
                "statementVersionId": row["current_version_id"],
                "statementVersionNo": row["current_version_no"],
                "month": row["month"],
                "sourcePi": source_pi,
                "iacuc": statement_iacuc,
                "payableAmount": delta,
                "obligationKind": "adjustment",
                "status": "open",
                "createdAt": now,
                "updatedAt": now,
            },
        )
        changed = True
    if changed:
        conn.commit()


def _obligation_filters(filters):
    clauses, params = [], []
    for field, column in (("month", "month"), ("iacuc", "iacuc")):
        value = clean_text(filters.get(field, ""))
        if value:
            clauses.append(f"{column} = ?")
            params.append(value)
    pi = clean_text(filters.get("sourcePi", ""))
    if pi:
        clauses.append("source_pi LIKE ?")
        params.append(f"%{pi}%")
    status = clean_text(filters.get("status", ""))
    if status and status != "all":
        clauses.append("status = ?")
        params.append(status)
    return clauses, params


def _normalize_funding_line(value, index):
    if not isinstance(value, dict):
        raise ValueError("经费明细格式无效")
    fund_book = clean_text(value.get("fundBookNo", ""))
    owner = clean_text(value.get("fundingOwner", ""))
    amount = _money(value.get("reimbursementAmount", 0))
    if not fund_book or not owner:
        raise ValueError("经费明细需填写经费本号和经费负责人")
    if amount < 0:
        raise ValueError("报销金额不能小于 0")
    return {
        "id": clean_text(value.get("id", "")),
        "fundBookNo": fund_book,
        "fundingOwner": owner,
        "reimbursementAmount": amount,
        "sortOrder": index,
    }


def _detect_attachment_type(body, supplied_type, filename):
    if body.startswith(b"%PDF-"):
        return "application/pdf"
    if body.startswith(b"\xff\xd8\xff"):
        return "image/jpeg"
    if body.startswith(b"\x89PNG\r\n\x1a\n"):
        return "image/png"
    guessed = mimetypes.guess_type(filename or "")[0] or clean_text(supplied_type).split(";", 1)[0]
    return guessed.lower()


def _require_authenticated(actor):
    if not actor:
        raise PermissionError("请先登录")


def _require_admin(actor):
    _require_authenticated(actor)
    if actor.get("role") != "admin":
        raise PermissionError("需要管理员权限")


def _require_claim_view(actor, claim):
    _require_authenticated(actor)
    if actor.get("role") == "admin" or claim["created_by"] == actor.get("id"):
        return
    raise PermissionError("没有权限查看该报销单")


def _require_claim_edit(actor, claim):
    _require_claim_view(actor, claim)
    if claim["status"] == "void":
        raise ValueError("已作废报销单不能编辑")


def _limit(filters):
    try:
        return max(1, min(int(filters.get("limit", 20)), 100))
    except (TypeError, ValueError):
        return 20


def _offset(filters):
    try:
        return max(0, int(filters.get("offset", 0)))
    except (TypeError, ValueError):
        return 0


def _page(filters, total):
    limit, offset = _limit(filters), _offset(filters)
    return {"limit": limit, "offset": offset, "total": total, "hasMore": offset + limit < total}


def _money(value):
    try:
        return round(float(value or 0), 2)
    except (TypeError, ValueError):
        return 0.0


def _load(value):
    try:
        return json.loads(value or "{}")
    except json.JSONDecodeError:
        return {}


def _dump(value):
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"))
