#!/usr/bin/env python3

from __future__ import annotations

import json
import shutil
import sqlite3
import sys
from copy import deepcopy
from dataclasses import dataclass
from datetime import date, datetime, timedelta
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from server import (  # noqa: E402 - repository root must be on sys.path before importing the application
    BILLING_PRINCIPAL_INDEPENDENT,
    BILLING_PRINCIPAL_PI,
    DB_PATH,
    WORKFLOW_STATUS_FINANCE,
    WORKFLOW_STATUS_SENT,
    assemble_state,
    clean_text,
    column_label,
    connect_db,
    delete_billing_workflow,
    empty_state,
    generate_billing_statement,
    generate_billing_statement_by_pi,
    list_billing_workflows,
    normalize_iacuc_number,
    now_iso,
    save_iacuc_index_file,
    save_principal_identity,
    save_quantity_sheet,
    slot_id_for_rack,
    update_workflow_status,
    write_experiment_applications,
    write_state,
)

DEMO_PREFIX = "demo-202605"
DEMO_MONTH = date.today().strftime("%Y-%m")
DEMO_ROOMS = {
    "zj_mouse": {
        "id": f"{DEMO_PREFIX}-room-zj-mouse",
        "name": "演示-珠江小鼠间A",
        "area": "珠江新城设施",
        "facility": "zhujiang",
        "defaultSpecies": "mouse",
        "defaultBillingItem": "mouse_standard",
        "defaultCustomerType": "internal",
        "defaultAnimalCount": 1,
        "rackCount": 1,
        "rows": 4,
        "cols": 4,
        "billingProfileConfigured": True,
        "billingProfileConfirmed": True,
    },
    "bio_monkey": {
        "id": f"{DEMO_PREFIX}-room-bio-monkey",
        "name": "演示-生物岛猴房A",
        "area": "生物岛设施",
        "facility": "bioisland",
        "defaultSpecies": "monkey",
        "defaultBillingItem": "monkey",
        "defaultCustomerType": "internal",
        "defaultAnimalCount": 1,
        "rackCount": 1,
        "rows": 2,
        "cols": 3,
        "billingProfileConfigured": True,
        "billingProfileConfirmed": True,
    },
    "bio_guinea": {
        "id": f"{DEMO_PREFIX}-room-bio-guinea",
        "name": "演示-生物岛豚鼠房A",
        "area": "生物岛设施",
        "facility": "bioisland",
        "defaultSpecies": "guinea_pig",
        "defaultBillingItem": "guinea_pig",
        "defaultCustomerType": "internal",
        "defaultAnimalCount": 4,
        "rackCount": 1,
        "rows": 2,
        "cols": 3,
        "billingProfileConfigured": True,
        "billingProfileConfirmed": True,
    },
}
DEMO_PI_MOUSE = "柯琼（演示）"
DEMO_PI_MONKEY = "周孝来（演示）"
DEMO_PI_GUINEA = "苏玉霞（演示）"
DEMO_IACUCS = {
    "mouse_a": "Z2026D01",
    "mouse_b": "Z2026D02",
    "mouse_c": "Z2026D03",
    "mouse_d": "Z2026D04",
    "monkey_a": "B2026H01",
    "monkey_b": "B2026H02",
    "guinea_a": "B2026G01",
}


@dataclass
class DemoContext:
    actor: dict
    month: str
    backup_path: Path


def demo_date(day: int) -> str:
    return f"{DEMO_MONTH}-{day:02d}"


def next_monday(value: str) -> str:
    current = datetime.strptime(value, "%Y-%m-%d").date()
    delta = (7 - current.weekday()) % 7
    delta = 7 if delta == 0 else delta
    return (current + timedelta(days=delta)).isoformat()


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


def demo_applications() -> list[dict]:
    return [
        {
            "id": f"{DEMO_PREFIX}-app-zj-01",
            "iacuc": DEMO_IACUCS["mouse_a"],
            "rawIacuc": DEMO_IACUCS["mouse_a"],
            "project": "视神经损伤后小胶质细胞重塑机制研究",
            "pi": DEMO_PI_MOUSE,
            "owner": "刘熠（演示）",
            "funding": "珠江新城设施演示课题 A",
        },
        {
            "id": f"{DEMO_PREFIX}-app-zj-02",
            "iacuc": DEMO_IACUCS["mouse_b"],
            "rawIacuc": DEMO_IACUCS["mouse_b"],
            "project": "视网膜代谢干预对神经退行的保护研究",
            "pi": DEMO_PI_MOUSE,
            "owner": "刘熠（演示）",
            "funding": "珠江新城设施演示课题 B",
        },
        {
            "id": f"{DEMO_PREFIX}-app-zj-03",
            "iacuc": DEMO_IACUCS["mouse_c"],
            "rawIacuc": DEMO_IACUCS["mouse_c"],
            "project": "未匹配房间异常演示",
            "pi": DEMO_PI_MOUSE,
            "owner": "刘熠（演示）",
            "funding": "珠江新城设施演示异常批次",
        },
        {
            "id": f"{DEMO_PREFIX}-app-zj-04",
            "iacuc": DEMO_IACUCS["mouse_d"],
            "rawIacuc": DEMO_IACUCS["mouse_d"],
            "project": "珠江新城待进驻演示",
            "pi": DEMO_PI_MOUSE,
            "owner": "刘熠（演示）",
            "funding": "珠江新城设施演示待进驻批次",
        },
        {
            "id": f"{DEMO_PREFIX}-app-bio-01",
            "iacuc": DEMO_IACUCS["monkey_a"],
            "rawIacuc": DEMO_IACUCS["monkey_a"],
            "project": "猴视神经损伤模型长期随访研究",
            "pi": DEMO_PI_MONKEY,
            "owner": "王宁（演示）",
            "funding": "生物岛设施演示猴课题",
        },
        {
            "id": f"{DEMO_PREFIX}-app-bio-02",
            "iacuc": DEMO_IACUCS["monkey_b"],
            "rawIacuc": DEMO_IACUCS["monkey_b"],
            "project": "猴房待进驻演示批次",
            "pi": DEMO_PI_MONKEY,
            "owner": "王宁（演示）",
            "funding": "生物岛设施演示猴课题",
        },
        {
            "id": f"{DEMO_PREFIX}-app-bio-03",
            "iacuc": DEMO_IACUCS["guinea_a"],
            "rawIacuc": DEMO_IACUCS["guinea_a"],
            "project": "豚鼠角膜修复材料评价研究",
            "pi": DEMO_PI_GUINEA,
            "owner": "陈叶（演示）",
            "funding": "生物岛设施演示豚鼠课题",
        },
    ]


def replace_demo_applications(conn: sqlite3.Connection) -> None:
    existing = existing_applications(conn)
    keep = [
        item
        for item in existing
        if item.get("id") not in {app["id"] for app in demo_applications()}
        and normalize_iacuc_number(item.get("iacuc", ""))
        not in {normalize_iacuc_number(value) for value in DEMO_IACUCS.values()}
    ]
    items = keep + demo_applications()
    imported_at = now_iso()
    write_experiment_applications(conn, items, imported_at)
    save_iacuc_index_file(items)


def reset_demo_audit(conn: sqlite3.Connection) -> None:
    conn.execute(
        "DELETE FROM audit_events WHERE entity_id LIKE ? OR message LIKE ? OR message LIKE ?",
        (f"{DEMO_PREFIX}%", "%（演示）%", "%演示-%"),
    )


def reset_demo_quantity_sheets(conn: sqlite3.Connection) -> None:
    rows = conn.execute("SELECT id, payload FROM quantity_sheets").fetchall()
    for row in rows:
        payload = json.loads(row["payload"])
        if clean_text(payload.get("id", "")).startswith(DEMO_PREFIX):
            conn.execute("DELETE FROM quantity_sheets WHERE id = ?", (payload["id"],))
            continue
        if normalize_iacuc_number(payload.get("iacuc", "")) in {
            normalize_iacuc_number(value) for value in DEMO_IACUCS.values()
        }:
            conn.execute("DELETE FROM quantity_sheets WHERE id = ?", (payload["id"],))


def reset_demo_workflows(conn: sqlite3.Connection) -> None:
    demo_iacucs = {normalize_iacuc_number(value) for value in DEMO_IACUCS.values()}
    demo_pis = {DEMO_PI_MOUSE, DEMO_PI_MONKEY, DEMO_PI_GUINEA}
    for workflow in list_billing_workflows(conn):
        scope_iacucs = {normalize_iacuc_number(value) for value in workflow.get("iacucs", []) if value}
        if scope_iacucs & demo_iacucs or clean_text(workflow.get("pi", "")) in demo_pis:
            delete_billing_workflow(conn, workflow["id"])


def create_demo_quantity_sheets(conn: sqlite3.Connection, actor: dict) -> None:
    zj_room = DEMO_ROOMS["zj_mouse"]
    save_quantity_sheet(
        conn,
        {
            "id": f"{DEMO_PREFIX}-qsheet-zj-02",
            "month": DEMO_MONTH,
            "roomId": zj_room["id"],
            "roomName": zj_room["name"],
            "manager": actor["displayName"],
            "iacuc": DEMO_IACUCS["mouse_b"],
            "project": "视网膜代谢干预对神经退行的保护研究",
            "pi": DEMO_PI_MOUSE,
            "owner": "刘熠（演示）",
            "funding": "珠江新城设施演示课题 B",
            "billingUnit": "cage_day",
            "initialAnimalCount": 0,
            "initialCageCount": 48,
            "rows": [
                {
                    "id": f"{DEMO_PREFIX}-qrow-zj-02-01",
                    "date": demo_date(8),
                    "addedCount": 4,
                    "addedType": "新增",
                    "removedCount": None,
                    "removedType": "",
                    "transferInFromIacuc": "",
                    "transferOutToIacuc": "",
                    "animalCount": None,
                    "cageCount": None,
                    "notes": "常规增加",
                }
            ],
        },
        actor,
    )
    save_quantity_sheet(
        conn,
        {
            "id": f"{DEMO_PREFIX}-qsheet-zj-01",
            "month": DEMO_MONTH,
            "roomId": zj_room["id"],
            "roomName": zj_room["name"],
            "manager": actor["displayName"],
            "iacuc": DEMO_IACUCS["mouse_a"],
            "project": "视神经损伤后小胶质细胞重塑机制研究",
            "pi": DEMO_PI_MOUSE,
            "owner": "刘熠（演示）",
            "funding": "珠江新城设施演示课题 A",
            "billingUnit": "cage_day",
            "initialAnimalCount": 0,
            "initialCageCount": 118,
            "rows": [
                {
                    "id": f"{DEMO_PREFIX}-qrow-zj-01-01",
                    "date": demo_date(3),
                    "addedCount": 12,
                    "addedType": "新增",
                    "removedCount": None,
                    "removedType": "",
                    "transferInFromIacuc": "",
                    "transferOutToIacuc": "",
                    "animalCount": None,
                    "cageCount": None,
                    "notes": "月初新增",
                },
                {
                    "id": f"{DEMO_PREFIX}-qrow-zj-01-02",
                    "date": demo_date(15),
                    "addedCount": None,
                    "addedType": "",
                    "removedCount": 20,
                    "removedType": "转出",
                    "transferInFromIacuc": "",
                    "transferOutToIacuc": DEMO_IACUCS["mouse_b"],
                    "animalCount": None,
                    "cageCount": None,
                    "notes": "转移到兄弟伦理号",
                },
                {
                    "id": f"{DEMO_PREFIX}-qrow-zj-01-03",
                    "date": demo_date(24),
                    "addedCount": None,
                    "addedType": "",
                    "removedCount": 6,
                    "removedType": "取材",
                    "transferInFromIacuc": "",
                    "transferOutToIacuc": "",
                    "animalCount": None,
                    "cageCount": None,
                    "notes": "常规取材",
                },
            ],
        },
        actor,
    )


def create_demo_workflows(conn: sqlite3.Connection, actor: dict) -> None:
    statement, _, _ = generate_billing_statement_by_pi(
        conn,
        {"pi": DEMO_PI_MOUSE, "month": DEMO_MONTH, "status": "draft", "sourceType": "quantity_sheet", "persist": True},
        actor,
    )
    update_workflow_status(conn, statement["workflowId"], WORKFLOW_STATUS_SENT, actor, "演示数据推进到已发送")

    monkey_statement, _, _ = generate_billing_statement(
        conn,
        {"iacuc": DEMO_IACUCS["monkey_a"], "month": DEMO_MONTH, "status": "draft", "persist": True},
        actor,
    )
    workflow_id = monkey_statement["workflowId"]
    update_workflow_status(conn, workflow_id, WORKFLOW_STATUS_SENT, actor, "演示数据推进到已发送")
    update_workflow_status(conn, workflow_id, "statement_signed_returned", actor, "演示数据推进到已签字交回")
    update_workflow_status(conn, workflow_id, WORKFLOW_STATUS_FINANCE, actor, "演示数据推进到已交财务")


def create_demo_principal_identities(conn: sqlite3.Connection, actor: dict) -> None:
    save_principal_identity(conn, {"principalType": BILLING_PRINCIPAL_PI}, actor, DEMO_PI_MOUSE)
    save_principal_identity(conn, {"principalType": BILLING_PRINCIPAL_INDEPENDENT}, actor, DEMO_PI_MONKEY)
    save_principal_identity(conn, {"principalType": BILLING_PRINCIPAL_INDEPENDENT}, actor, DEMO_PI_GUINEA)


def main() -> None:
    backup_path = ensure_backup()
    with connect_db() as conn:
        actor = load_actor(conn)
    context = DemoContext(actor=actor, month=DEMO_MONTH, backup_path=backup_path)

    with connect_db() as conn:
        current_state = assemble_state(conn) or empty_state()
    next_state = build_demo_state(current_state)
    write_state(next_state, context.actor, skip_permission=True)

    with connect_db() as conn:
        reset_demo_audit(conn)
        replace_demo_applications(conn)
        create_demo_principal_identities(conn, context.actor)
        reset_demo_quantity_sheets(conn)
        reset_demo_workflows(conn)
        create_demo_quantity_sheets(conn, context.actor)
        create_demo_workflows(conn, context.actor)
        conn.commit()

    print(f"演示数据已写入 {DB_PATH}")
    print(f"数据库备份：{context.backup_path}")
    print("演示房间：")
    for room in DEMO_ROOMS.values():
        print(f"  - {room['name']} ({room['facility']})")
    print("演示伦理号：")
    for key, value in DEMO_IACUCS.items():
        print(f"  - {key}: {value}")


if __name__ == "__main__":
    main()
