"""Strict recognition of source identifiers, separate from permissive manual fields."""

import re
import unicodedata

from server_app.shared.intake_identifiers import normalize_intake_order_identifiers

_NUMBER = re.compile(r"(?<![A-Z0-9])(?:DC[0-9]{15}|C[0-9]{13})(?![A-Z0-9])")


def identifier_candidates(text):
    source = unicodedata.normalize("NFKC", str(text or "")).upper()
    numbers = dict.fromkeys(_NUMBER.findall(source))
    return {
        "purchaseOrderNo": [number for number in numbers if number.startswith("C")],
        "orderNo": [number for number in numbers if number.startswith("DC")],
    }


def recognized_identifiers(text):
    candidates = identifier_candidates(text)
    purchases, orders = candidates["purchaseOrderNo"], candidates["orderNo"]
    if not purchases:
        purchases = list(dict.fromkeys(order[1:-2] for order in orders))
    return {"purchaseOrderNo": "、".join(purchases), "orderNo": "、".join(orders)}


def normalize_recognized_identifiers(item):
    """Correct a model's field labels only for complete known C/DC values."""
    result = dict(item)
    for key in ("purchaseOrderNo", "orderNo"):
        result[key] = unicodedata.normalize("NFKC", str(result.get(key) or ""))
    return normalize_intake_order_identifiers(result)
