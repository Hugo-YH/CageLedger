from __future__ import annotations

from server import DB_PATH, assemble_state, connect_db, empty_state, write_state

from .business_fixtures import (
    create_demo_principal_identities,
    create_demo_quantity_sheets,
    create_demo_workflows,
    replace_demo_applications,
    reset_demo_audit,
    reset_demo_quantity_sheets,
    reset_demo_workflows,
)
from .config import DEMO_IACUCS, DEMO_MONTH, DEMO_ROOMS, DemoContext
from .state_fixtures import build_demo_state, ensure_backup, load_actor


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
