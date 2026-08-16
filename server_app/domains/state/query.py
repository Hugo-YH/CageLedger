"""Cached state queries and actor-scoped projections."""

import time

from server_app.cache import cache_get, cache_key, cache_set, log_perf
from server_app.db import connect_db
from server_app.domains.iacuc import normalize_iacuc_number
from server_app.domains.state.occupancy import occupancy_with_snapshots
from server_app.domains.state.projections import month_range, summarize_infrastructure
from server_app.repositories.state import (
    read_occupancy_payloads_for_billing,
    read_payloads_by_ids,
)
from server_app.repositories.state import (
    read_rack_room_map as read_rack_room_map_repository,
)
from server_app.repositories.state import (
    read_slot_room_map as read_slot_room_map_repository,
)
from server_app.shared import clean_text


def actor_cache_scope(actor):
    if not actor:
        return "anonymous"
    rooms = ",".join(sorted(clean_text(item) for item in actor.get("roomIds", []) if clean_text(item)))
    return f"{actor.get('role', '')}:{rooms}"


def read_bootstrap_state(conn, actor, read_cached_state, scope="summary", room_id=""):
    started_at = time.perf_counter()
    state = filter_state_for_actor(read_cached_state(conn), actor)
    actor_scope = actor_cache_scope(actor)
    key = cache_key("bootstrap_summary", actor=actor_scope)
    if scope == "summary":
        cached = cache_get(key)
        if cached is not None:
            log_perf("bootstrap", started_at, scope=scope, cached=1, rooms=len(cached.get("rooms", [])))
            return cached
    payload = {"rooms": state.get("rooms", []), "racks": state.get("racks", []), **summarize_infrastructure(state)}
    if scope == "full":
        payload["slots"] = state.get("slots", [])
        log_perf("bootstrap", started_at, scope=scope, rooms=len(payload["rooms"]), slots=len(payload["slots"]))
        return payload
    if scope == "room":
        room_id = clean_text(room_id)
        payload["placementTasks"] = [
            item for item in state.get("placementTasks", []) if item.get("targetRoomId") == room_id
        ]
        rack_ids = {rack.get("id") for rack in state.get("racks", []) if rack.get("roomId") == room_id}
        payload["slots"] = [slot for slot in state.get("slots", []) if slot.get("rackId") in rack_ids]
        slot_ids = {slot.get("id") for slot in payload["slots"]}
        payload["occupancies"] = [item for item in state.get("occupancies", []) if item.get("slotId") in slot_ids]
        log_perf(
            "bootstrap",
            started_at,
            scope=scope,
            room_id=room_id,
            rooms=len(payload["rooms"]),
            slots=len(payload["slots"]),
        )
        return payload
    payload["slots"], payload["occupancies"] = [], []
    result = cache_set(key, payload) if scope == "summary" else payload
    log_perf("bootstrap", started_at, scope=scope, rooms=len(payload["rooms"]))
    return result


def read_billing_occupancies(conn, actor, filters, read_applications_by_iacuc):
    started_at = time.perf_counter()
    month = clean_text(filters.get("month", ""))
    iacuc = clean_text(filters.get("iacuc", ""))
    pi = clean_text(filters.get("pi", ""))
    if not month:
        raise ValueError("请提供结算月份")
    key = cache_key("billing_occupancies", actor=actor_cache_scope(actor), month=month, iacuc=iacuc, pi=pi)
    cached = cache_get(key)
    if cached is not None:
        log_perf(
            "billing_occupancies", started_at, cached=1, month=month, occupancies=len(cached.get("occupancies", []))
        )
        return cached
    occupancies = read_occupancies_for_billing(conn, month, read_applications_by_iacuc, iacuc, pi)
    if actor and actor.get("role") != "admin":
        allowed = {clean_text(item) for item in actor.get("roomIds", []) if clean_text(item)}
        occupancies = [item for item in occupancies if clean_text(item.get("roomId", "")) in allowed]
    state = read_billing_state_for_occupancies(conn, occupancies)
    slot_ids = {item.get("slotId") for item in occupancies if item.get("slotId")}
    payload = {
        "month": month,
        "pi": pi,
        "iacuc": iacuc,
        "slots": [slot for slot in state["slots"] if slot.get("id") in slot_ids],
        "occupancies": occupancies,
    }
    cache_set(key, payload)
    log_perf("billing_occupancies", started_at, month=month, occupancies=len(occupancies), slots=len(payload["slots"]))
    return payload


def read_occupancies_for_billing(conn, month, read_applications_by_iacuc, iacuc="", pi=""):
    start, end = month_range(month)
    items = read_occupancy_payloads_for_billing(conn, start, end, normalize_iacuc_number(iacuc), clean_text(pi))
    slots = read_payloads_by_ids(
        conn, "cage_slots", {item.get("slotId") for item in items}, "rack_id, row_no, col_no, rowid"
    )
    racks = read_payloads_by_ids(conn, "racks", {slot.get("rackId") for slot in slots}, "room_id, index_no, rowid")
    rooms = read_payloads_by_ids(conn, "rooms", {rack.get("roomId") for rack in racks})
    applications = read_applications_by_iacuc(conn)
    state = {"rooms": rooms, "racks": racks, "slots": slots}
    return [occupancy_with_snapshots(item, state, applications) for item in items]


def read_billing_state_for_occupancies(conn, occupancies):
    slots = read_payloads_by_ids(
        conn, "cage_slots", {item.get("slotId") for item in occupancies}, "rack_id, row_no, col_no, rowid"
    )
    rack_ids = {slot.get("rackId") for slot in slots} | {item.get("rackId") for item in occupancies}
    racks = read_payloads_by_ids(conn, "racks", rack_ids, "room_id, index_no, rowid")
    room_ids = {rack.get("roomId") for rack in racks} | {item.get("roomId") for item in occupancies}
    return {"rooms": read_payloads_by_ids(conn, "rooms", room_ids), "racks": racks, "slots": slots}


def filter_state_for_actor(state, actor):
    if not state or not actor or actor.get("role") == "admin":
        return state
    allowed = set(actor.get("roomIds", []))
    rooms = [item for item in state.get("rooms", []) if item.get("id") in allowed]
    room_ids = {item.get("id") for item in rooms}
    racks = [item for item in state.get("racks", []) if item.get("roomId") in room_ids]
    rack_ids = {item.get("id") for item in racks}
    slots = [item for item in state.get("slots", []) if item.get("rackId") in rack_ids]
    slot_ids = {item.get("id") for item in slots}
    return {
        **state,
        "rooms": rooms,
        "racks": racks,
        "slots": slots,
        "occupancies": [item for item in state.get("occupancies", []) if item.get("slotId") in slot_ids],
        "placementTasks": [item for item in state.get("placementTasks", []) if item.get("targetRoomId") in room_ids],
    }


def filter_entity_payloads_for_actor(collection, items, actor):
    if not actor or actor.get("role") == "admin":
        return items
    allowed = {clean_text(item) for item in actor.get("roomIds", []) if clean_text(item)}
    if collection == "rooms":
        return [item for item in items if item.get("id") in allowed]
    if collection == "racks":
        return [item for item in items if item.get("roomId") in allowed]
    if collection == "placementTasks":
        return [item for item in items if item.get("targetRoomId") in allowed]
    if collection == "slots":
        mapping = read_rack_room_map({item.get("rackId") for item in items})
        return [item for item in items if mapping.get(item.get("rackId")) in allowed]
    if collection == "occupancies":
        direct = [item for item in items if item.get("roomId") in allowed]
        unresolved = [item for item in items if not item.get("roomId")]
        mapping = read_slot_room_map({item.get("slotId") for item in unresolved})
        return direct + [item for item in unresolved if mapping.get(item.get("slotId")) in allowed]
    return items


def read_rack_room_map(ids):
    with connect_db() as conn:
        return read_rack_room_map_repository(conn, ids)


def read_slot_room_map(ids):
    with connect_db() as conn:
        return read_slot_room_map_repository(conn, ids)
