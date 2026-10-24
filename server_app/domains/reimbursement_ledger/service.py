"""Claims, obligations and legacy migration use-case orchestration."""

import json
import shutil

from server_app.config import REIMBURSEMENT_ATTACHMENTS_PATH
from server_app.domains.administration import audit_event, merge_audit_logs, write_audit_events
from server_app.shared import clean_text, new_id, now_iso

from .allocation_commands import ALLOCATION_STATUSES as ALLOCATION_STATUSES
from .allocation_commands import confirm_allocation as confirm_allocation
from .allocation_commands import create_allocation as create_allocation
from .allocation_commands import reverse_allocation as reverse_allocation
from .claim_attachments import ALLOWED_ATTACHMENT_TYPES as ALLOWED_ATTACHMENT_TYPES
from .claim_attachments import MAX_ATTACHMENT_BYTES as MAX_ATTACHMENT_BYTES
from .claim_attachments import MAX_ATTACHMENTS_PER_CLAIM as MAX_ATTACHMENTS_PER_CLAIM
from .claim_attachments import add_attachment as add_attachment
from .claim_attachments import get_attachment as get_attachment
from .claim_rules import _detect_attachment_type as _detect_attachment_type
from .claim_rules import _dump as _dump
from .claim_rules import _input_money as _input_money
from .claim_rules import _limit as _limit
from .claim_rules import _load as _load
from .claim_rules import _money as _money
from .claim_rules import _normalize_funding_line as _normalize_funding_line
from .claim_rules import _obligation_filters as _obligation_filters
from .claim_rules import _offset as _offset
from .claim_rules import _page as _page
from .claim_rules import _require_admin as _require_admin
from .claim_rules import _require_authenticated as _require_authenticated
from .claim_rules import _require_claim_edit as _require_claim_edit
from .claim_rules import _require_claim_view as _require_claim_view
from .listing import (
    CLAIM_LIST_COLUMNS,
    LEGACY_LIST_COLUMNS,
    OBLIGATION_LIST_COLUMNS,
    list_column_where,
    list_sort_order,
)
from .repository import EFFECTIVE_OBLIGATION_WHERE, effective_obligation_row, validate_funding_line_ownership
from .repository import claim_has_confirmed_allocations as _claim_has_confirmed_allocations
from .repository import claim_payload as _claim_payload
from .repository import claim_row as _claim_row
from .repository import confirmed_amount_for_line as _confirmed_amount_for_line
from .repository import confirmed_amount_for_obligation as _confirmed_amount_for_obligation
from .repository import delete_claim as _delete_claim
from .repository import obligation_payload as _obligation_payload
from .repository import obligation_row as _obligation_row
from .repository import refresh_claim_balances as _refresh_claim_balances
from .repository import refresh_obligation_balance as _refresh_obligation_balance
from .repository import upsert_claim as _upsert_claim
from .repository import upsert_funding_line as _upsert_funding_line
from .repository import upsert_obligation as _upsert_obligation
from .snapshot_sync import sync_same_version_obligation
from .source_fields import source_fields


def list_obligations(conn, actor, filters):
    _require_authenticated(actor)
    sync_settlement_obligations(conn, actor)
    clauses, params = _obligation_filters(filters)
    clauses.append(EFFECTIVE_OBLIGATION_WHERE)
    column_clauses, column_params = list_column_where(filters, OBLIGATION_LIST_COLUMNS)
    clauses.extend(column_clauses)
    params.extend(column_params)
    where = f" WHERE {' AND '.join(clauses)}" if clauses else ""
    total = conn.execute(f"SELECT COUNT(*) FROM reimbursement_settlement_obligations{where}", params).fetchone()[0]
    rows = conn.execute(
        f"""SELECT * FROM reimbursement_settlement_obligations{where}
            ORDER BY {list_sort_order(filters, OBLIGATION_LIST_COLUMNS, "month DESC, source_pi COLLATE NOCASE, iacuc, updated_at DESC")}
            LIMIT ? OFFSET ?""",
        (*params, _limit(filters), _offset(filters)),
    ).fetchall()
    return {"items": [_obligation_payload(conn, row) for row in rows], "page": _page(filters, total)}


def get_obligation(conn, actor, obligation_id):
    _require_authenticated(actor)
    sync_settlement_obligations(conn, actor)
    return {"item": _obligation_payload(conn, effective_obligation_row(conn, obligation_id))}


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
    column_clauses, column_params = list_column_where(filters, CLAIM_LIST_COLUMNS)
    clauses.extend(column_clauses)
    params.extend(column_params)
    where = f" WHERE {' AND '.join(clauses)}" if clauses else ""
    total = conn.execute(f"SELECT COUNT(*) FROM reimbursement_claims{where}", params).fetchone()[0]
    rows = conn.execute(
        f"""SELECT reimbursement_claims.*,
                   (SELECT COUNT(*) FROM reimbursement_claim_funding_lines fl
                    WHERE fl.claim_id = reimbursement_claims.id) AS funding_line_count
            FROM reimbursement_claims{where}
            ORDER BY {list_sort_order(filters, CLAIM_LIST_COLUMNS, "updated_at DESC, rowid DESC")}
            LIMIT ? OFFSET ?""",
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
    validate_funding_line_ownership(conn, normalized_lines, claim_id)
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


def delete_claim(conn, actor, claim_id):
    _require_authenticated(actor)
    existing = _claim_row(conn, claim_id)
    if not existing:
        raise LookupError("报销单不存在")
    _require_claim_view(actor, existing)
    if _claim_has_confirmed_allocations(conn, claim_id):
        raise ValueError("存在已确认核销的报销单不能删除，请先在核销中心撤销分摊后再删除")
    now = now_iso()
    document_number = existing["document_number"]
    snapshot = _claim_payload(conn, existing, True)
    _delete_claim(conn, claim_id)
    try:
        shutil.rmtree(REIMBURSEMENT_ATTACHMENTS_PATH / claim_id, ignore_errors=True)
    except OSError:
        pass
    event = audit_event(
        actor,
        "reimbursement_ledger.claim_deleted",
        "reimbursement_claim",
        claim_id,
        f"{actor['displayName']} 删除报销单 {document_number}",
        [],
        now,
        snapshot,
        None,
    )
    write_audit_events(conn, [event])
    conn.commit()
    return {"ok": True, "auditLogs": merge_audit_logs([], [event])}


def list_legacy_records(conn, actor, filters):
    _require_authenticated(actor)
    limit, offset = _limit(filters), _offset(filters)
    clauses, params = list_column_where(filters, LEGACY_LIST_COLUMNS)
    where = f" WHERE {' AND '.join(clauses)}" if clauses else ""
    rows = conn.execute(
        f"""SELECT payload FROM reimbursement_records{where}
            ORDER BY {list_sort_order(filters, LEGACY_LIST_COLUMNS, "month DESC, latest_event_at DESC, rowid DESC")}
            LIMIT ? OFFSET ?""",
        (*params, limit, offset),
    ).fetchall()
    total = conn.execute(f"SELECT COUNT(*) FROM reimbursement_records{where}", params).fetchone()[0]
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


def sync_settlement_obligations(conn, actor=None):
    rows = conn.execute(
        """SELECT workflows.id AS workflow_id, workflows.month, workflows.iacuc, workflows.current_version_id,
                  workflows.current_version_no, versions.payload
           FROM billing_workflows AS workflows
           JOIN billing_statement_versions AS versions ON versions.id = workflows.current_version_id
           WHERE workflows.current_version_id <> '' AND versions.version_status <> 'voided'"""
    ).fetchall()
    if not rows:
        return
    existing_by_workflow = {}
    for existing in conn.execute(
        """SELECT id,workflow_id,statement_version_id,payable_amount,iacuc
           FROM reimbursement_settlement_obligations ORDER BY created_at"""
    ).fetchall():
        existing_by_workflow.setdefault(existing["workflow_id"], existing)
    changed = False
    for row in rows:
        payable, source_pi, statement_iacuc, fee_type = source_fields(row["payload"], row["iacuc"])
        if not source_pi:
            continue
        existing = existing_by_workflow.get(row["workflow_id"])
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
                    "feeType": fee_type,
                    "status": "open",
                    "createdAt": now,
                    "updatedAt": now,
                },
            )
            changed = True
            continue
        if existing["statement_version_id"] == row["current_version_id"]:
            # Equal snapshots need no allocation aggregate. Still inspect each
            # current snapshot on every read, including same-version repricing.
            if existing["payable_amount"] == payable and not existing["iacuc"].startswith("pi::"):
                continue
            confirmed = _confirmed_amount_for_obligation(conn, existing["id"])
            if (confirmed <= 0.00001 and existing["payable_amount"] != payable) or existing["iacuc"].startswith("pi::"):
                changed = sync_same_version_obligation(conn, existing["id"], actor) or changed
            continue
        confirmed = _confirmed_amount_for_obligation(conn, existing["id"])
        if confirmed <= 0.00001:
            payload = _obligation_payload(conn, _obligation_row(conn, existing["id"]))
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
                "feeType": fee_type,
                "status": "open",
                "createdAt": now,
                "updatedAt": now,
            },
        )
        changed = True
    if changed:
        conn.commit()


CLAIM_STATUSES = {"pending_submission", "reimbursing", "completed", "void"}
