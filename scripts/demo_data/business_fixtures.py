from __future__ import annotations

import json
import sqlite3

from server import (
    BILLING_PRINCIPAL_INDEPENDENT,
    BILLING_PRINCIPAL_PI,
    WORKFLOW_STATUS_FINANCE,
    WORKFLOW_STATUS_SENT,
    clean_text,
    delete_billing_workflow,
    generate_billing_statement,
    generate_billing_statement_by_pi,
    list_billing_workflows,
    normalize_iacuc_number,
    now_iso,
    save_iacuc_index_file,
    save_principal_identity,
    save_quantity_sheet,
    update_workflow_status,
    write_experiment_applications,
)

from .config import (
    DEMO_IACUCS,
    DEMO_MONTH,
    DEMO_PI_GUINEA,
    DEMO_PI_MONKEY,
    DEMO_PI_MOUSE,
    DEMO_PREFIX,
    DEMO_ROOMS,
    demo_date,
)
from .state_fixtures import existing_applications


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
