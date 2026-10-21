"""Comparison keys only; keep the original identifiers in the business payload."""

import re


def intake_identifier_key(value, *, batch=False):
    key = str(value or "").strip().upper()
    if batch:
        key = key.replace("（", "(").replace("）", ")")
        key = re.sub(r"\(\s*([^()]+?)\s*\)", lambda match: f"({match[1].strip()})", key)
    return key


def intake_identifier_values(batch):
    purchase_order = str(batch.get("purchaseOrderNo") or "").strip()
    return (
        purchase_order,
        intake_identifier_key(purchase_order),
        intake_identifier_key(batch.get("batchNo"), batch=True),
    )
