"""Comparison keys only; keep the original identifiers in the business payload."""

import re


def intake_identifier_key(value, *, batch=False):
    key = str(value or "").strip().upper()
    if batch:
        key = key.replace("（", "(").replace("）", ")")
        key = re.sub(r"\(\s*([^()]+?)\s*\)", lambda match: f"({match[1].strip()})", key)
        # Whitespace between the IACUC prefix and numeric batch suffix is layout,
        # not a different demand. Keep arbitrary free-form identifiers distinct.
        match = re.fullmatch(r"\(([A-Z]{1,6}\d{4,})\)\s*(\d{6,})", key)
        if match:
            key = f"({match[1]}){match[2]}"
    return key


def intake_identifier_values(batch):
    purchase_order = str(batch.get("purchaseOrderNo") or "").strip()
    return (
        purchase_order,
        intake_identifier_key(purchase_order),
        intake_identifier_key(batch.get("batchNo"), batch=True),
    )
