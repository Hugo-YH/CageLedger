"""Placement task application transactions."""

import json
import time
from collections.abc import Callable
from dataclasses import dataclass
from datetime import UTC, datetime
from http import HTTPStatus
from typing import Any

from server_app.cache import invalidate_data_cache, invalidate_data_cache_prefixes, log_perf
from server_app.db import connect_db
from server_app.domains.administration import merge_audit_logs, write_audit_events
from server_app.domains.cages import sync_slot_statuses
from server_app.domains.state.audit_diff import build_audit_events, changed_keys, validate_state_write_permission
from server_app.domains.state.entity_rules import empty_state
from server_app.domains.state.occupancy import occupancy_with_snapshots
from server_app.domains.state.persistence import assemble_state, read_applications_by_iacuc
from server_app.repositories.entities import (
    delete_placement_task as delete_placement_task_repository,
)
from server_app.repositories.entities import (
    upsert_placement_task as upsert_placement_task_repository,
)
from server_app.repositories.infrastructure import update_slot_record
from server_app.shared import clean_text
from server_app.shared.concurrency import require_current_version


@dataclass(frozen=True)
class PlacementCommandPorts:
    normalize_entity_payload: Callable[..., dict[str, Any]]
    insert_entity: Callable[..., None]
    replace_entity: Callable[..., None]
    delete_entity: Callable[..., dict[str, Any]]
    upsert_occupancy_record: Callable[..., None]
    write_perf_summary: Callable[..., dict[str, Any]]


def write_placement_task_entity_state(method, item_id, payload, actor, spec, ports):
    started_at = time.perf_counter()
    updated_at = datetime.now(UTC).isoformat()
    status = HTTPStatus.OK
    with connect_db() as conn:
        old_state = assemble_state(conn) or empty_state()
        state = json.loads(json.dumps(old_state))
        item = ports.normalize_entity_payload("placementTasks", payload, item_id, method, spec["id_prefix"])
        item["updatedAt"] = updated_at
        old_item = next((entry for entry in old_state.get("placementTasks", []) if entry.get("id") == item_id), None)
        removed_occupancy_id = ""
        if method == "POST":
            ports.insert_entity(state, "placementTasks", item)
            status = HTTPStatus.CREATED
        elif method == "PUT":
            require_current_version(old_item or {}, payload.get("expectedUpdatedAt"), "待进驻任务")
            ports.replace_entity(state, "placementTasks", item_id, item)
        elif method == "DELETE":
            item = ports.delete_entity(state, "placementTasks", item_id)
            removed_occupancy_id = clean_text((old_item or item).get("reservedOccupancyId", ""))
        else:
            raise ValueError("Unsupported entity write method")

        affected_slot_ids = {
            clean_text(occ.get("slotId", ""))
            for occ in old_state.get("occupancies", [])
            if removed_occupancy_id and occ.get("id") == removed_occupancy_id
        }
        sync_slot_statuses(state)
        validate_state_write_permission(actor, old_state, state)
        events = build_audit_events(actor, old_state, state, updated_at)
        if method == "DELETE":
            delete_placement_task_repository(conn, item_id)
            if removed_occupancy_id:
                conn.execute("DELETE FROM occupancies WHERE id = ?", (removed_occupancy_id,))
        else:
            saved_item = next(
                (entry for entry in state.get("placementTasks", []) if entry.get("id") == item.get("id")), item
            )
            upsert_placement_task_repository(conn, saved_item)
            item = saved_item
        affected_slots = [slot for slot in state.get("slots", []) if slot.get("id") in affected_slot_ids]
        for slot in affected_slots:
            update_slot_record(conn, slot)
        write_audit_events(conn, events)
        conn.commit()

    invalidate_data_cache("assembled_state")
    invalidate_data_cache_prefixes("bootstrap_summary::", "billing_occupancies::", "placement_tasks::")
    response = {
        "item": item,
        "affectedSlots": affected_slots,
        "updatedAt": updated_at,
        "auditLogs": merge_audit_logs([], events),
        "perf": ports.write_perf_summary(started_at, rows_changed=1 + len(affected_slots), method=method),
    }
    log_perf("placement_task.save", started_at, method=method, slot_count=len(affected_slots))
    return response, status


def persist_placement_action(task_id, actor, mutator, ports):
    started_at = time.perf_counter()
    updated_at = datetime.now(UTC).isoformat()
    with connect_db() as conn:
        old_state = assemble_state(conn) or empty_state()
        state = json.loads(json.dumps(old_state))
        result = mutator(state)
        task = result[0] if isinstance(result, tuple) else result
        occupancy = result[1] if isinstance(result, tuple) and len(result) > 1 else None
        affected_slot_ids = changed_placement_slot_ids(old_state, state)
        events = build_audit_events(actor, old_state, state, updated_at)
        upsert_placement_task_repository(conn, task)
        if occupancy:
            applications_by_iacuc = read_applications_by_iacuc(conn)
            occupancy = occupancy_with_snapshots(occupancy, state, applications_by_iacuc)
            ports.upsert_occupancy_record(conn, occupancy)
        affected_slots = [slot for slot in state.get("slots", []) if slot.get("id") in affected_slot_ids]
        for slot in affected_slots:
            update_slot_record(conn, slot)
        write_audit_events(conn, events)
        conn.commit()
    invalidate_data_cache("assembled_state")
    invalidate_data_cache_prefixes("bootstrap_summary::", "billing_occupancies::")
    log_perf("placement_task.action", started_at, task_id=task_id, slot_count=len(affected_slots))
    payload = {
        "task": task,
        "affectedSlots": affected_slots,
        "updatedAt": updated_at,
        "auditLogs": merge_audit_logs([], events),
        "perf": ports.write_perf_summary(
            started_at, rows_changed=1 + (1 if occupancy else 0) + len(affected_slots), slot_count=len(affected_slots)
        ),
    }
    if occupancy:
        payload["occupancy"] = occupancy
    return payload


def changed_placement_slot_ids(old_state, state):
    old_occupancies = {item.get("id"): item for item in old_state.get("occupancies", [])}
    new_occupancies = {item.get("id"): item for item in state.get("occupancies", [])}
    slot_ids = set()
    for occupancy_id in changed_keys(old_occupancies, new_occupancies):
        old_item = old_occupancies.get(occupancy_id) or {}
        new_item = new_occupancies.get(occupancy_id) or {}
        for item in (old_item, new_item):
            slot_id = clean_text(item.get("slotId", ""))
            if slot_id:
                slot_ids.add(slot_id)
    return slot_ids
