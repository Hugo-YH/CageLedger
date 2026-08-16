"""Occupancy snapshot and structured-column projections."""

from server_app.domains.billing import billing_profile_for_occupancy, occupancy_animal_count
from server_app.domains.iacuc import normalize_iacuc_number
from server_app.shared import as_int


def occupancy_with_snapshots(occupancy, state, applications_by_iacuc):
    item = dict(occupancy)
    iacuc = normalize_iacuc_number(item.get("iacuc", ""))
    if iacuc:
        item["iacuc"] = iacuc
    application = applications_by_iacuc.get(iacuc, {})
    for key in ("project", "pi", "owner", "funding", "projectStartDate", "projectEndDate", "applicationApprovalDate"):
        if not item.get(key) and application.get(key):
            item[key] = application.get(key, "")

    slot_context = slot_snapshot_context(state, item.get("slotId"))
    for key, value in slot_context.items():
        if value and not item.get(key):
            item[key] = value
    profile = billing_profile_for_occupancy(item, state)
    item["roomId"] = item.get("roomId") or slot_context.get("roomId", "")
    item["rackId"] = item.get("rackId") or slot_context.get("rackId", "")
    item["species"] = item.get("species") or profile.get("species", "")
    item["billingItem"] = item.get("billingItem") or profile.get("billingItem", "")
    item["customerType"] = item.get("customerType") or profile.get("customerType", "")
    if item.get("animalCount") in (None, ""):
        item["animalCount"] = occupancy_animal_count(item, profile) if profile.get("unit") == "animal_day" else None
    return item


def slot_snapshot_context(state, slot_id):
    slot = next((item for item in state.get("slots", []) if item.get("id") == slot_id), None)
    if not slot:
        return {}
    rack = next((item for item in state.get("racks", []) if item.get("id") == slot.get("rackId")), None)
    room = next((item for item in state.get("rooms", []) if item.get("id") == (rack or {}).get("roomId")), None)
    return {
        "roomId": (room or {}).get("id", ""),
        "rackId": (rack or {}).get("id", ""),
        "roomName": (room or {}).get("name", ""),
        "rackName": (rack or {}).get("name", ""),
        "slotCode": slot.get("code", ""),
    }


def occupancy_structured_values(occupancy):
    return {
        "room_id": occupancy.get("roomId", ""),
        "rack_id": occupancy.get("rackId", ""),
        "species": occupancy.get("species", ""),
        "billing_item": occupancy.get("billingItem", ""),
        "customer_type": occupancy.get("customerType", ""),
        "animal_count": as_int(occupancy.get("animalCount")),
    }
