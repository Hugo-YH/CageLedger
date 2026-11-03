"""Canonical intake identifiers; original message and image evidence remain separate."""

import re


def normalize_intake_batch_no(value):
    """Canonical business/display number; original evidence remains separate."""
    text = str(value or "").strip()
    text = re.sub(r"[（(]\s*([^()（）]+?)\s*[)）]", lambda match: f"（{match[1].strip()}）", text)
    match = re.fullmatch(r"（([A-Za-z]{1,6}\d{4,})）\s*(\d{6,})", text)
    return f"（{match[1].upper()}）{match[2]}" if match else text


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


def normalize_intake_order_identifiers(batch):
    """Split an exact platform order into its purchase request and full order ID."""
    result = dict(batch)
    purchase = str(batch.get("purchaseOrderNo") or "").strip()
    order = str(batch.get("orderNo") or "").strip()
    legacy = re.fullmatch(r"DC([0-9]{13})([0-9]{2})", purchase, re.IGNORECASE)
    if legacy:
        legacy_order = "DC" + legacy[1] + legacy[2]
        if order and order.upper() != legacy_order:
            raise ValueError("采购单号与订单编号中包含不同的订单，请核对后分别填写")
        order = legacy_order
        purchase = "C" + legacy[1]
    formal_order = re.fullmatch(r"DC([0-9]{13})([0-9]{2})", order, re.IGNORECASE)
    if formal_order:
        order = "DC" + formal_order[1] + formal_order[2]
        derived = "C" + formal_order[1]
        if purchase and purchase.upper() != derived:
            raise ValueError("采购单号与订单编号的对应关系不一致，请核对")
        purchase = derived
    if re.fullmatch(r"C[0-9]{13}", purchase, re.IGNORECASE):
        purchase = purchase.upper()
    result.update(purchaseOrderNo=purchase, orderNo=order)
    return result


def intake_identifier_values(batch):
    normalized = normalize_intake_order_identifiers(batch)
    purchase_order = normalized["purchaseOrderNo"]
    return (
        purchase_order,
        intake_identifier_key(purchase_order),
        intake_identifier_key(batch.get("batchNo"), batch=True),
    )


def intake_order_identifier_values(batch):
    order = normalize_intake_order_identifiers(batch)["orderNo"]
    return order, intake_identifier_key(order)
