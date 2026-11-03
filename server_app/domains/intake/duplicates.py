"""Opt-in, transaction-bound duplicate reminders for the intake editor."""

import hashlib
import json
import re

from server_app.domains.administration import audit_event
from server_app.domains.intake.repository import find_duplicate_identifiers
from server_app.shared.intake_identifiers import (
    intake_identifier_member_keys,
    intake_identifier_values,
    intake_order_identifier_values,
)


class IntakeDuplicateConfirmationRequired(Exception):
    def __init__(self, details):
        super().__init__("采购单号、订单编号或批次号已存在，请核对后确认保存。")
        self.details = details


def purchase_order_is_description(key):
    """Explanations remain in the record, but are not unique purchase identifiers."""
    if not re.search(r"[A-Z0-9]", key):
        return True
    if key in {"N/A", "N.A.", "NA", "NONE", "NULL", "TBD", "UNKNOWN", "NOT APPLICABLE"}:
        return True
    return bool(
        re.match(
            r"^(?:(?:不走|未走|不经|未经|不通过|未通过|无需|非)\s*锐竞"
            r"|自购|自带|自行采购|自行购买|课题组自购|课题组提供|赠送|待补充|待填写|暂无单号|无采购单号)",
            key,
        )
    )


def confirm_duplicate_identifiers(conn, item, exclude_id, confirmation):
    """Caller holds the write lock; never persist anything for an unconfirmed attempt."""
    _, purchase_key, batch_key = intake_identifier_values(item)
    if purchase_order_is_description(purchase_key):
        purchase_key = ""
    _, order_key = intake_order_identifier_values(item)
    if purchase_order_is_description(order_key):
        order_key = ""
    keys = intake_identifier_member_keys(item)
    for kind in ("purchaseOrderNo", "orderNo"):
        keys[kind] = [key for key in keys[kind] if not purchase_order_is_description(key)]
    rows = find_duplicate_identifiers(
        conn, purchase_key, batch_key, exclude_id, order_no_key=order_key, member_keys=keys
    )
    if not rows:
        return None
    items = [
        {
            "id": row["id"],
            "purchaseOrderNo": row["purchase_order_no"],
            "orderNo": row["order_no"],
            "batchNo": row["batch_no"],
            "intakeDate": row["intake_date"],
            "pi": row["pi"],
            "owner": row["owner"],
            "status": row["status"],
            "matchedFields": row["matchedFields"],
        }
        for row in rows
    ]
    fingerprint = json.dumps(
        [item["id"], exclude_id, purchase_key, order_key, batch_key, rows], sort_keys=True, ensure_ascii=False
    )
    token = hashlib.sha256(fingerprint.encode("utf-8")).hexdigest()
    if not isinstance(confirmation, str) or confirmation != token:
        raise IntakeDuplicateConfirmationRequired(
            {"items": items[:20], "total": len(items), "confirmationToken": token}
        )
    return {
        "purchaseOrderNo": item.get("purchaseOrderNo", ""),
        "orderNo": item.get("orderNo", ""),
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
        f"{actor['displayName']} 确认采购单号、订单编号或批次号重复后仍然保存待接收批次 {item.get('batchNo', '')}",
        [],
        at,
        None,
        confirmation,
    )
