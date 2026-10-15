"""Cancel receivables within the caller's workflow deletion transaction."""

from server_app.domains.administration import audit_event, write_audit_events
from server_app.shared import now_iso

from .repository import delete_unreferenced_obligation, obligation_payload, upsert_obligation, workflow_obligations


def cancel_workflow_obligations(conn, workflow_id, actor):
    rows = workflow_obligations(conn, workflow_id)
    if any(row["confirmed_count"] for row in rows):
        raise ValueError("结算流程存在已确认核销，请先撤销相关核销再撤销流程")
    events = []
    for row in rows:
        before = obligation_payload(conn, row)
        after = None
        if row["allocation_count"]:
            after = {
                **before,
                "status": "void",
                "allocatedAmount": 0,
                "outstandingAmount": 0,
                "claimCount": 0,
                "updatedAt": now_iso(),
            }
            upsert_obligation(conn, after)
        else:
            delete_unreferenced_obligation(conn, row["id"])
        events.append(
            audit_event(
                actor,
                "reimbursement_ledger.obligation_cancelled",
                "reimbursement_obligation",
                row["id"],
                f"{actor['displayName']} 随结算流程撤销应收",
                [],
                now_iso(),
                before,
                after,
            )
        )
    if events:
        write_audit_events(conn, events)
