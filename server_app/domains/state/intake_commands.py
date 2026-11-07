"""Intake batch application transactions."""

import copy
import hashlib
import time
from collections.abc import Callable
from dataclasses import dataclass
from datetime import UTC, date, datetime
from http import HTTPStatus
from typing import Any

from server_app.cache import invalidate_data_cache, invalidate_data_cache_prefixes, log_perf
from server_app.db import connect_db
from server_app.domains.administration import audit_event, merge_audit_logs, write_audit_events
from server_app.domains.intake.duplicates import (
    IntakeDuplicateConfirmationRequired,
    confirm_duplicate_identifiers,
    duplicate_confirmation_event,
)
from server_app.domains.intake.recognition_evidence import sanitize_evidence
from server_app.domains.intake.recognition_images import ImageWriteSession
from server_app.domains.intake.recognition_merge import confirmed_merge
from server_app.domains.intake.recognition_reconciliation import append_round, confirmed_supplement, preview
from server_app.domains.intake.recognition_uploads import acknowledge_saved_images, request_images
from server_app.domains.state.audit_diff import build_audit_events, validate_state_write_permission
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
from server_app.repositories.intake_transactions import read_intake_context, reserved_card_qr_ids
from server_app.shared import clean_text, new_id
from server_app.shared.concurrency import begin_write, require_current_version, require_exact_version


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
    status = HTTPStatus.OK
    images = (
        request_images(payload, actor["id"], raw_key="recognitionImages", refs_key="recognitionImageRefs")
        if method != "DELETE"
        else []
    )
    with ImageWriteSession() as image_writer, connect_db() as conn:
        image_writer.prepare(images)
        begin_write(conn)
        updated_at = datetime.now(UTC).isoformat()
        normalized_payload = dict(payload)
        raw_item = dict(payload.get("item") if isinstance(payload.get("item"), dict) else payload)
        target_id = str(raw_item.get("id") or new_id(spec["id_prefix"])) if method == "POST" else item_id
        if method == "POST":
            raw_item["id"] = target_id
        old_state = read_intake_context(conn, [target_id])
        state = copy.deepcopy(old_state)
        existing = next((entry for entry in old_state.get("intakeBatches", []) if entry.get("id") == item_id), None)
        merge_changes = None
        round_incoming = None
        review_merge = (
            isinstance(payload.get("recognitionMerge"), dict) and payload["recognitionMerge"].get("reviewVersion") == 2
        )
        if "recognitionMerge" in payload:
            if method != "PUT" or (images and not review_merge):
                raise ValueError("文字补充合并只能更新已有预约，请先核对合并预览")
            if review_merge:
                raw_item, merge_changes, round_incoming = confirmed_supplement(
                    conn, actor, existing, payload["recognitionMerge"], payload.get("expectedUpdatedAt"), images
                )
            else:
                raw_item, merge_changes = confirmed_merge(
                    conn, existing, payload["recognitionMerge"], payload.get("expectedUpdatedAt")
                )
        if method == "PUT" and existing and "orderNo" in existing and "orderNo" not in raw_item:
            raw_item["orderNo"] = existing["orderNo"]
        raw_item.pop("recognitionImages", None)
        raw_item.pop("recognitionImageRefs", None)
        # Only server-owned metadata may reference persisted images. Old clients
        # omitting provenance retain the existing record instead of removing it.
        old_recognition = (existing or {}).get("recognition") or {}
        old_images = old_recognition.get("images", []) if isinstance(old_recognition, dict) else []
        evidence = sanitize_evidence(raw_item.get("recognition") or old_recognition or None)
        raw_item.pop("recognition", None)
        if evidence is not None:
            evidence["images"] = old_images
            # Historical rounds and persisted image identities are server-owned.
            evidence.pop("recognitionRounds", None)
            if old_recognition.get("recognitionRounds"):
                evidence["recognitionRounds"] = copy.deepcopy(old_recognition["recognitionRounds"])
            if isinstance(old_recognition, dict) and old_recognition.get("imageIds"):
                evidence["imageIds"] = old_recognition["imageIds"]
            raw_item["recognition"] = evidence
        if method == "PUT" and existing and "intakePurpose" not in raw_item:
            raw_item["intakePurpose"] = existing.get("intakePurpose", "housing")
        normalized_payload["item"] = raw_item
        item = ports.normalize_entity_payload("intakeBatches", normalized_payload, item_id, method, spec["id_prefix"])
        item["updatedAt"] = updated_at
        if method == "POST":
            ports.insert_entity(state, "intakeBatches", item, used_qr_ids=reserved_card_qr_ids(conn, item["id"]))
            status = HTTPStatus.CREATED
        elif method == "PUT":
            require_current_version(existing or {}, payload.get("expectedUpdatedAt"), "待接收批次")
            ports.replace_entity(state, "intakeBatches", item_id, item, used_qr_ids=reserved_card_qr_ids(conn, item_id))
        elif method == "DELETE":
            item = ports.delete_entity(state, "intakeBatches", item_id)
        else:
            raise ValueError("Unsupported entity write method")

        validate_state_write_permission(actor, old_state, state)
        confirmation = None
        if method != "DELETE" and payload.get("checkDuplicates") is True and not review_merge:
            candidate = next(entry for entry in state["intakeBatches"] if entry.get("id") == item["id"])
            try:
                confirmation = confirm_duplicate_identifiers(
                    conn, candidate, item_id if method == "PUT" else "", payload.get("duplicateConfirmation")
                )
            except IntakeDuplicateConfirmationRequired as exc:
                if payload.get("reviewVersion") == 2:
                    exc.details["review"] = preview(
                        conn,
                        actor,
                        {"item": normalized_payload["item"], "excludeId": item_id if method == "PUT" else ""},
                        images=images,
                    )
                raise
        added_images = []
        if review_merge:
            candidate = next(entry for entry in state["intakeBatches"] if entry.get("id") == item["id"])
            metadata, added_images = image_writer.save(candidate["id"], images, old_images, updated_at, by_content=True)
            append_round(candidate, round_incoming, images, metadata, merge_changes, updated_at)
        elif images:
            candidate = next(entry for entry in state["intakeBatches"] if entry.get("id") == item["id"])
            metadata, added_images = image_writer.save(candidate["id"], images, old_images, updated_at)
            inputs = (evidence or {}).get("inputImages") or [
                {"name": image.name, "sha256": hashlib.sha256(image.body).hexdigest()} for image in images
            ]
            ordered_ids = [
                next(
                    (
                        meta["id"]
                        for meta in metadata
                        if meta["name"] == image["name"] and meta["sha256"] == image["sha256"]
                    ),
                    "",
                )
                for image in inputs
            ]
            candidate["recognition"] = {
                **(evidence or sanitize_evidence({})),
                "images": metadata,
                "imageIds": ordered_ids,
            }
            if "" in ordered_ids:
                warning = "部分识别所用原图未留档，请重新添加识别时的图片或重新识别；新添加图片不会替代旧识别依据。"
                candidate["recognition"]["warnings"] = [
                    *(evidence or {}).get("warnings", []),
                    warning,
                ]
                if review := candidate["recognition"].get("review"):
                    candidate["recognition"]["review"] = {**review, "reminders": [*review["reminders"], warning]}
        events = build_audit_events(actor, old_state, state, updated_at)
        if merge_changes is not None:
            events.append(
                audit_event(
                    actor,
                    "intake_batch.recognition_merged",
                    "intake_batch",
                    item["id"],
                    f"{actor['displayName']} 核对后补充预约图文 {item.get('batchNo', '')}"
                    if review_merge
                    else f"{actor['displayName']} 核对图片后合并预约文字 {item.get('batchNo', '')}",
                    [],
                    updated_at,
                    {"updatedAt": existing.get("updatedAt")},
                    {
                        "changes": merge_changes,
                        "rawMessage": payload["recognitionMerge"]["incoming"].get("rawMessage", ""),
                    },
                )
            )
        if confirmation:
            events.append(duplicate_confirmation_event(actor, item, confirmation, updated_at))
        if added_images:
            events.append(
                audit_event(
                    actor,
                    "intake_batch.recognition_images_added",
                    "intake_batch",
                    item["id"],
                    f"{actor['displayName']} 为待接收批次 {item.get('batchNo', '')} 留档 {len(added_images)} 张预约来源图片",
                    [],
                    updated_at,
                    None,
                    {"images": added_images},
                )
            )
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
        image_writer.committed = True
        if images:
            acknowledge_saved_images(payload, actor["id"])

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
    with connect_db() as conn:
        begin_write(conn)
        updated_at = datetime.now(UTC).isoformat()
        old_state = read_intake_context(conn, [batch_id])
        state = copy.deepcopy(old_state)
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
    with connect_db() as conn:
        begin_write(conn)
        updated_at = datetime.now(UTC).isoformat()
        old_state = read_intake_context(conn, batch_ids)
        state = copy.deepcopy(old_state)
        batches_by_id = {batch.get("id"): batch for batch in state.get("intakeBatches", [])}
        missing_ids = [batch_id for batch_id in batch_ids if batch_id not in batches_by_id]
        if missing_ids:
            raise LookupError("待接收批次不存在")
        batches = [
            batches_by_id[batch_id]
            for batch_id in batch_ids
            if batches_by_id[batch_id].get("status") in ("draft", "pending_print")
            and batches_by_id[batch_id].get("intakePurpose", "housing") != "direct_sampling"
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


def intake_receipt_dates(body, batch_ids):
    if "actualReceiptDates" not in body:
        return None
    dates = body["actualReceiptDates"]
    if not isinstance(dates, dict) or set(dates) != set(batch_ids):
        raise ValueError("请提供所选批次的完整实际接收日期")
    for value in dates.values():
        try:
            if not isinstance(value, str) or date.fromisoformat(value).isoformat() != value:
                raise ValueError("实际接收日期须为YYYY-MM-DD格式的有效日期")
        except ValueError as exc:
            raise ValueError("实际接收日期须为YYYY-MM-DD格式的有效日期") from exc
    return dates


def persist_intake_receipt_confirmations(body, actor, ports):
    started_at = time.perf_counter()
    batch_ids = intake_batch_action_ids(body)
    actual_dates = intake_receipt_dates(body, batch_ids)
    with connect_db() as conn:
        begin_write(conn)
        updated_at = datetime.now(UTC).isoformat()
        old_state = read_intake_context(conn, batch_ids)
        state = copy.deepcopy(old_state)
        batches_by_id = {batch.get("id"): batch for batch in state.get("intakeBatches", [])}
        missing_ids = [batch_id for batch_id in batch_ids if batch_id not in batches_by_id]
        if missing_ids:
            raise LookupError("待接收批次不存在")
        if "expectedVersions" in body:
            versions = body["expectedVersions"]
            if (
                not isinstance(versions, dict)
                or set(versions) != set(batch_ids)
                or any(not isinstance(value, str) for value in versions.values())
            ):
                raise ValueError("请提供所选批次的完整版本")
            for batch_id in batch_ids:
                require_exact_version(
                    batches_by_id[batch_id].get("updatedAt"),
                    versions[batch_id],
                    "所选批次已更新，请刷新列表后重新确认接收",
                )
        batches = [
            batches_by_id[batch_id]
            for batch_id in batch_ids
            if batches_by_id[batch_id].get("status") == "printed"
            and batches_by_id[batch_id].get("intakePurpose", "housing") != "direct_sampling"
            or (
                batches_by_id[batch_id].get("intakePurpose", "housing") == "direct_sampling"
                and batches_by_id[batch_id].get("status") == "pending_receipt"
            )
        ]
        receipts = []
        for batch in batches:
            if actual_dates is not None:
                actual_date = actual_dates[batch["id"]]
                existing_receipts = batch.get("receipts") or []
                if not any(
                    isinstance(receipt, dict) and receipt.get("actualReceiptDate") == actual_date
                    for receipt in existing_receipts
                ):
                    # Bulk receipt records the date only; card counts and placement
                    # remain owned by the separate card-confirmation workflow.
                    receipt = {
                        "id": new_id("receipt"),
                        "actualReceiptDate": actual_date,
                        "confirmedBy": actor.get("displayName", ""),
                        "confirmedAt": updated_at,
                    }
                    batch["receipts"] = [*existing_receipts, receipt]
                    receipts.append(receipt)
            batch["status"] = "received"
            batch["updatedAt"] = updated_at
        events = build_audit_events(
            actor, old_state, state, updated_at, limit=None if actual_dates is not None else 100
        )
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
        "receipts": receipts,
        "tasks": [],
        "updatedAt": updated_at,
        "auditLogs": merge_audit_logs([], events),
        "perf": ports.write_perf_summary(started_at, rows_changed=len(batches), batches=len(batches), tasks=0),
    }
