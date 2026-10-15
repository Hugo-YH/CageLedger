"""Refresh unallocated receivables when a generated bill reuses its version ID."""

import json

from server_app.domains.administration import audit_event, write_audit_events
from server_app.shared import clean_text, now_iso

from .repository import current_snapshot_obligation, money, obligation_payload, upsert_obligation


def sync_same_version_obligation(conn, obligation_id, actor=None):
    """Recheck source and confirmed allocations under the write lock; keep history."""
    owns_transaction = not conn.in_transaction
    if owns_transaction:
        conn.execute("BEGIN IMMEDIATE")
    conn.execute("SAVEPOINT same_version_obligation_sync")
    released = False
    try:
        changed = _sync(conn, obligation_id, actor)
        conn.execute("RELEASE same_version_obligation_sync")
        released = True
        if owns_transaction:
            conn.commit()
        return changed
    except BaseException:
        if not released:
            conn.execute("ROLLBACK TO same_version_obligation_sync")
            conn.execute("RELEASE same_version_obligation_sync")
        if owns_transaction:
            conn.rollback()
        raise


def _sync(conn, obligation_id, actor):
    row = current_snapshot_obligation(conn, obligation_id)
    if not row:
        return False
    statement = dict(json.loads(row["snapshot_payload"]).get("statement") or {})
    payable = money(statement.get("totalAmount", 0))
    amount_changed = row["confirmed_count"] == 0 and row["payable_amount"] != payable
    iacucs = [clean_text(value) for value in statement.get("iacucs", []) if clean_text(value)]
    iacuc = "、".join(dict.fromkeys(iacucs)) or clean_text(statement.get("iacuc", row["workflow_iacuc"]))
    iacuc_changed = row["iacuc"].startswith("pi::") and bool(iacuc)
    if not amount_changed and not iacuc_changed:
        return False
    before = obligation_payload(conn, row)
    now = now_iso()
    after = {**before, "updatedAt": now}
    if iacuc_changed:
        after["iacuc"] = iacuc
    if amount_changed:
        after.update(
            {
                "payableAmount": payable,
                "allocatedAmount": 0,
                "outstandingAmount": payable,
                "claimCount": 0,
                "status": "settled" if abs(payable) < 0.00001 else "open",
            }
        )
    upsert_obligation(conn, after)
    if amount_changed:
        actor = actor or {"id": "", "username": "system", "displayName": "系统"}
        write_audit_events(
            conn,
            [
                audit_event(
                    actor,
                    "reimbursement_ledger.obligation_snapshot_synced",
                    "reimbursement_obligation",
                    obligation_id,
                    "根据当前账单快照同步未核销应收金额",
                    [],
                    now,
                    before,
                    after,
                )
            ],
        )
    return True
