"""One canonical identifier snapshot shared by duplicate and merge policies."""

import re
from dataclasses import dataclass

from server_app.shared.intake_identifiers import (
    intake_identifier_key,
    normalize_intake_order_identifiers,
    split_intake_identifiers,
)


def purchase_order_is_description(key):
    """Descriptions remain stored, but never become identifying order keys."""
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


@dataclass(frozen=True)
class IdentifierMatchKeys:
    purchase: str
    order: str
    batch: str
    members: dict
    searchable_members: dict


def identifier_match_keys(batch):
    normalized = normalize_intake_order_identifiers(batch)
    members = {
        field: [
            intake_identifier_key(value, batch=field == "batchNo")
            for value in split_intake_identifiers(normalized.get(field), batch=field == "batchNo")
        ]
        for field in ("purchaseOrderNo", "orderNo", "batchNo")
    }
    searchable = {
        field: [value for value in values if field == "batchNo" or not purchase_order_is_description(value)]
        for field, values in members.items()
    }
    scalar = {field: intake_identifier_key(normalized.get(field), batch=field == "batchNo") for field in members}
    for field in ("purchaseOrderNo", "orderNo"):
        if purchase_order_is_description(scalar[field]):
            scalar[field] = ""
    return IdentifierMatchKeys(scalar["purchaseOrderNo"], scalar["orderNo"], scalar["batchNo"], members, searchable)
