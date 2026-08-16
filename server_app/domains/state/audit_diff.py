"""Pure permission diff and audit event construction for aggregate state writes."""

from server_app.domains.administration import action_label, audit_event


def comparable_items(items):
    return {item.get("id"): item for item in items}


def changed_keys(old_items, new_items):
    return {key for key in set(old_items) | set(new_items) if old_items.get(key) != new_items.get(key)}


def slot_room_map(state):
    rack_rooms = {rack.get("id"): rack.get("roomId") for rack in state.get("racks", [])}
    return {slot.get("id"): rack_rooms.get(slot.get("rackId")) for slot in state.get("slots", [])}


def rack_room_map(*states):
    rooms = {}
    for state in states:
        rooms.update({rack.get("id"): rack.get("roomId") for rack in state.get("racks", [])})
    return rooms


def slot_label_map(state):
    rack_by_id = {rack.get("id"): rack for rack in state.get("racks", [])}
    room_by_id = {room.get("id"): room for room in state.get("rooms", [])}
    labels = {}
    for slot in state.get("slots", []):
        rack = rack_by_id.get(slot.get("rackId"), {})
        room = room_by_id.get(rack.get("roomId"), {})
        index = rack.get("index", "")
        code = str(index).zfill(2) if str(index).isdigit() else str(index)
        labels[slot.get("id")] = f"{room.get('name', '')}-{code}-{slot.get('code', '')}".strip("-")
    return labels


def validate_state_write_permission(actor, old_state, new_state):
    if actor["role"] == "admin":
        return
    allowed_rooms = set(actor.get("roomIds", []))
    if not allowed_rooms:
        raise PermissionError("当前账号没有可编辑的饲养间")
    old_rooms = {item.get("id"): item for item in old_state.get("rooms", [])}
    new_rooms = {item.get("id"): item for item in new_state.get("rooms", [])}
    if set(old_rooms) != set(new_rooms):
        raise PermissionError("房间管理员不能新增或删除饲养间")
    for room_id in changed_keys(old_rooms, new_rooms):
        if room_id not in allowed_rooms:
            raise PermissionError("不能修改未授权饲养间配置")
        old_room, new_room = old_rooms.get(room_id, {}), new_rooms.get(room_id, {})
        changed = {key for key in set(old_room) | set(new_room) if old_room.get(key) != new_room.get(key)}
        if not changed.issubset({"rackCount"}):
            raise PermissionError("房间管理员不能修改饲养间基础信息")
    old_racks = {item.get("id"): item for item in old_state.get("racks", [])}
    new_racks = {item.get("id"): item for item in new_state.get("racks", [])}
    rack_rooms = rack_room_map(old_state, new_state)
    for rack_id in changed_keys(old_racks, new_racks):
        if rack_rooms.get(rack_id) not in allowed_rooms:
            raise PermissionError("不能修改未授权饲养间的笼架配置")
    if comparable_items(old_state.get("billingRules", [])) != comparable_items(new_state.get("billingRules", [])):
        raise PermissionError("房间管理员不能修改计费规则")
    if old_state.get("baseRate") != new_state.get("baseRate"):
        raise PermissionError("房间管理员不能修改计费规则")
    if comparable_items(old_state.get("adjustments", [])) != comparable_items(new_state.get("adjustments", [])):
        raise PermissionError("房间管理员不能修改减免规则")
    old_slots = {item.get("id"): item for item in old_state.get("slots", [])}
    new_slots = {item.get("id"): item for item in new_state.get("slots", [])}
    slot_rooms, old_slot_rooms = slot_room_map(new_state), slot_room_map(old_state)
    for slot_id in changed_keys(old_slots, new_slots):
        if (slot_rooms.get(slot_id) or old_slot_rooms.get(slot_id)) not in allowed_rooms:
            raise PermissionError("不能修改未授权饲养间的笼位结构")
    for slot_id, new_slot in new_slots.items():
        old_slot = dict(old_slots.get(slot_id, {}))
        if not old_slot:
            continue
        old_shape = {key: value for key, value in old_slot.items() if key != "status"}
        new_shape = {key: value for key, value in new_slot.items() if key != "status"}
        if old_shape != new_shape and slot_rooms.get(slot_id) not in allowed_rooms:
            raise PermissionError("房间管理员不能修改笼位结构")
        if old_slot.get("status") != new_slot.get("status") and slot_rooms.get(slot_id) not in allowed_rooms:
            raise PermissionError("不能修改未授权饲养间的笼位状态")
    old_occupancies = {item.get("id"): item for item in old_state.get("occupancies", [])}
    new_occupancies = {item.get("id"): item for item in new_state.get("occupancies", [])}
    for occupancy_id in changed_keys(old_occupancies, new_occupancies):
        item = new_occupancies.get(occupancy_id) or old_occupancies.get(occupancy_id) or {}
        if slot_rooms.get(item.get("slotId")) not in allowed_rooms:
            raise PermissionError("不能修改未授权饲养间的笼位信息")
    old_tasks = {item.get("id"): item for item in old_state.get("placementTasks", [])}
    new_tasks = {item.get("id"): item for item in new_state.get("placementTasks", [])}
    for task_id in changed_keys(old_tasks, new_tasks):
        item = new_tasks.get(task_id) or old_tasks.get(task_id) or {}
        if item.get("targetRoomId") not in allowed_rooms:
            raise PermissionError("不能修改未授权饲养间的待进驻任务")


def build_audit_events(actor, old_state, new_state, at):
    events = []
    labels = slot_label_map(new_state)
    _append_occupancy_events(events, actor, old_state, new_state, labels, at)
    _append_entity_events(events, actor, old_state, new_state, "rooms", "room", "饲养间", "name", at)
    _append_entity_events(
        events, actor, old_state, new_state, "intakeBatches", "intake_batch", "待接收批次", "batchNo", at
    )
    _append_entity_events(
        events, actor, old_state, new_state, "placementTasks", "placement_task", "待进驻任务", "batchNo", at
    )
    return events[:100]


def _append_occupancy_events(events, actor, old_state, new_state, labels, at):
    old_items = {item.get("id"): item for item in old_state.get("occupancies", [])}
    new_items = {item.get("id"): item for item in new_state.get("occupancies", [])}
    for item_id in sorted(changed_keys(old_items, new_items)):
        old, new = old_items.get(item_id), new_items.get(item_id)
        item = new or old or {}
        slot_id = item.get("slotId", "")
        label = labels.get(slot_id, slot_id)
        if old is None:
            action, message = "occupancy.created", f"{actor['displayName']} 新增笼位 {label} 的占用记录"
        elif new is None:
            action, message = "occupancy.deleted", f"{actor['displayName']} 删除笼位 {label} 的占用记录"
        elif new.get("status") == "ended" and new.get("endReason") == "sampled" and old.get("status") != "ended":
            action, message = (
                "occupancy.sampled",
                f"{actor['displayName']} 将笼位 {label} 标记为已取材，最后计费日期 {new.get('endDate', '')}",
            )
        elif new.get("status") == "ended" and new.get("endReason") == "cleared" and old.get("status") != "ended":
            action, message = "occupancy.cleared", f"{actor['displayName']} 将笼位 {label} 设为空"
        else:
            action, message = "occupancy.updated", f"{actor['displayName']} 更新笼位 {label} 的占用信息"
        events.append(audit_event(actor, action, "occupancy", item_id, message, [slot_id], at, old, new))


def _append_entity_events(events, actor, old_state, new_state, collection, entity_type, noun, label_key, at):
    old_items = {item.get("id"): item for item in old_state.get(collection, [])}
    new_items = {item.get("id"): item for item in new_state.get(collection, [])}
    for item_id in sorted(changed_keys(old_items, new_items)):
        old, new = old_items.get(item_id), new_items.get(item_id)
        action = (
            f"{entity_type}.created"
            if old is None
            else f"{entity_type}.deleted"
            if new is None
            else f"{entity_type}.updated"
        )
        label = (new or old or {}).get(label_key, item_id)
        message = f"{actor['displayName']} {action_label(action)}{noun} {label}"
        events.append(audit_event(actor, action, entity_type, item_id, message, [], at, old, new))
