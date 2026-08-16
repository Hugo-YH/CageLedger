"""Intake batch application transactions."""

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
from server_app.domains.state.audit_diff import build_audit_events, validate_state_write_permission
from server_app.domains.state.entity_rules import empty_state
from server_app.domains.state.persistence import assemble_state
from server_app.repositories.entities import (
    delete_intake_batch as delete_intake_batch_repository,
)
from server_app.repositories.entities import (
    delete_placement_task as delete_placement_task_repository,
)
from server_app.repositories.entities import (
    upsert_intake_batch as upsert_intake_batch_repository,
)
from server_app.repositories.entities import (
    upsert_placement_task as upsert_placement_task_repository,
)
from server_app.shared import clean_text
from server_app.shared.concurrency import require_current_version


@dataclass(frozen=True)
class IntakeCommandPorts:
    normalize_entity_payload: Callable[..., dict[str, Any]]
    insert_entity: Callable[..., None]
    replace_entity: Callable[..., None]
    delete_entity: Callable[..., dict[str, Any]]
    confirm_intake_receipt: Callable[..., tuple]
    write_perf_summary: Callable[..., dict[str, Any]]


def write_intake_batch_entity_state(method, item_id, payload, actor, spec, ports):
    started_at = time.perf_counter()
    updated_at = datetime.now(UTC).isoformat()
    status = HTTPStatus.OK
    with connect_db() as conn:
        old_state = assemble_state(conn) or empty_state()
        state = json.loads(json.dumps(old_state))
        item = ports.normalize_entity_payload("intakeBatches", payload, item_id, method, spec["id_prefix"])
        item["updatedAt"] = updated_at
        if method == "POST":
            ports.insert_entity(state, "intakeBatches", item)
            status = HTTPStatus.CREATED
        elif method == "PUT":
            existing = next((entry for entry in old_state.get("intakeBatches", []) if entry.get("id") == item_id), None)
            require_current_version(existing or {}, payload.get("expectedUpdatedAt"), "待接收批次")
            ports.replace_entity(state, "intakeBatches", item_id, item)
        elif method == "DELETE":
            item = ports.delete_entity(state, "intakeBatches", item_id)
        else:
            raise ValueError("Unsupported entity write method")

        validate_state_write_permission(actor, old_state, state)
        events = build_audit_events(actor, old_state, state, updated_at)
        if method == "DELETE":
            delete_intake_batch_repository(conn, item_id)
            conn.execute("DELETE FROM placement_tasks WHERE source_batch_id = ?", (item_id,))
        else:
            saved_item = next(
                (entry for entry in state.get("intakeBatches", []) if entry.get("id") == item.get("id")), item
            )
            upsert_intake_batch_repository(conn, saved_item)
            item = saved_item
            next_task_ids = {
                task.get("id")
                for task in state.get("placementTasks", [])
                if task.get("sourceBatchId") == item.get("id")
            }
            old_task_ids = {
                task.get("id")
                for task in old_state.get("placementTasks", [])
                if task.get("sourceBatchId") == item.get("id")
            }
            for task_id in sorted(old_task_ids - next_task_ids):
                delete_placement_task_repository(conn, task_id)
            for task in state.get("placementTasks", []):
                if task.get("sourceBatchId") == item.get("id"):
                    upsert_placement_task_repository(conn, task)
        write_audit_events(conn, events)
        conn.commit()

    invalidate_data_cache("assembled_state")
    invalidate_data_cache_prefixes(
        "bootstrap_summary::",
        "billing_occupancies::",
        "intake_batches::",
        "placement_tasks::",
        "dashboard_overview::",
    )
    response = {
        "item": item,
        "updatedAt": updated_at,
        "auditLogs": merge_audit_logs([], events),
        "perf": ports.write_perf_summary(started_at, rows_changed=1, method=method),
    }
    if method != "DELETE":
        response["placementTasks"] = [
            task for task in state.get("placementTasks", []) if task.get("sourceBatchId") == item.get("id")
        ]
        response["perf"] = ports.write_perf_summary(
            started_at, rows_changed=1 + len(response["placementTasks"]), method=method
        )
    log_perf("intake_batch.save", started_at, method=method, tasks=len(response.get("placementTasks", [])))
    return response, status


def persist_intake_receipt_confirmation(batch_id, body, actor, ports):
    started_at = time.perf_counter()
    updated_at = datetime.now(UTC).isoformat()
    with connect_db() as conn:
        old_state = assemble_state(conn) or empty_state()
        state = json.loads(json.dumps(old_state))
        batch, receipt, tasks = ports.confirm_intake_receipt(state, batch_id, body, actor)
        events = build_audit_events(actor, old_state, state, updated_at)
        upsert_intake_batch_repository(conn, batch)
        for task in tasks:
            upsert_placement_task_repository(conn, task)
        write_audit_events(conn, events)
        conn.commit()
    invalidate_data_cache("assembled_state")
    invalidate_data_cache_prefixes(
        "bootstrap_summary::",
        "billing_occupancies::",
        "intake_batches::",
        "placement_tasks::",
        "dashboard_overview::",
    )
    log_perf("intake_batch.confirm", started_at, tasks=len(tasks))
    return {
        "batch": batch,
        "receipt": receipt,
        "tasks": tasks,
        "updatedAt": updated_at,
        "auditLogs": merge_audit_logs([], events),
        "perf": ports.write_perf_summary(started_at, rows_changed=1 + len(tasks), tasks=len(tasks)),
    }


def intake_batch_action_ids(body):
    raw_ids = body.get("ids")
    if not isinstance(raw_ids, list):
        raise ValueError("请选择待处理批次")
    ids = []
    for raw_id in raw_ids:
        batch_id = clean_text(raw_id)
        if batch_id and batch_id not in ids:
            ids.append(batch_id)
    if not ids:
        raise ValueError("请选择待处理批次")
    return ids


def persist_intake_batches_mark_printed(body, actor, ports):
    started_at = time.perf_counter()
    batch_ids = intake_batch_action_ids(body)
    updated_at = datetime.now(UTC).isoformat()
    with connect_db() as conn:
        old_state = assemble_state(conn) or empty_state()
        state = json.loads(json.dumps(old_state))
        batches_by_id = {batch.get("id"): batch for batch in state.get("intakeBatches", [])}
        missing_ids = [batch_id for batch_id in batch_ids if batch_id not in batches_by_id]
        if missing_ids:
            raise LookupError("待接收批次不存在")
        batches = [
            batches_by_id[batch_id]
            for batch_id in batch_ids
            if batches_by_id[batch_id].get("status") in ("draft", "pending_print")
        ]
        for batch in batches:
            batch["status"] = "printed"
            batch["updatedAt"] = updated_at
        validate_state_write_permission(actor, old_state, state)
        events = build_audit_events(actor, old_state, state, updated_at)
        for batch in batches:
            upsert_intake_batch_repository(conn, batch)
        write_audit_events(conn, events)
        conn.commit()
    invalidate_data_cache("assembled_state")
    invalidate_data_cache_prefixes(
        "bootstrap_summary::",
        "billing_occupancies::",
        "intake_batches::",
        "placement_tasks::",
        "dashboard_overview::",
    )
    log_perf("intake_batch.mark_printed", started_at, batches=len(batches))
    return {
        "items": batches,
        "updatedAt": updated_at,
        "auditLogs": merge_audit_logs([], events),
        "perf": ports.write_perf_summary(started_at, rows_changed=len(batches), batches=len(batches)),
    }


def persist_intake_receipt_confirmations(body, actor, ports):
    started_at = time.perf_counter()
    batch_ids = intake_batch_action_ids(body)
    updated_at = datetime.now(UTC).isoformat()
    with connect_db() as conn:
        old_state = assemble_state(conn) or empty_state()
        state = json.loads(json.dumps(old_state))
        batches_by_id = {batch.get("id"): batch for batch in state.get("intakeBatches", [])}
        missing_ids = [batch_id for batch_id in batch_ids if batch_id not in batches_by_id]
        if missing_ids:
            raise LookupError("待接收批次不存在")
        batches = [
            batches_by_id[batch_id] for batch_id in batch_ids if batches_by_id[batch_id].get("status") == "printed"
        ]
        for batch in batches:
            batch["status"] = "received"
            batch["updatedAt"] = updated_at
        events = build_audit_events(actor, old_state, state, updated_at)
        for batch in batches:
            upsert_intake_batch_repository(conn, batch)
        write_audit_events(conn, events)
        conn.commit()
    invalidate_data_cache("assembled_state")
    invalidate_data_cache_prefixes(
        "bootstrap_summary::",
        "billing_occupancies::",
        "intake_batches::",
        "placement_tasks::",
        "dashboard_overview::",
    )
    log_perf("intake_batch.confirm_many", started_at, batches=len(batches), tasks=0)
    return {
        "batches": batches,
        "receipts": [],
        "tasks": [],
        "updatedAt": updated_at,
        "auditLogs": merge_audit_logs([], events),
        "perf": ports.write_perf_summary(started_at, rows_changed=len(batches), batches=len(batches), tasks=0),
    }
