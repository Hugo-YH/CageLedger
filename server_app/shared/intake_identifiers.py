"""Canonical intake identifiers; original message and image evidence remain separate."""

import re
import unicodedata

GROUP_FIELDS = {"purchaseOrderNo": "purchaseOrderNos", "orderNo": "orderNos", "batchNo": "batchNos"}
_ORDER = re.compile(r"DC([0-9]{13})([0-9]{2})", re.IGNORECASE)
_PURCHASE = re.compile(r"C[0-9]{13}", re.IGNORECASE)
_BATCH = re.compile(r"[（(]\s*([A-Za-z]{1,6}[0-9]{4,})\s*[)）]\s*([0-9]{6,})")


def _unique(values, *, batch=False):
    members = {}
    for value in values:
        members.setdefault(intake_identifier_key(value, batch=batch), value)
    return list(members.values())


def batch_identifiers_in_text(text):
    return list(
        dict.fromkeys(
            normalize_intake_batch_no(match[0])
            for match in _BATCH.finditer(unicodedata.normalize("NFKC", str(text or "")))
        )
    )


def identifier_iacucs(batch):
    return set(match[1].upper() for value in _field_members(batch, "batchNo") if (match := _BATCH.fullmatch(value)))


def split_intake_identifiers(value, *, batch=False):
    """Split only an unambiguous list of complete IDs; preserve free-form values."""
    text = str(value or "").strip()
    if not text:
        return []
    source = text
    pattern = _BATCH if batch else re.compile(r"(?:DC[0-9]{15}|C[0-9]{13})(?![A-Z0-9])", re.IGNORECASE)
    matches = list(pattern.finditer(source))
    remainder = pattern.sub("", source)
    if matches and not re.sub(r"[\s、,;|/:：，；]+", "", remainder):
        values = [normalize_intake_batch_no(match[0]) if batch else match[0].upper() for match in matches]
    else:
        values = [normalize_intake_batch_no(text) if batch else text]
    return list(dict.fromkeys(values))


def _field_members(batch, field):
    if field in batch:
        return split_intake_identifiers(batch[field], batch=field == "batchNo")
    groups = batch.get("identifiers")
    values = groups.get(GROUP_FIELDS[field], []) if isinstance(groups, dict) else []
    if not isinstance(values, list) or any(not isinstance(value, str) for value in values):
        raise ValueError("预约编号集合须为字符串列表")
    return list(
        dict.fromkeys(
            member for value in values for member in split_intake_identifiers(value, batch=field == "batchNo")
        )
    )


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


def normalize_intake_order_identifiers(batch, *, preserve_missing=False):
    """Keep an explicit same-reservation group, with legacy text projections."""
    result = dict(batch)
    raw_purchase, raw_order = _field_members(batch, "purchaseOrderNo"), _field_members(batch, "orderNo")
    purchases, orders = [], []
    for values, fallback in ((raw_purchase, purchases), (raw_order, orders)):
        for value in values:
            if _ORDER.fullmatch(value):
                orders.append(value.upper())
            elif _PURCHASE.fullmatch(value):
                purchases.append(value.upper())
            else:
                fallback.append(value)
    derived = list(dict.fromkeys(value[1:-2] for value in orders if _ORDER.fullmatch(value)))
    # A lone explicit pair remains unambiguous. In a group, an extra purchase
    # may have no supplied order yet; do not invent pairings or quantity shares.
    if len(purchases) == len(orders) == len(derived) == 1 and purchases[0].upper() != derived[0]:
        raise ValueError("采购单号与订单编号的对应关系不一致，请核对")
    purchases = _unique([*purchases, *derived])
    orders = _unique(orders)
    batches = _unique(_field_members(batch, "batchNo"), batch=True)
    groups = {"purchaseOrderNos": purchases, "orderNos": orders, "batchNos": batches}
    if any(len(values) > 50 or any(len(value) > 200 for value in values) for values in groups.values()):
        raise ValueError("每类预约编号最多50个，每个编号最多200字符")
    for key, value in (("purchaseOrderNo", "、".join(purchases)), ("orderNo", "、".join(orders))):
        # Storage must not manufacture empty fields in legacy snapshots/audit
        # payloads. API projections can still request the complete string shape.
        if not preserve_missing or key in batch or value:
            result[key] = value
    if "batchNo" in batch or batches:
        result["batchNo"] = "、".join(batches)
    if "identifiers" in batch or any(len(values) > 1 for values in groups.values()):
        result["identifiers"] = groups
    return result


def intake_identifier_members(batch):
    normalized = normalize_intake_order_identifiers(batch, preserve_missing=True)
    return {key: _field_members(normalized, key) for key in GROUP_FIELDS}


def intake_identifier_member_keys(batch):
    return {
        key: [intake_identifier_key(value, batch=key == "batchNo") for value in values]
        for key, values in intake_identifier_members(batch).items()
    }


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
