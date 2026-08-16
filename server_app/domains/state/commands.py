"""State aggregate command dispatch and full-state persistence transaction."""

from datetime import UTC, datetime
from http import HTTPStatus

from server_app.cache import invalidate_data_cache, invalidate_data_cache_prefixes
from server_app.db import connect_db
from server_app.domains.administration import merge_audit_logs, write_audit_events
from server_app.domains.state.audit_diff import build_audit_events, validate_state_write_permission
from server_app.domains.state.entity_mutations import (
    delete_entity,
    insert_entity,
    normalize_entity_payload,
    replace_entity,
)
from server_app.domains.state.entity_rules import empty_state
from server_app.domains.state.persistence import assemble_state, read_state, write_normalized_state
from server_app.shared import now_iso
from server_app.shared.concurrency import require_current_version


def write_state(state, actor, skip_permission=False):
    updated_at = datetime.now(UTC).isoformat()
    with connect_db() as conn:
        old_state = assemble_state(conn) or {}
        if not skip_permission:
            validate_state_write_permission(actor, old_state, state)
        events = build_audit_events(actor, old_state, state, updated_at)
        state["auditLogs"] = merge_audit_logs(state.get("auditLogs", []), events)
        write_normalized_state(conn, state, updated_at)
        write_audit_events(conn, events)
        conn.commit()
    invalidate_data_cache("assembled_state", "principal_identities")
    invalidate_data_cache_prefixes(
        "bootstrap_summary::",
        "billing_occupancies::",
        "quantity_sheets::",
        "billing_workflows::",
        "dashboard_overview::",
    )
    return {"ok": True, "updatedAt": updated_at, "auditLogs": merge_audit_logs([], events)}


def write_entity_state(endpoint, method, item_id, payload, actor, endpoints, writers):
    spec = endpoints[endpoint]
    collection = spec["collection"]
    if collection in writers:
        return writers[collection](method, item_id, payload, actor, spec)

    current = read_state()
    state = current.get("state") or empty_state()
    item = normalize_entity_payload(collection, payload, item_id, method, spec["id_prefix"])
    status = HTTPStatus.OK
    if method == "POST":
        item["updatedAt"] = now_iso()
        insert_entity(state, collection, item)
        status = HTTPStatus.CREATED
    elif method == "PUT":
        existing = next((entry for entry in state.get(collection, []) if entry.get("id") == item_id), None)
        require_current_version(existing or {}, payload.get("expectedUpdatedAt"), "该记录")
        item["updatedAt"] = now_iso()
        replace_entity(state, collection, item_id, item)
    elif method == "DELETE":
        item = delete_entity(state, collection, item_id)
    else:
        raise ValueError("Unsupported entity write method")
    result = write_state(state, actor)
    return {"item": item, "updatedAt": result["updatedAt"], "auditLogs": result["auditLogs"]}, status
