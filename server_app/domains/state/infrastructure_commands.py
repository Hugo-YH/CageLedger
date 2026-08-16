"""Infrastructure write transactions for rooms, racks, and slots."""

import json
import sqlite3
import time
from datetime import UTC, datetime
from http import HTTPStatus

from server_app.cache import invalidate_data_cache, invalidate_data_cache_prefixes, log_perf
from server_app.db import connect_db
from server_app.domains.administration import merge_audit_logs, write_audit_events
from server_app.domains.state.audit_diff import build_audit_events, validate_state_write_permission
from server_app.domains.state.entity_rules import (
    empty_state,
    normalize_entity_batch,
    normalize_entity_payload,
    normalize_id_batch,
    validate_entity_references,
    validate_infrastructure_slot_deletes,
)
from server_app.domains.state.persistence import assemble_state
from server_app.persistence.backfills import backfill_quantity_sheet_staff
from server_app.repositories.infrastructure import (
    delete_rack_record,
    delete_room_record,
    delete_slot_record,
    insert_rack_record,
    insert_room_record,
    insert_slot_record,
    update_rack_record,
    update_room_record,
    update_slot_record,
)
from server_app.shared import new_id


def _normalize_payload(collection, payload, item_id, method, id_prefix):
    return normalize_entity_payload(collection, payload, item_id, method, id_prefix, new_id)


def _insert(state, collection, item):
    items = state.setdefault(collection, [])
    if any(existing.get("id") == item["id"] for existing in items):
        raise sqlite3.IntegrityError(f"Duplicate id: {item['id']}")
    validate_entity_references(state, collection, item)
    items.append(item)


def _replace(state, collection, item_id, item):
    items = state.setdefault(collection, [])
    for index, existing in enumerate(items):
        if existing.get("id") == item_id:
            validate_entity_references(state, collection, item)
            items[index] = item
            return
    raise LookupError("实体不存在")


def _delete(state, collection, item_id):
    items = state.setdefault(collection, [])
    deleted = next((item for item in items if item.get("id") == item_id), None)
    if deleted is None:
        raise LookupError("实体不存在")
    state[collection] = [item for item in items if item.get("id") != item_id]
    if collection == "rooms":
        rack_ids = {rack.get("id") for rack in state.get("racks", []) if rack.get("roomId") == item_id}
        state["racks"] = [rack for rack in state.get("racks", []) if rack.get("roomId") != item_id]
        state["slots"] = [slot for slot in state.get("slots", []) if slot.get("rackId") not in rack_ids]
    elif collection == "racks":
        state["slots"] = [slot for slot in state.get("slots", []) if slot.get("rackId") != item_id]
    return deleted


def _invalidate():
    invalidate_data_cache("assembled_state")
    invalidate_data_cache_prefixes(
        "bootstrap_summary::",
        "billing_occupancies::",
        "quantity_sheets::",
        "dashboard_overview::",
    )


def write_infrastructure_entity(collection, method, item_id, payload, actor, spec):
    started_at = time.perf_counter()
    updated_at = datetime.now(UTC).isoformat()
    status = HTTPStatus.CREATED if method == "POST" else HTTPStatus.OK
    with connect_db() as conn:
        old_state = assemble_state(conn) or empty_state()
        state = json.loads(json.dumps(old_state))
        item = _normalize_payload(collection, payload, item_id, method, spec["id_prefix"])
        if method == "POST":
            _insert(state, collection, item)
        elif method == "PUT":
            _replace(state, collection, item_id, item)
        elif method == "DELETE":
            item = _delete(state, collection, item_id)
        else:
            raise ValueError("Unsupported entity write method")
        validate_state_write_permission(actor, old_state, state)
        events = build_audit_events(actor, old_state, state, updated_at)
        operations = {
            ("rooms", "POST"): insert_room_record,
            ("rooms", "PUT"): update_room_record,
            ("rooms", "DELETE"): delete_room_record,
            ("racks", "POST"): insert_rack_record,
            ("racks", "PUT"): update_rack_record,
            ("racks", "DELETE"): delete_rack_record,
            ("slots", "POST"): insert_slot_record,
            ("slots", "PUT"): update_slot_record,
            ("slots", "DELETE"): delete_slot_record,
        }
        operations[(collection, method)](conn, item_id if method == "DELETE" else item)
        write_audit_events(conn, events)
        conn.commit()
    _invalidate()
    elapsed_ms = round((time.perf_counter() - started_at) * 1000, 1)
    log_perf("infrastructure_entity.save", started_at, collection=collection, method=method)
    return {
        "item": item,
        "updatedAt": updated_at,
        "auditLogs": merge_audit_logs([], events),
        "perf": {"total_ms": elapsed_ms, "rows_changed": 1, "collection": collection, "method": method},
    }, status


def write_infrastructure(payload, actor):
    if not isinstance(payload, dict):
        raise ValueError("Request body must be a JSON object")
    batches = {
        "rooms": normalize_entity_batch("rooms", payload.get("rooms", []), "POST", _normalize_payload),
        "roomUpdates": normalize_entity_batch("rooms", payload.get("roomUpdates", []), "PUT", _normalize_payload),
        "racks": normalize_entity_batch("racks", payload.get("racks", []), "POST", _normalize_payload),
        "rackUpdates": normalize_entity_batch("racks", payload.get("rackUpdates", []), "PUT", _normalize_payload),
        "rackDeletes": normalize_id_batch(payload.get("rackDeletes", []), "rackDeletes"),
        "slots": normalize_entity_batch("slots", payload.get("slots", []), "POST", _normalize_payload),
        "slotDeletes": normalize_id_batch(payload.get("slotDeletes", []), "slotDeletes"),
    }
    updated_at = datetime.now(UTC).isoformat()
    with connect_db() as conn:
        old_state = assemble_state(conn) or empty_state()
        state = json.loads(json.dumps(old_state))
        for key, collection in (("rooms", "rooms"), ("racks", "racks"), ("slots", "slots")):
            for item in batches[key]:
                _insert(state, collection, item)
        for key, collection in (("roomUpdates", "rooms"), ("rackUpdates", "racks")):
            for item in batches[key]:
                _replace(state, collection, item["id"], item)
        validate_infrastructure_slot_deletes(state, batches["slotDeletes"])
        for item_id in batches["slotDeletes"]:
            _delete(state, "slots", item_id)
        for item_id in batches["rackDeletes"]:
            _delete(state, "racks", item_id)
        validate_state_write_permission(actor, old_state, state)
        events = build_audit_events(actor, old_state, state, updated_at)
        for item in batches["rooms"]:
            insert_room_record(conn, item)
        for item in batches["roomUpdates"]:
            update_room_record(conn, item)
        backfill_quantity_sheet_staff(conn, [item["id"] for item in batches["rooms"] + batches["roomUpdates"]])
        for item in batches["racks"]:
            insert_rack_record(conn, item)
        for item in batches["rackUpdates"]:
            update_rack_record(conn, item)
        for item in batches["slots"]:
            insert_slot_record(conn, item)
        for item_id in batches["slotDeletes"]:
            delete_slot_record(conn, item_id)
        for item_id in batches["rackDeletes"]:
            delete_rack_record(conn, item_id)
        write_audit_events(conn, events)
        conn.commit()
    _invalidate()
    return {**batches, "updatedAt": updated_at, "auditLogs": merge_audit_logs([], events)}
