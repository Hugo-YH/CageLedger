"""Occupancy application transactions."""

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
from server_app.domains.state.audit_diff import build_audit_events, validate_state_write_permission
from server_app.domains.state.entity_rules import empty_state
from server_app.domains.state.occupancy import occupancy_structured_values, occupancy_with_snapshots
from server_app.domains.state.persistence import assemble_state, read_applications_by_iacuc
from server_app.repositories.infrastructure import update_slot_record
from server_app.repositories.state import upsert_occupancy_record as upsert_occupancy_record_repository
from server_app.shared import clean_text
from server_app.shared.concurrency import require_current_version


@dataclass(frozen=True)
class OccupancyCommandPorts:
    normalize_entity_payload: Callable[..., dict[str, Any]]
    insert_entity: Callable[..., None]
    replace_entity: Callable[..., None]
    delete_entity: Callable[..., dict[str, Any]]
    write_perf_summary: Callable[..., dict[str, Any]]


def upsert_occupancy_record(conn, occupancy):
    return upsert_occupancy_record_repository(conn, occupancy, occupancy_structured_values)


def write_occupancy_entity_state(method, item_id, payload, actor, spec, ports):
    started_at = time.perf_counter()
    updated_at = datetime.now(UTC).isoformat()
    status = HTTPStatus.OK
    with connect_db() as conn:
        old_state = assemble_state(conn) or empty_state()
        state = json.loads(json.dumps(old_state))
        old_item = next((item for item in old_state.get("occupancies", []) if item.get("id") == item_id), None)
        item = ports.normalize_entity_payload("occupancies", payload, item_id, method, spec["id_prefix"])
        item["updatedAt"] = updated_at
        if method == "POST":
            ports.insert_entity(state, "occupancies", item)
            status = HTTPStatus.CREATED
        elif method == "PUT":
            require_current_version(old_item or {}, payload.get("expectedUpdatedAt"), "笼位占用记录")
            ports.replace_entity(state, "occupancies", item_id, item)
        elif method == "DELETE":
            item = ports.delete_entity(state, "occupancies", item_id)
        else:
            raise ValueError("Unsupported entity write method")

        affected_slot_ids = {clean_text((old_item or {}).get("slotId", "")), clean_text((item or {}).get("slotId", ""))}
        affected_slot_ids.discard("")
        sync_slot_statuses(state)
        validate_state_write_permission(actor, old_state, state)
        events = build_audit_events(actor, old_state, state, updated_at)
        applications_by_iacuc = read_applications_by_iacuc(conn)
        saved_item = None
        if method == "DELETE":
            conn.execute("DELETE FROM occupancies WHERE id = ?", (item_id,))
        else:
            saved_item = next(
                (entry for entry in state.get("occupancies", []) if entry.get("id") == item.get("id")), item
            )
            saved_item = occupancy_with_snapshots(saved_item, state, applications_by_iacuc)
            upsert_occupancy_record(conn, saved_item)

        affected_slots = [slot for slot in state.get("slots", []) if slot.get("id") in affected_slot_ids]
        for slot in affected_slots:
            update_slot_record(conn, slot)
        write_audit_events(conn, events)
        conn.commit()

    invalidate_data_cache("assembled_state")
    invalidate_data_cache_prefixes("bootstrap_summary::", "billing_occupancies::")
    response_item = item if method == "DELETE" else saved_item
    response = {
        "item": response_item,
        "affectedSlots": affected_slots,
        "updatedAt": updated_at,
        "auditLogs": merge_audit_logs([], events),
        "perf": ports.write_perf_summary(started_at, rows_changed=1 + len(affected_slots), method=method),
    }
    log_perf("occupancy.save", started_at, method=method, slot_count=len(affected_slots))
    return response, status
