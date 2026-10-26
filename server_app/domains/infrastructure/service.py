"""Read authorization and projections shared by list and room workspaces."""

import time

from server_app.cache import log_perf

from . import repository as repo


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


def room_workspace(conn, actor, room_id):
    require_room(actor, room_id)
    room = repo.room(conn, room_id)
    if room is None:
        raise LookupError("饲养间不存在")
    return {"rooms": [room], **repo.room_workspace(conn, room_id)}


def rack_slots(conn, actor, rack_id):
    authorized_ids(actor)
    room_id, rack = repo.rack(conn, rack_id)
    if rack is None:
        raise LookupError("笼架不存在")
    require_room(actor, room_id)
    if repo.room(conn, room_id) is None:
        raise LookupError("饲养间不存在")
    return {"items": repo.rack_slots(conn, rack_id)}
