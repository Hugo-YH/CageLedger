"""Opt-in, transaction-bound duplicate reminders for the intake editor."""

import hashlib
import json

from server_app.domains.administration import audit_event
from server_app.domains.intake.repository import find_duplicate_identifiers
from server_app.shared.intake_identifiers import intake_identifier_values


class IntakeDuplicateConfirmationRequired(Exception):
    def __init__(self, details):
        super().__init__("采购单号或批次号已存在，请核对后确认保存。")
        self.details = details


def confirm_duplicate_identifiers(conn, item, exclude_id, confirmation):
    """Caller holds the write lock; never persist anything for an unconfirmed attempt."""
    _, purchase_key, batch_key = intake_identifier_values(item)
    rows = find_duplicate_identifiers(conn, purchase_key, batch_key, exclude_id)
    if not rows:
        return None
    items = [
        {
            "id": row["id"],
            "purchaseOrderNo": row["purchase_order_no"],
            "batchNo": row["batch_no"],
            "intakeDate": row["intake_date"],
            "pi": row["pi"],
            "owner": row["owner"],
            "status": row["status"],
            "matchedFields": [
                name
                for name, key, actual in (
                    ("purchaseOrderNo", purchase_key, row["purchase_order_key"]),
                    ("batchNo", batch_key, row["batch_no_key"]),
                )
                if key and key == actual
            ],
        }
        for row in rows
    ]
    fingerprint = json.dumps(
        [item["id"], exclude_id, purchase_key, batch_key, rows], sort_keys=True, ensure_ascii=False
    )
    token = hashlib.sha256(fingerprint.encode("utf-8")).hexdigest()
    if not isinstance(confirmation, str) or confirmation != token:
        raise IntakeDuplicateConfirmationRequired(
            {"items": items[:20], "total": len(items), "confirmationToken": token}
        )
    return {
        "purchaseOrderNo": item.get("purchaseOrderNo", ""),
        "batchNo": item.get("batchNo", ""),
        "matchCount": len(items),
        "matches": [{"id": item["id"], "matchedFields": item["matchedFields"]} for item in items],
    }


def duplicate_confirmation_event(actor, item, confirmation, at):
    return audit_event(
        actor,
        "intake_batch.duplicate_confirmed",
        "intake_batch",
        item["id"],
        f"{actor['displayName']} 确认采购单号或批次号重复后仍然保存待接收批次 {item.get('batchNo', '')}",
        [],
        at,
        None,
        confirmation,
    )
