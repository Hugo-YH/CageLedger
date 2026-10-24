"""Allocation creation, atomic confirmation and reversal with existing audits."""

from server_app.domains.administration import audit_event, merge_audit_logs, write_audit_events
from server_app.shared import clean_text, new_id, now_iso

from .claim_rules import _input_money, _require_admin, _require_authenticated, _require_claim_edit
from .repository import allocation_payload as _allocation_payload
from .repository import allocation_row as _allocation_row
from .repository import claim_row as _claim_row
from .repository import confirm_allocation_if_effective, require_effective_obligation
from .repository import confirmed_amount_for_line as _confirmed_amount_for_line
from .repository import funding_line_row as _funding_line_row
from .repository import obligation_row as _obligation_row
from .repository import refresh_claim_balances as _refresh_claim_balances
from .repository import refresh_line_balance as _refresh_line_balance
from .repository import refresh_obligation_balance as _refresh_obligation_balance
from .repository import upsert_allocation as _upsert_allocation


def create_allocation(conn, actor, payload):
    _require_authenticated(actor)
    line = _funding_line_row(conn, clean_text(payload.get("fundingLineId", "")))
    claim = _claim_row(conn, line["claim_id"])
    if clean_text(payload.get("claimId", "")) != claim["id"]:
        raise ValueError("核销经费明细与报销单不匹配")
    _require_claim_edit(actor, claim)
    obligation = _obligation_row(conn, clean_text(payload.get("obligationId", "")))
    require_effective_obligation(conn, obligation["id"])
    amount = _input_money(payload.get("amount"), "核销金额")
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
    require_effective_obligation(conn, obligation["id"])
    now = now_iso()
    if not confirm_allocation_if_effective(conn, allocation_id, actor["id"], now):
        require_effective_obligation(conn, obligation["id"])
        current = _allocation_row(conn, allocation_id)
        if current["status"] != "draft":
            raise ValueError("只有核销草稿可以确认")
        if _confirmed_amount_for_line(conn, line["id"]) + allocation["amount"] > line["reimbursement_amount"] + 0.00001:
            raise ValueError("本次核销超过经费明细可分摊余额")
        raise ValueError("本次核销超过结算应收待核销金额")
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


ALLOCATION_STATUSES = {"draft", "confirmed", "reversed"}
