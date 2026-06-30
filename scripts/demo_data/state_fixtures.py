from __future__ import annotations

import json
import shutil
import sqlite3
from copy import deepcopy
from datetime import datetime
from pathlib import Path

from server import DB_PATH, clean_text, column_label, now_iso, slot_id_for_rack

from .config import (
    DEMO_IACUCS,
    DEMO_PI_GUINEA,
    DEMO_PI_MONKEY,
    DEMO_PI_MOUSE,
    DEMO_PREFIX,
    DEMO_ROOMS,
    demo_date,
    next_monday,
)


def ensure_backup() -> Path:
    timestamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    backup_dir = DB_PATH.parent / "backups"
    backup_dir.mkdir(parents=True, exist_ok=True)
    target = backup_dir / f"cageledger-before-demo-{timestamp}.sqlite"
    shutil.copy2(DB_PATH, target)
    return target


def load_actor(conn: sqlite3.Connection) -> dict:
    row = conn.execute(
        "SELECT id, username, display_name, role, room_ids FROM users WHERE username = 'admin' ORDER BY rowid LIMIT 1"
    ).fetchone()
    if not row:
        raise RuntimeError("未找到 admin 账号，无法写入演示数据")
    return {
        "id": row["id"],
        "username": row["username"],
        "displayName": row["display_name"],
        "role": row["role"],
        "roomIds": json.loads(row["room_ids"] or "[]"),
    }


def existing_applications(conn: sqlite3.Connection) -> list[dict]:
    rows = conn.execute("SELECT payload FROM experiment_applications ORDER BY rowid").fetchall()
    return [json.loads(row["payload"]) for row in rows]


def strip_demo_state(state: dict) -> dict:
    next_state = deepcopy(state)
    demo_room_ids = {room["id"] for room in DEMO_ROOMS.values()}
    demo_rack_ids = {
        f"{DEMO_PREFIX}-rack-zj-mouse-01",
        f"{DEMO_PREFIX}-rack-bio-monkey-01",
        f"{DEMO_PREFIX}-rack-bio-guinea-01",
    }
    next_state["rooms"] = [
        item
        for item in next_state.get("rooms", [])
        if item.get("id") not in demo_room_ids and not clean_text(item.get("name", "")).startswith("演示-")
    ]
    next_state["racks"] = [
        item
        for item in next_state.get("racks", [])
        if item.get("id") not in demo_rack_ids and not clean_text(item.get("id", "")).startswith(DEMO_PREFIX)
    ]
    next_state["slots"] = [
        item
        for item in next_state.get("slots", [])
        if not clean_text(item.get("id", "")).startswith(f"slot-{DEMO_PREFIX}")
    ]
    next_state["occupancies"] = [
        item
        for item in next_state.get("occupancies", [])
        if not clean_text(item.get("id", "")).startswith(f"{DEMO_PREFIX}-occ")
    ]
    next_state["intakeBatches"] = [
        item
        for item in next_state.get("intakeBatches", [])
        if not clean_text(item.get("id", "")).startswith(f"{DEMO_PREFIX}-batch")
    ]
    next_state["placementTasks"] = [
        item
        for item in next_state.get("placementTasks", [])
        if not clean_text(item.get("id", "")).startswith(f"{DEMO_PREFIX}-task")
    ]
    next_state["auditLogs"] = [
        item
        for item in next_state.get("auditLogs", [])
        if DEMO_PREFIX not in clean_text(item.get("id", "")) and "（演示）" not in clean_text(item.get("message", ""))
    ]
    return next_state


def room_payload(key: str) -> dict:
    return deepcopy(DEMO_ROOMS[key])


def rack_payload(room_key: str) -> dict:
    room = DEMO_ROOMS[room_key]
    short = room_key.replace("_", "-")
    rack_id = f"{DEMO_PREFIX}-rack-{short}-01"
    return {
        "id": rack_id,
        "roomId": room["id"],
        "name": f"{room['name']} 01 号笼架",
        "rows": room["rows"],
        "cols": room["cols"],
        "index": 1,
    }


def slot_payloads(rack: dict) -> list[dict]:
    slots = []
    for row_no in range(1, int(rack["rows"]) + 1):
        for col_no in range(1, int(rack["cols"]) + 1):
            slots.append(
                {
                    "id": slot_id_for_rack(rack["id"], row_no, col_no),
                    "rackId": rack["id"],
                    "row": row_no,
                    "col": col_no,
                    "code": f"{column_label(col_no)}{row_no}",
                    "status": "empty",
                }
            )
    return slots


def occupancy_payload(
    occ_id: str,
    slot: dict,
    rack: dict,
    room: dict,
    *,
    status: str,
    iacuc: str,
    project: str,
    pi: str,
    owner: str,
    funding: str,
    species: str,
    billing_item: str,
    animal_count: int | None,
    start_date: str,
    end_date: str = "",
    notes: str = "",
) -> dict:
    return {
        "id": occ_id,
        "slotId": slot["id"],
        "cageCode": f"{room['name']}-{rack['index']:02d}-{slot['code']}",
        "status": status,
        "iacuc": iacuc,
        "project": project,
        "pi": pi,
        "owner": owner,
        "funding": funding,
        "roomName": room["name"],
        "rackName": rack["name"],
        "slotCode": slot["code"],
        "startDate": start_date,
        "endDate": end_date,
        "endReason": "",
        "notes": notes,
        "updatedAt": now_iso(),
        "roomId": room["id"],
        "rackId": rack["id"],
        "species": species,
        "billingItem": billing_item,
        "customerType": "internal",
        "animalCount": animal_count,
    }


def build_demo_state(base_state: dict) -> dict:
    state = strip_demo_state(base_state)
    rooms = [room_payload("zj_mouse"), room_payload("bio_monkey"), room_payload("bio_guinea")]
    racks = [rack_payload("zj_mouse"), rack_payload("bio_monkey"), rack_payload("bio_guinea")]
    slot_map = {}
    slots = []
    for rack in racks:
        current_slots = slot_payloads(rack)
        slots.extend(current_slots)
        for item in current_slots:
            slot_map[item["id"]] = item

    room_map = {item["id"]: item for item in rooms}
    rack_map = {item["id"]: item for item in racks}

    zj_room = room_map[DEMO_ROOMS["zj_mouse"]["id"]]
    zj_rack = rack_map[f"{DEMO_PREFIX}-rack-zj-mouse-01"]
    monkey_room = room_map[DEMO_ROOMS["bio_monkey"]["id"]]
    monkey_rack = rack_map[f"{DEMO_PREFIX}-rack-bio-monkey-01"]
    guinea_room = room_map[DEMO_ROOMS["bio_guinea"]["id"]]
    guinea_rack = rack_map[f"{DEMO_PREFIX}-rack-bio-guinea-01"]

    occupancies = [
        occupancy_payload(
            f"{DEMO_PREFIX}-occ-zj-01",
            slot_map[slot_id_for_rack(zj_rack["id"], 1, 1)],
            zj_rack,
            zj_room,
            status="active",
            iacuc=DEMO_IACUCS["mouse_a"],
            project="视神经损伤后小胶质细胞重塑机制研究",
            pi=DEMO_PI_MOUSE,
            owner="刘熠（演示）",
            funding="珠江新城设施演示课题 A",
            species="mouse",
            billing_item="mouse_standard",
            animal_count=None,
            start_date=demo_date(1),
        ),
        occupancy_payload(
            f"{DEMO_PREFIX}-occ-zj-02",
            slot_map[slot_id_for_rack(zj_rack["id"], 1, 2)],
            zj_rack,
            zj_room,
            status="active",
            iacuc=DEMO_IACUCS["mouse_a"],
            project="视神经损伤后小胶质细胞重塑机制研究",
            pi=DEMO_PI_MOUSE,
            owner="刘熠（演示）",
            funding="珠江新城设施演示课题 A",
            species="mouse",
            billing_item="mouse_standard",
            animal_count=None,
            start_date=demo_date(1),
        ),
        occupancy_payload(
            f"{DEMO_PREFIX}-occ-zj-03",
            slot_map[slot_id_for_rack(zj_rack["id"], 1, 3)],
            zj_rack,
            zj_room,
            status="active",
            iacuc=DEMO_IACUCS["mouse_a"],
            project="视神经损伤后小胶质细胞重塑机制研究",
            pi=DEMO_PI_MOUSE,
            owner="刘熠（演示）",
            funding="珠江新城设施演示课题 A",
            species="mouse",
            billing_item="mouse_standard",
            animal_count=None,
            start_date=demo_date(3),
        ),
        occupancy_payload(
            f"{DEMO_PREFIX}-occ-zj-04",
            slot_map[slot_id_for_rack(zj_rack["id"], 2, 1)],
            zj_rack,
            zj_room,
            status="active",
            iacuc=DEMO_IACUCS["mouse_b"],
            project="视网膜代谢干预对神经退行的保护研究",
            pi=DEMO_PI_MOUSE,
            owner="刘熠（演示）",
            funding="珠江新城设施演示课题 B",
            species="mouse",
            billing_item="mouse_standard",
            animal_count=None,
            start_date=demo_date(1),
            end_date=demo_date(12),
            notes="保留一个超期演示笼位",
        ),
        occupancy_payload(
            f"{DEMO_PREFIX}-occ-zj-05",
            slot_map[slot_id_for_rack(zj_rack["id"], 2, 2)],
            zj_rack,
            zj_room,
            status="active",
            iacuc=DEMO_IACUCS["mouse_b"],
            project="视网膜代谢干预对神经退行的保护研究",
            pi=DEMO_PI_MOUSE,
            owner="刘熠（演示）",
            funding="珠江新城设施演示课题 B",
            species="mouse",
            billing_item="mouse_standard",
            animal_count=None,
            start_date=demo_date(4),
        ),
        occupancy_payload(
            f"{DEMO_PREFIX}-occ-monkey-01",
            slot_map[slot_id_for_rack(monkey_rack["id"], 1, 1)],
            monkey_rack,
            monkey_room,
            status="active",
            iacuc=DEMO_IACUCS["monkey_a"],
            project="猴视神经损伤模型长期随访研究",
            pi=DEMO_PI_MONKEY,
            owner="王宁（演示）",
            funding="生物岛设施演示猴课题",
            species="monkey",
            billing_item="monkey",
            animal_count=1,
            start_date=demo_date(2),
        ),
        occupancy_payload(
            f"{DEMO_PREFIX}-occ-monkey-02",
            slot_map[slot_id_for_rack(monkey_rack["id"], 1, 2)],
            monkey_rack,
            monkey_room,
            status="active",
            iacuc=DEMO_IACUCS["monkey_a"],
            project="猴视神经损伤模型长期随访研究",
            pi=DEMO_PI_MONKEY,
            owner="王宁（演示）",
            funding="生物岛设施演示猴课题",
            species="monkey",
            billing_item="monkey",
            animal_count=1,
            start_date=demo_date(2),
        ),
        occupancy_payload(
            f"{DEMO_PREFIX}-occ-monkey-reserved",
            slot_map[slot_id_for_rack(monkey_rack["id"], 2, 1)],
            monkey_rack,
            monkey_room,
            status="reserved",
            iacuc=DEMO_IACUCS["monkey_b"],
            project="猴房待进驻演示批次",
            pi=DEMO_PI_MONKEY,
            owner="王宁（演示）",
            funding="生物岛设施演示猴课题",
            species="monkey",
            billing_item="monkey",
            animal_count=1,
            start_date=demo_date(18),
        ),
        occupancy_payload(
            f"{DEMO_PREFIX}-occ-guinea-01",
            slot_map[slot_id_for_rack(guinea_rack["id"], 1, 1)],
            guinea_rack,
            guinea_room,
            status="active",
            iacuc=DEMO_IACUCS["guinea_a"],
            project="豚鼠角膜修复材料评价研究",
            pi=DEMO_PI_GUINEA,
            owner="陈叶（演示）",
            funding="生物岛设施演示豚鼠课题",
            species="guinea_pig",
            billing_item="guinea_pig",
            animal_count=4,
            start_date=demo_date(5),
        ),
        occupancy_payload(
            f"{DEMO_PREFIX}-occ-guinea-02",
            slot_map[slot_id_for_rack(guinea_rack["id"], 1, 2)],
            guinea_rack,
            guinea_room,
            status="active",
            iacuc=DEMO_IACUCS["guinea_a"],
            project="豚鼠角膜修复材料评价研究",
            pi=DEMO_PI_GUINEA,
            owner="陈叶（演示）",
            funding="生物岛设施演示豚鼠课题",
            species="guinea_pig",
            billing_item="guinea_pig",
            animal_count=3,
            start_date=demo_date(5),
        ),
    ]

    receipt_mouse = {
        "id": f"{DEMO_PREFIX}-receipt-zj-01",
        "actualReceiptDate": demo_date(9),
        "cardCount": 2,
        "confirmedBy": "系统管理员",
        "confirmedAt": now_iso(),
        "plannedMoveInDate": next_monday(demo_date(9)),
    }
    receipt_monkey = {
        "id": f"{DEMO_PREFIX}-receipt-bio-01",
        "actualReceiptDate": demo_date(8),
        "cardCount": 2,
        "confirmedBy": "系统管理员",
        "confirmedAt": now_iso(),
        "plannedMoveInDate": demo_date(12),
    }

    intake_batches = [
        {
            "id": f"{DEMO_PREFIX}-batch-zj-unmatched",
            "rawMessage": "演示批次：房间未配置，用于展示异常卡片。",
            "purchaseOrderNo": "PO-DEMO-001",
            "batchNo": f"{DEMO_IACUCS['mouse_c']}-202605-01",
            "iacuc": DEMO_IACUCS["mouse_c"],
            "supplier": "南方实验动物中心",
            "species": "mouse",
            "strainRaw": "C57BL/6J",
            "strainStandard": "C57BL/6J",
            "sex": "雄",
            "quantity": 15,
            "roomName": "演示-未配置房间",
            "roomMatched": False,
            "intakeDate": demo_date(20),
            "husbandryDays": 30,
            "endDate": "",
            "project": "未匹配房间异常演示",
            "pi": DEMO_PI_MOUSE,
            "owner": "刘熠（演示）",
            "receiverName": "系统管理员",
            "vetPhone": "",
            "notes": "",
            "status": "pending_print",
            "suggestedAnimalsPerCage": 5,
            "suggestedCardCount": 3,
            "finalCardCount": 3,
            "receipts": [],
            "confirmedCardCount": 0,
            "remainingCardCount": 3,
            "updatedAt": now_iso(),
            "cards": [],
        },
        {
            "id": f"{DEMO_PREFIX}-batch-zj-received",
            "rawMessage": "演示批次：已接收后进入待进驻。",
            "purchaseOrderNo": "PO-DEMO-002",
            "batchNo": f"{DEMO_IACUCS['mouse_d']}-202605-02",
            "iacuc": DEMO_IACUCS["mouse_d"],
            "supplier": "南方实验动物中心",
            "species": "mouse",
            "strainRaw": "C57BL/6J",
            "strainStandard": "C57BL/6J",
            "sex": "雌",
            "quantity": 10,
            "roomName": zj_room["name"],
            "roomMatched": True,
            "intakeDate": demo_date(9),
            "husbandryDays": 28,
            "endDate": "",
            "project": "珠江新城待进驻演示",
            "pi": DEMO_PI_MOUSE,
            "owner": "刘熠（演示）",
            "receiverName": "系统管理员",
            "vetPhone": "",
            "notes": "",
            "status": "received",
            "suggestedAnimalsPerCage": 5,
            "suggestedCardCount": 2,
            "finalCardCount": 2,
            "receipts": [receipt_mouse],
            "confirmedCardCount": 2,
            "remainingCardCount": 0,
            "updatedAt": now_iso(),
            "cards": [],
        },
        {
            "id": f"{DEMO_PREFIX}-batch-bio-received",
            "rawMessage": "演示批次：猴房一条待分配，一条已预留。",
            "purchaseOrderNo": "PO-DEMO-003",
            "batchNo": f"{DEMO_IACUCS['monkey_b']}-202605-01",
            "iacuc": DEMO_IACUCS["monkey_b"],
            "supplier": "广州灵长类资源平台",
            "species": "monkey",
            "strainRaw": "食蟹猴",
            "strainStandard": "食蟹猴",
            "sex": "雄",
            "quantity": 2,
            "roomName": monkey_room["name"],
            "roomMatched": True,
            "intakeDate": demo_date(8),
            "husbandryDays": 60,
            "endDate": "",
            "project": "猴房待进驻演示批次",
            "pi": DEMO_PI_MONKEY,
            "owner": "王宁（演示）",
            "receiverName": "系统管理员",
            "vetPhone": "",
            "notes": "",
            "status": "received",
            "suggestedAnimalsPerCage": 1,
            "suggestedCardCount": 2,
            "finalCardCount": 2,
            "receipts": [receipt_monkey],
            "confirmedCardCount": 2,
            "remainingCardCount": 0,
            "updatedAt": now_iso(),
            "cards": [],
        },
    ]

    placement_tasks = [
        {
            "id": f"{DEMO_PREFIX}-task-zj-01",
            "sourceBatchId": f"{DEMO_PREFIX}-batch-zj-received",
            "sourceReceiptId": receipt_mouse["id"],
            "batchNo": f"{DEMO_IACUCS['mouse_d']}-202605-02",
            "targetRoomId": zj_room["id"],
            "targetRoomName": zj_room["name"],
            "plannedMoveInDate": receipt_mouse["plannedMoveInDate"],
            "status": "pending",
            "reservedOccupancyId": "",
            "actualMoveInDate": "",
            "roomChangeHistory": [],
            "iacuc": DEMO_IACUCS["mouse_d"],
            "project": "珠江新城待进驻演示",
            "pi": DEMO_PI_MOUSE,
            "owner": "刘熠（演示）",
            "species": "mouse",
            "strainStandard": "C57BL/6J",
            "animalCount": 5,
            "cardSequence": 1,
            "updatedAt": now_iso(),
        },
        {
            "id": f"{DEMO_PREFIX}-task-zj-02",
            "sourceBatchId": f"{DEMO_PREFIX}-batch-zj-received",
            "sourceReceiptId": receipt_mouse["id"],
            "batchNo": f"{DEMO_IACUCS['mouse_d']}-202605-02",
            "targetRoomId": zj_room["id"],
            "targetRoomName": zj_room["name"],
            "plannedMoveInDate": receipt_mouse["plannedMoveInDate"],
            "status": "pending",
            "reservedOccupancyId": "",
            "actualMoveInDate": "",
            "roomChangeHistory": [],
            "iacuc": DEMO_IACUCS["mouse_d"],
            "project": "珠江新城待进驻演示",
            "pi": DEMO_PI_MOUSE,
            "owner": "刘熠（演示）",
            "species": "mouse",
            "strainStandard": "C57BL/6J",
            "animalCount": 5,
            "cardSequence": 2,
            "updatedAt": now_iso(),
        },
        {
            "id": f"{DEMO_PREFIX}-task-bio-01",
            "sourceBatchId": f"{DEMO_PREFIX}-batch-bio-received",
            "sourceReceiptId": receipt_monkey["id"],
            "batchNo": f"{DEMO_IACUCS['monkey_b']}-202605-01",
            "targetRoomId": monkey_room["id"],
            "targetRoomName": monkey_room["name"],
            "plannedMoveInDate": demo_date(12),
            "status": "reserved",
            "reservedOccupancyId": f"{DEMO_PREFIX}-occ-monkey-reserved",
            "actualMoveInDate": "",
            "roomChangeHistory": [],
            "iacuc": DEMO_IACUCS["monkey_b"],
            "project": "猴房待进驻演示批次",
            "pi": DEMO_PI_MONKEY,
            "owner": "王宁（演示）",
            "species": "monkey",
            "strainStandard": "食蟹猴",
            "animalCount": 1,
            "cardSequence": 1,
            "updatedAt": now_iso(),
        },
        {
            "id": f"{DEMO_PREFIX}-task-bio-02",
            "sourceBatchId": f"{DEMO_PREFIX}-batch-bio-received",
            "sourceReceiptId": receipt_monkey["id"],
            "batchNo": f"{DEMO_IACUCS['monkey_b']}-202605-01",
            "targetRoomId": monkey_room["id"],
            "targetRoomName": monkey_room["name"],
            "plannedMoveInDate": demo_date(12),
            "status": "pending",
            "reservedOccupancyId": "",
            "actualMoveInDate": "",
            "roomChangeHistory": [],
            "iacuc": DEMO_IACUCS["monkey_b"],
            "project": "猴房待进驻演示批次",
            "pi": DEMO_PI_MONKEY,
            "owner": "王宁（演示）",
            "species": "monkey",
            "strainStandard": "食蟹猴",
            "animalCount": 1,
            "cardSequence": 2,
            "updatedAt": now_iso(),
        },
    ]

    state["rooms"].extend(rooms)
    state["racks"].extend(racks)
    state["slots"].extend(slots)
    state["occupancies"].extend(occupancies)
    state["intakeBatches"].extend(intake_batches)
    state["placementTasks"].extend(placement_tasks)
    return state
