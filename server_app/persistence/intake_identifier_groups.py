"""Compatible, audited grouping of already-recorded multi-order reservations."""

import json

from server_app.repositories.audit import insert_audit_events
from server_app.repositories.intake_identifiers import sync_members
from server_app.repositories.payload import dump_json
from server_app.shared import new_id, now_iso
from server_app.shared.concurrency import begin_write
from server_app.shared.intake_identifiers import (
    intake_identifier_values,
    intake_order_identifier_values,
    normalize_intake_order_identifiers,
)


def ensure_intake_identifier_groups(conn):
    begin_write(conn)
    conn.execute("""CREATE TABLE IF NOT EXISTS intake_identifier_members (
        batch_id TEXT NOT NULL REFERENCES intake_batches(id) ON DELETE CASCADE,
        kind TEXT NOT NULL CHECK(kind IN ('purchaseOrderNo','orderNo','batchNo')),
        value TEXT NOT NULL, value_key TEXT NOT NULL,
        PRIMARY KEY(batch_id,kind,value_key))""")
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_intake_identifier_member_key ON intake_identifier_members(kind,value_key,batch_id)"
    )
    cursor = conn.execute("SELECT id,payload FROM intake_batches ORDER BY rowid")
    while rows := cursor.fetchmany(100):
        events = []
        for row in rows:
            before = json.loads(row["payload"])
            item = normalize_intake_order_identifiers(before, preserve_missing=True)
            # Leave single-number payload bytes and versions entirely intact.
            if item.get("identifiers") is not None and item != before:
                if item.get("id") != row["id"]:
                    raise ValueError("预约编号分组的记录ID不一致，请核查")
                now = now_iso()
                item["updatedAt"] = now
                conn.execute(
                    "UPDATE intake_batches SET batch_no=?,purchase_order_no=?,purchase_order_key=?,batch_no_key=?,"
                    "order_no=?,order_key=?,updated_at=?,payload=? WHERE id=?",
                    (
                        item.get("batchNo", ""),
                        *intake_identifier_values(item),
                        *intake_order_identifier_values(item),
                        now,
                        dump_json(item),
                        row["id"],
                    ),
                )
                keys = ("purchaseOrderNo", "orderNo", "batchNo", "identifiers", "updatedAt")
                events.append(
                    {
                        "id": new_id("audit"),
                        "actorUserId": "system",
                        "actorUsername": "system",
                        "actorDisplayName": "系统数据兼容",
                        "action": "intake_batch.identifiers_grouped",
                        "entityType": "intake_batch",
                        "entityId": row["id"],
                        "slotIds": [],
                        "at": now,
                        "message": "将已保存的多单、多需求编号分组，保留总数量与原文，不推断对应分摊",
                        "before": {key: before[key] for key in keys if key in before},
                        "after": {key: item[key] for key in keys if key in item},
                    }
                )
            sync_members(conn, item)
        if events:
            insert_audit_events(conn, events)
