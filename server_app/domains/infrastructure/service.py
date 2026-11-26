"""Infrastructure read projections and versioned room layout updates."""

import time
from datetime import UTC, datetime, timedelta

from server_app.cache import log_perf
from server_app.domains.administration.audit import audit_event, write_audit_events
from server_app.shared.concurrency import StaleWriteError, begin_write

from . import repository as repo

RACK_LAYOUT_LIMIT = 256


def authorized_ids(actor):
    if not actor or not actor.get("id"):
        raise PermissionError("请先登录")
    return None if actor.get("role") == "admin" else [str(value) for value in actor.get("roomIds", [])]


def require_room(actor, room_id):
    allowed = authorized_ids(actor)
    if allowed is not None and room_id not in allowed:
        raise PermissionError("无权访问该饲养间")


def structure(conn, actor):
    started = time.perf_counter()
    ids = authorized_ids(actor)
    rooms = repo.rooms(conn, ids)
    racks, counts = repo.structure(conn, None if ids is None else [room["id"] for room in rooms])
    room_counts = {room["id"]: 0 for room in rooms}
    for rack in racks:
        if rack["roomId"] in room_counts:
            room_counts[rack["roomId"]] += counts.get(rack["id"], 0)
    result = {
        "rooms": rooms,
        "racks": racks,
        "roomSummaries": [{"roomId": room["id"], "slotCount": room_counts[room["id"]]} for room in rooms],
        "rackSummaries": [{"rackId": rack["id"], "slotCount": counts.get(rack["id"], 0)} for rack in racks],
    }
    log_perf("infrastructure.structure", started, rooms=len(rooms), rows=len(racks))
    return result


def room_workspace(conn, actor, room_id, *, view=""):
    require_room(actor, room_id)
    room = repo.room(conn, room_id)
    if room is None:
        raise LookupError("饲养间不存在")
    current_only = view == "cages"
    result = {"rooms": [room], **repo.room_workspace(conn, room_id, current_only=current_only)}
    if current_only:
        layout = repo.read_rack_layout(conn, room_id)
        rack_ids = {rack.get("id") for rack in result["racks"]}
        layout["placements"] = [item for item in layout["placements"] if item["rackId"] in rack_ids]
        result["rackLayout"] = layout
    return result


def save_rack_layout(conn, actor, room_id, body):
    require_room(actor, room_id)
    if actor.get("role") not in ("admin", "room_admin"):
        raise PermissionError("无权编辑该饲养间的笼架布局")
    if not isinstance(body, dict) or not isinstance(body.get("expectedUpdatedAt"), str):
        raise ValueError("请提供笼架布局版本")

    begin_write(conn)
    room = repo.room(conn, room_id)
    if room is None:
        raise LookupError("饲养间不存在")
    before = repo.read_rack_layout(conn, room_id)
    if before["updatedAt"] != body["expectedUpdatedAt"]:
        raise StaleWriteError("笼架布局已被其他操作更新，请刷新后重新编辑")
    placements = _rack_layout_placements(body.get("placements"), repo.room_rack_ids(conn, room_id))
    at = datetime.now(UTC)
    if before["updatedAt"]:
        at = max(at, datetime.fromisoformat(before["updatedAt"]) + timedelta(microseconds=1))
    after = {"placements": placements, "updatedAt": at.isoformat()}
    repo.save_rack_layout(conn, room_id, after)
    write_audit_events(
        conn,
        [
            audit_event(
                actor,
                "rack_layout.updated",
                "rack_layout",
                room_id,
                f"更新饲养间「{room.get('name') or room_id}」的笼架布局",
                [],
                after["updatedAt"],
                before,
                after,
            )
        ],
    )
    return after


def _rack_layout_placements(placements, rack_ids):
    if not isinstance(placements, list):
        raise ValueError("笼架摆放须为数组")
    normalized = []
    placed = set()
    occupied = set()
    for item in placements:
        if not isinstance(item, dict):
            raise ValueError("笼架摆放格式无效")
        rack_id = item.get("rackId")
        if not isinstance(rack_id, str) or rack_id not in rack_ids or rack_id in placed:
            raise ValueError("笼架须属于该饲养间且只能摆放一次")
        column, row, rotation = item.get("column"), item.get("row"), item.get("rotation")
        if any(type(value) is not int for value in (column, row, rotation)) or rotation not in (0, 90):
            raise ValueError("笼架坐标须为整数，旋转角度须为 0 或 90")
        width, height = (2, 4) if rotation == 90 else (4, 2)
        if not (0 <= column <= RACK_LAYOUT_LIMIT - width and 0 <= row <= RACK_LAYOUT_LIMIT - height):
            raise ValueError("笼架摆放超出布局边界")
        cells = {(x, y) for x in range(column, column + width) for y in range(row, row + height)}
        if occupied & cells:
            raise ValueError("笼架摆放不能重叠")
        occupied.update(cells)
        placed.add(rack_id)
        normalized.append({"rackId": rack_id, "column": column, "row": row, "rotation": rotation})
    return normalized


def rack_slots(conn, actor, rack_id):
    authorized_ids(actor)
    room_id, rack = repo.rack(conn, rack_id)
    if rack is None:
        raise LookupError("笼架不存在")
    require_room(actor, room_id)
    if repo.room(conn, room_id) is None:
        raise LookupError("饲养间不存在")
    return {"items": repo.rack_slots(conn, rack_id)}
