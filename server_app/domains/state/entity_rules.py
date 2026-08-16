"""Pure state entity normalization and reference validation rules."""

from collections.abc import Callable

from server_app.shared import as_int


def normalize_entity_batch(collection, items, method, normalize_payload: Callable):
    if items is None:
        return []
    if not isinstance(items, list):
        raise ValueError("批量保存内容必须是数组")
    id_prefix = {"rooms": "room", "racks": "rack", "slots": "slot"}[collection]
    return [
        normalize_payload(collection, item, item.get("id") if isinstance(item, dict) else None, method, id_prefix)
        for item in items
    ]


def normalize_id_batch(items, label):
    if items is None:
        return []
    if not isinstance(items, list):
        raise ValueError(f"{label} 必须是数组")
    return [str(item) for item in items if str(item).strip()]


def validate_infrastructure_slot_deletes(state, slot_ids):
    if not slot_ids:
        return
    deleting = set(slot_ids)
    active = [
        item
        for item in state.get("occupancies", [])
        if item.get("slotId") in deleting and item.get("status") in ("active", "reserved")
    ]
    if active:
        raise ValueError("不能移除仍在用或已预约的笼位")


def empty_state():
    return {
        "baseRate": 4.5,
        "billingMonth": "",
        "billingIacuc": "",
        "rooms": [],
        "racks": [],
        "slots": [],
        "occupancies": [],
        "placementTasks": [],
        "billingRules": [],
        "adjustments": [],
        "intakeBatches": [],
        "auditLogs": [],
    }


def normalize_entity_payload(collection, payload, item_id, method, id_prefix, new_id: Callable):
    if method == "DELETE":
        return {}
    if not isinstance(payload, dict):
        raise ValueError("Request body must be a JSON object")
    item = dict(payload.get("item") if isinstance(payload.get("item"), dict) else payload)
    if method == "POST":
        item["id"] = str(item.get("id") or new_id(id_prefix))
    else:
        if not item_id:
            raise ValueError("Entity id is required")
        item["id"] = item_id
    validate_entity_payload(collection, item)
    return item


def validate_entity_payload(collection, item):
    if not item.get("id"):
        raise ValueError("实体 id 不能为空")
    required = {
        "rooms": (("name", "饲养间名称不能为空"),),
        "racks": (("roomId", "笼架必须关联饲养间"), ("name", "笼架名称不能为空")),
        "occupancies": (("slotId", "占用记录必须关联笼位"),),
        "placementTasks": (
            ("sourceBatchId", "来源批次不能为空"),
            ("sourceReceiptId", "来源接收记录不能为空"),
            ("plannedMoveInDate", "计划入驻日期不能为空"),
        ),
        "billingRules": (("unit", "计费规则单位不能为空"),),
        "adjustments": (("targetType", "减免规则目标类型不能为空"), ("targetId", "减免规则目标不能为空")),
        "intakeBatches": (
            ("supplier", "购买单位不能为空"),
            ("iacuc", "IACUC 编号不能为空"),
            ("pi", "项目负责人不能为空"),
            ("owner", "实验负责人不能为空"),
            ("roomName", "房间不能为空"),
            ("intakeDate", "接收日期不能为空"),
            ("status", "批次状态不能为空"),
        ),
    }
    for key, message in required.get(collection, ()):
        require_text(item, key, message)
    if collection == "slots":
        require_text(item, "rackId", "笼位必须关联笼架")
        if item.get("status", "empty") not in ("empty", "reserved", "active"):
            raise ValueError("笼位状态只能是 empty、reserved 或 active")
    elif collection == "occupancies" and item.get("status") not in ("reserved", "active", "ended"):
        raise ValueError("占用状态只能是 reserved、active 或 ended")
    elif collection == "placementTasks" and item.get("status") not in ("pending", "reserved", "active", "cancelled"):
        raise ValueError("待进驻状态只能是 pending、reserved、active 或 cancelled")
    elif collection == "intakeBatches":
        quantity = as_int(item.get("quantity"))
        if quantity is not None and quantity <= 0:
            raise ValueError("动物数量必须大于 0")


def require_text(item, key, message):
    if not str(item.get(key, "")).strip():
        raise ValueError(message)


def validate_entity_references(state, collection, item):
    if collection == "racks" and not entity_exists(state, "rooms", item.get("roomId")):
        raise ValueError("关联的饲养间不存在")
    if collection == "slots" and not entity_exists(state, "racks", item.get("rackId")):
        raise ValueError("关联的笼架不存在")
    if collection == "occupancies" and not entity_exists(state, "slots", item.get("slotId")):
        raise ValueError("关联的笼位不存在")
    if (
        collection == "placementTasks"
        and item.get("targetRoomId")
        and not entity_exists(state, "rooms", item.get("targetRoomId"))
    ):
        raise ValueError("关联的目标饲养间不存在")


def entity_exists(state, collection, item_id):
    return any(item.get("id") == item_id for item in state.get(collection, []))
