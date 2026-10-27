"""In-memory entity aggregate mutations."""

import sqlite3

from server_app.domains.cages import sync_slot_statuses
from server_app.domains.intake import collect_cage_card_qr_ids, is_cage_card_qr_id, next_cage_card_qr_id
from server_app.domains.intake.calendar_batch import normalize_calendar_batch
from server_app.domains.intake.purpose import intake_purpose, is_direct_sampling
from server_app.domains.state.entity_rules import (
    normalize_entity_batch as normalize_entity_batch_rule,
)
from server_app.domains.state.entity_rules import (
    normalize_entity_payload as normalize_entity_payload_rule,
)
from server_app.domains.state.entity_rules import validate_entity_payload, validate_entity_references
from server_app.shared import as_int, clean_text, new_id, now_iso


def normalize_entity_batch(collection, items, method):
    return normalize_entity_batch_rule(collection, items, method, normalize_entity_payload)


def normalize_entity_payload(collection, payload, item_id, method, id_prefix):
    return normalize_entity_payload_rule(collection, payload, item_id, method, id_prefix, new_id)


def insert_entity(state, collection, item):
    items = state.setdefault(collection, [])
    if any(existing.get("id") == item["id"] for existing in items):
        raise sqlite3.IntegrityError(f"Duplicate id: {item['id']}")
    if collection == "intakeBatches":
        item = normalize_direct_sampling_batch(item)
        if is_direct_sampling(item) and item.get("status") not in ("draft", "pending_receipt"):
            raise ValueError("直接取材批次初建只能是草稿或待接收")
        item = ensure_intake_batch_card_qr_ids(state, item)
    validate_entity_references(state, collection, item)
    items.append(item)


def intake_card_suggested_quantity(batch, index, card_count):
    per_cage = max(as_int(batch.get("suggestedAnimalsPerCage")) or 1, 1)
    quantity = max(as_int(batch.get("quantity")) or 0, 0)
    remainder = quantity % per_cage if quantity and per_cage else 0
    is_last = index == card_count - 1
    if not quantity or (remainder and is_last):
        return ""
    return str(per_cage)


def ensure_intake_batch_card_qr_ids(state, batch):
    next_batch = dict(batch)
    if is_direct_sampling(next_batch):
        return normalize_direct_sampling_batch(next_batch)
    card_count = max(as_int(next_batch.get("finalCardCount")) or as_int(next_batch.get("suggestedCardCount")) or 0, 0)
    existing_cards = next_batch.get("cards") if isinstance(next_batch.get("cards"), list) else []
    used_qr_ids = collect_cage_card_qr_ids(state, next_batch.get("id", ""))
    cards = []
    for index in range(card_count):
        existing = (
            existing_cards[index] if index < len(existing_cards) and isinstance(existing_cards[index], dict) else {}
        )
        existing_qr_id = clean_text(existing.get("qrId")).upper()
        qr_id = (
            existing_qr_id
            if is_cage_card_qr_id(existing_qr_id) and existing_qr_id not in used_qr_ids
            else next_cage_card_qr_id(used_qr_ids)
        )
        used_qr_ids.add(qr_id)
        cards.append(
            {
                **existing,
                "id": clean_text(existing.get("id")) or f"{next_batch.get('id')}-card-{index + 1}",
                "index": index + 1,
                "label": f"{index + 1}/{card_count}",
                "suggestedQuantity": clean_text(existing.get("suggestedQuantity"))
                or intake_card_suggested_quantity(next_batch, index, card_count),
                "qrId": qr_id,
            }
        )
    next_batch["cards"] = cards
    return next_batch


def normalize_direct_sampling_batch(batch):
    next_batch = normalize_calendar_batch(batch)
    next_batch["intakePurpose"] = intake_purpose(next_batch)
    if not is_direct_sampling(next_batch):
        return next_batch
    if not clean_text(next_batch.get("status")):
        next_batch["status"] = "pending_receipt"
    next_batch.update(
        {
            "roomName": "",
            "endDate": "",
            "husbandryDays": None,
            "suggestedCardCount": 0,
            "finalCardCount": 0,
            "confirmedCardCount": 0,
            "remainingCardCount": 0,
            "cards": [],
        }
    )
    return next_batch


def intake_batch_activity(state, batch_id):
    tasks = [task for task in state.get("placementTasks", []) if task.get("sourceBatchId") == batch_id]
    task_ids = {task.get("id") for task in tasks}
    occupancies = [
        occupancy
        for occupancy in state.get("occupancies", [])
        if occupancy.get("sourceBatchId") == batch_id or occupancy.get("placementTaskId") in task_ids
    ]
    return tasks, occupancies


def validate_intake_batch_transition(old_state, old_item, next_item):
    old_purpose = intake_purpose(old_item or {})
    next_purpose = intake_purpose(next_item)
    if (
        next_purpose == "housing"
        and clean_text(next_item.get("status")) == "pending_receipt"
        and (not old_item or old_purpose != "housing" or clean_text(old_item.get("status")) != "pending_receipt")
    ):
        raise ValueError("普通饲养批次不能使用待接收状态")
    if old_item and old_purpose != next_purpose:
        tasks, occupancies = intake_batch_activity(old_state, old_item.get("id"))
        if (
            clean_text(old_item.get("status")) in ("printed", "received")
            or old_item.get("receipts")
            or tasks
            or occupancies
        ):
            raise ValueError("已打印、已接收或已有接收/待进驻/占用记录的批次不能转换接收用途")
    if (
        next_purpose == "direct_sampling"
        and clean_text(next_item.get("status")) == "received"
        and (not old_item or clean_text(old_item.get("status")) != "received")
    ):
        raise ValueError("直接取材批次只能通过确认接收操作进入已接收")


def normalize_intake_batches_for_state_write(old_state, state):
    old_batches = {item.get("id"): item for item in old_state.get("intakeBatches", [])}
    batches = []
    for raw_batch in state.get("intakeBatches", []):
        old_item = old_batches.get(raw_batch.get("id"))
        batch = dict(raw_batch)
        if old_item and is_direct_sampling(old_item) and "intakePurpose" not in batch:
            batch["intakePurpose"] = intake_purpose(old_item)
        if batch.get("intakePurpose", "housing") not in ("housing", "direct_sampling"):
            raise ValueError("接收用途只能是 housing 或 direct_sampling")
        if is_direct_sampling(batch):
            batch = normalize_direct_sampling_batch(batch)
            validate_entity_payload("intakeBatches", batch)
        elif old_item and is_direct_sampling(old_item):
            validate_entity_payload("intakeBatches", batch)
        batch = normalize_calendar_batch(batch, old_item)
        # Legacy snapshots can contain incomplete housing batches. Do not backfill
        # or revalidate those unrelated records while protecting the new purpose.
        validate_intake_batch_transition(old_state, old_item, batch)
        batches.append(batch)
    state["intakeBatches"] = batches
    direct_ids = {batch.get("id") for batch in batches if is_direct_sampling(batch)}
    direct_task_ids = {
        task.get("id")
        for task in [*old_state.get("placementTasks", []), *state.get("placementTasks", [])]
        if task.get("sourceBatchId") in direct_ids
    }
    if any(task.get("sourceBatchId") in direct_ids for task in state.get("placementTasks", [])):
        raise ValueError("直接取材批次不能创建待进驻任务")
    if any(
        occupancy.get("sourceBatchId") in direct_ids or occupancy.get("placementTaskId") in direct_task_ids
        for occupancy in state.get("occupancies", [])
    ):
        raise ValueError("直接取材批次不能创建占用记录")
    return state


def reconcile_intake_batch_update(state, old_item, item):
    item = normalize_calendar_batch(item, old_item)
    next_item = {**old_item, **item}
    next_item["intakePurpose"] = intake_purpose(next_item)
    validate_intake_batch_transition(state, old_item, next_item)
    next_item = normalize_direct_sampling_batch(next_item)
    next_item["receipts"] = [
        dict(receipt)
        for receipt in (
            item.get("receipts") if isinstance(item.get("receipts"), list) else old_item.get("receipts", [])
        )
    ]
    final_count = max(as_int(next_item.get("finalCardCount")) or 0, 0)
    confirmed_count = max(
        as_int(next_item.get("confirmedCardCount"))
        or sum(max(as_int(receipt.get("cardCount")) or 0, 0) for receipt in next_item.get("receipts", [])),
        0,
    )
    next_item["confirmedCardCount"] = confirmed_count
    next_item["remainingCardCount"] = max(final_count - confirmed_count, 0)

    old_status = clean_text(old_item.get("status", ""))
    new_status = clean_text(next_item.get("status", ""))
    old_room_name = clean_text(old_item.get("roomName", ""))
    new_room_name = clean_text(next_item.get("roomName", ""))
    if old_status == "received" and new_status == "printed":
        related_tasks = [
            task for task in state.get("placementTasks", []) if task.get("sourceBatchId") == old_item.get("id")
        ]
        blocking = [task for task in related_tasks if task.get("status") in ("reserved", "active")]
        if blocking:
            raise ValueError("该批次已有已预留或已入驻的待进驻任务，请先处理相关任务后再回退为已打印")
        state["placementTasks"] = [
            task for task in state.get("placementTasks", []) if task.get("sourceBatchId") != old_item.get("id")
        ]
        next_item["receipts"] = []
        next_item["confirmedCardCount"] = 0
        next_item["remainingCardCount"] = final_count
    if old_room_name != new_room_name:
        related_tasks = [
            task for task in state.get("placementTasks", []) if task.get("sourceBatchId") == old_item.get("id")
        ]
        blocking = [task for task in related_tasks if task.get("status") in ("reserved", "active")]
        if blocking:
            raise ValueError("该批次已有已预留或已入驻的待进驻任务，请先处理相关任务后再调整房间")
        target_room = (
            next((room for room in state.get("rooms", []) if clean_text(room.get("name", "")) == new_room_name), None)
            if new_room_name
            else None
        )
        if related_tasks and new_room_name and not target_room:
            raise ValueError("房间尚未在系统中配置，请先选择已配置饲养间后再保存")
        for task in related_tasks:
            task["targetRoomId"] = target_room.get("id", "") if target_room else ""
            task["targetRoomName"] = target_room.get("name", "") if target_room else new_room_name
            task["updatedAt"] = next_item.get("updatedAt") or now_iso()
    return ensure_intake_batch_card_qr_ids(state, next_item)


def replace_entity(state, collection, item_id, item):
    items = state.setdefault(collection, [])
    for index, existing in enumerate(items):
        if existing.get("id") == item_id:
            if collection == "intakeBatches":
                item = reconcile_intake_batch_update(state, existing, item)
            validate_entity_references(state, collection, item)
            items[index] = item
            return
    raise LookupError("实体不存在")


def delete_entity(state, collection, item_id):
    items = state.setdefault(collection, [])
    deleted = None
    kept = []
    for item in items:
        if item.get("id") == item_id:
            deleted = item
        else:
            kept.append(item)
    if deleted is None:
        raise LookupError("实体不存在")
    state[collection] = kept

    if collection == "rooms":
        rack_ids = {rack.get("id") for rack in state.get("racks", []) if rack.get("roomId") == item_id}
        state["racks"] = [rack for rack in state.get("racks", []) if rack.get("roomId") != item_id]
        state["slots"] = [slot for slot in state.get("slots", []) if slot.get("rackId") not in rack_ids]
    elif collection == "racks":
        state["slots"] = [slot for slot in state.get("slots", []) if slot.get("rackId") != item_id]
    elif collection == "placementTasks":
        reserved_occupancy_id = clean_text(deleted.get("reservedOccupancyId", ""))
        task_status = clean_text(deleted.get("status", ""))
        if task_status == "active":
            raise ValueError("已正式入驻的待进驻任务不能直接删除")
        if reserved_occupancy_id:
            state["occupancies"] = [
                item for item in state.get("occupancies", []) if item.get("id") != reserved_occupancy_id
            ]
            sync_slot_statuses(state)

    return deleted
