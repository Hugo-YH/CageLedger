def sync_slot_statuses(state):
    status_by_slot = {
        item.get("slotId"): item.get("status")
        for item in state.get("occupancies", [])
        if item.get("status") in ("active", "reserved")
    }
    state["slots"] = [
        {**slot, "status": status_by_slot.get(slot.get("id"), "empty")}
        for slot in state.get("slots", [])
    ]


def ensure_task_room_permission(actor, task):
    if actor.get("role") == "admin":
        return
    if task.get("targetRoomId") not in set(actor.get("roomIds", [])):
        raise PermissionError("不能操作未授权饲养间的待进驻任务")


def reserve_placement_task(state, task_id, slot_id, actor, deps):
    task = next((item for item in state.get("placementTasks", []) if item.get("id") == task_id), None)
    if not task:
        raise LookupError("待进驻任务不存在")
    ensure_task_room_permission(actor, task)
    if task.get("status") not in ("pending", "reserved"):
        raise ValueError("当前任务不能预留笼位")
    slot = next((item for item in state.get("slots", []) if item.get("id") == slot_id), None)
    if not slot:
        raise LookupError("笼位不存在")
    rack = next((item for item in state.get("racks", []) if item.get("id") == slot.get("rackId")), None)
    if not rack or rack.get("roomId") != task.get("targetRoomId"):
        raise ValueError("只能在目标饲养间内预留笼位")
    if any(item.get("slotId") == slot_id and item.get("status") in ("reserved", "active") for item in state.get("occupancies", [])):
        raise ValueError("该笼位当前不可用")
    now = deps["now_iso"]()
    occupancy = {
        "id": deps["new_id"]("occ"),
        "slotId": slot_id,
        "cageCode": "",
        "status": "reserved",
        "iacuc": task.get("iacuc", ""),
        "project": task.get("project", ""),
        "pi": task.get("pi", ""),
        "owner": task.get("owner", ""),
        "species": task.get("species", ""),
        "animalCount": task.get("animalCount"),
        "startDate": "",
        "endDate": "",
        "notes": f"来自待进驻任务 {task.get('batchNo', '')}",
        "placementTaskId": task["id"],
        "updatedAt": now,
    }
    state.setdefault("occupancies", []).append(occupancy)
    task["status"] = "reserved"
    task["reservedOccupancyId"] = occupancy["id"]
    task["updatedAt"] = now
    sync_slot_statuses(state)
    return task, occupancy


def move_in_placement_task(state, task_id, actual_move_in_date, actor, deps):
    task = next((item for item in state.get("placementTasks", []) if item.get("id") == task_id), None)
    if not task:
        raise LookupError("待进驻任务不存在")
    ensure_task_room_permission(actor, task)
    if task.get("status") != "reserved":
        raise ValueError("请先为待进驻任务预留笼位")
    occupancy = next((item for item in state.get("occupancies", []) if item.get("id") == task.get("reservedOccupancyId")), None)
    if not occupancy:
        raise LookupError("预留占用不存在")
    move_in_date = deps["clean_text"](actual_move_in_date)
    if not move_in_date:
        raise ValueError("实际入驻日期不能为空")
    occupancy["status"] = "active"
    occupancy["startDate"] = move_in_date
    occupancy["updatedAt"] = deps["now_iso"]()
    task["status"] = "active"
    task["actualMoveInDate"] = move_in_date
    task["updatedAt"] = occupancy["updatedAt"]
    sync_slot_statuses(state)
    return task, occupancy


def reassign_placement_task_room(state, task_id, room_id, actor, deps):
    if actor.get("role") != "admin":
        raise PermissionError("只有系统管理员可以改签目标房间")
    task = next((item for item in state.get("placementTasks", []) if item.get("id") == task_id), None)
    if not task:
        raise LookupError("待进驻任务不存在")
    if task.get("status") == "active":
        raise ValueError("已入驻任务不能改签房间")
    room = next((item for item in state.get("rooms", []) if item.get("id") == room_id), None)
    if not room:
        raise LookupError("目标饲养间不存在")
    if task.get("reservedOccupancyId"):
        raise ValueError("已预留笼位的任务需先取消预留后再改签")
    if task.get("targetRoomId") == room_id:
        return task
    task.setdefault("roomChangeHistory", []).append(
        {
            "fromRoomId": task.get("targetRoomId", ""),
            "fromRoomName": task.get("targetRoomName", ""),
            "toRoomId": room["id"],
            "toRoomName": room["name"],
            "changedAt": deps["now_iso"](),
            "changedBy": actor.get("displayName", ""),
        }
    )
    task["targetRoomId"] = room["id"]
    task["targetRoomName"] = room["name"]
    task["updatedAt"] = deps["now_iso"]()
    return task
