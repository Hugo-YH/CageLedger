"""Backfill lookup keys and split exact legacy orders without changing business versions."""

import json
from datetime import UTC, datetime

from server_app.repositories.audit import insert_audit_events
from server_app.shared import new_id
from server_app.shared.concurrency import begin_write
from server_app.shared.intake_identifiers import (
    intake_identifier_values,
    intake_order_identifier_values,
    normalize_intake_order_identifiers,
)


def ensure_intake_identifier_schema(conn):
    # DDL must roll back with the backfill; SQLite otherwise commits ALTER TABLE
    # before the first UPDATE starts an implicit transaction. Caller owns commit.
    begin_write(conn)
    columns = {row[1] for row in conn.execute("PRAGMA table_info(intake_batches)")}
    changed = False
    for name in ("purchase_order_no", "purchase_order_key", "batch_no_key", "order_no", "order_key"):
        if name not in columns:
            conn.execute(f"ALTER TABLE intake_batches ADD COLUMN {name} TEXT NOT NULL DEFAULT ''")
            changed = True
    events = []
    now = datetime.now(UTC).isoformat()
    for row in conn.execute(
        "SELECT id,batch_no,payload,purchase_order_no,purchase_order_key,batch_no_key,order_no,order_key FROM intake_batches"
    ).fetchall():
        batch = json.loads(row["payload"])
        normalized = normalize_intake_order_identifiers(batch)
        values = (
            *intake_identifier_values({**normalized, "batchNo": row["batch_no"]}),
            *intake_order_identifier_values(normalized),
        )
        old_values = tuple(
            row[key] for key in ("purchase_order_no", "purchase_order_key", "batch_no_key", "order_no", "order_key")
        )
        # Preserve bytes of unrelated old payloads. The complete DC value moves
        # to orderNo, while its request C value becomes purchaseOrderNo.
        split_payload = bool(normalized["orderNo"]) and any(
            normalized[key] != batch.get(key, "") for key in ("purchaseOrderNo", "orderNo")
        )
        if changed or old_values != values or split_payload:
            payload = (
                json.dumps(
                    {**batch, "purchaseOrderNo": normalized["purchaseOrderNo"], "orderNo": normalized["orderNo"]},
                    ensure_ascii=False,
                )
                if split_payload
                else row["payload"]
            )
            conn.execute(
                "UPDATE intake_batches SET purchase_order_no=?,purchase_order_key=?,batch_no_key=?,order_no=?,order_key=?,payload=? WHERE id=?",
                (*values, payload, row["id"]),
            )
        if split_payload:
            events.append(
                {
                    "id": new_id("audit"),
                    "actorUserId": "system",
                    "actorUsername": "system",
                    "actorDisplayName": "系统数据兼容",
                    "action": "intake_batch.identifiers_migrated",
                    "entityType": "intake_batch",
                    "entityId": row["id"],
                    "slotIds": [],
                    "at": now,
                    "message": "拆分采购单号与订单编号，保留原始订单及预约来源",
                    "before": {key: batch.get(key, "") for key in ("purchaseOrderNo", "orderNo")},
                    "after": {key: normalized[key] for key in ("purchaseOrderNo", "orderNo")},
                }
            )
    if events:
        insert_audit_events(conn, events)
    conn.execute("CREATE INDEX IF NOT EXISTS idx_intake_purchase_order_key ON intake_batches(purchase_order_key)")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_intake_batch_no_key ON intake_batches(batch_no_key)")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_intake_order_key ON intake_batches(order_key)")
