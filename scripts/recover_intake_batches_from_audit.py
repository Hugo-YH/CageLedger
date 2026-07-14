#!/usr/bin/env python3
# ruff: noqa: E402, I001
"""Restore overwritten intake batches from their immutable audit snapshots.

The command only targets the supplied original entity ID.  Each restored batch
receives a fresh batch ID and fresh cage-card QR IDs through the normal intake
write service, while its original audit event remains linked in the payload.
"""

import argparse
import json
import sys
from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from server_app import legacy
from server_app.shared.identifiers import new_id


DEFAULT_ENTITY_ID = "019f5fbc-c2ff-4a79-97c8-9e1d3d7c892f70002"
RECOVERY_ACTOR = {
    "id": "system-intake-recovery",
    "username": "system-recovery",
    "displayName": "系统数据恢复",
    "role": "admin",
    "roomIds": [],
}


def load_snapshots(entity_id):
    with legacy.connect_db() as conn:
        rows = conn.execute(
            """
            SELECT id, at, payload
            FROM audit_events
            WHERE entity_id = ?
              AND entity_type = 'intake_batch'
              AND action IN ('intake_batch.created', 'intake_batch.updated')
            ORDER BY at, id
            """,
            (entity_id,),
        ).fetchall()

    snapshots = []
    for row in rows:
        payload = json.loads(row["payload"] or "{}")
        after = payload.get("after")
        if not isinstance(after, dict) or not after.get("batchNo"):
            continue
        snapshots.append({"auditEventId": row["id"], "at": row["at"], "item": after})
    return snapshots


def restore_item(snapshot):
    item = dict(snapshot["item"])
    item.update(
        {
            "id": new_id("batch"),
            "cards": [],
            "receipts": [],
            "confirmedCardCount": 0,
            "remainingCardCount": item.get("finalCardCount") or item.get("suggestedCardCount") or 0,
            "recoverySourceAuditId": snapshot["auditEventId"],
            "recoveredAt": legacy.now_iso(),
        }
    )
    return item


def recovered_source_ids():
    state = legacy.read_state().get("state") or legacy.empty_state()
    return {
        str(item.get("recoverySourceAuditId") or "")
        for item in state.get("intakeBatches", [])
        if item.get("recoverySourceAuditId")
    }


def main():
    parser = argparse.ArgumentParser(description="Restore overwritten intake batches from audit snapshots.")
    parser.add_argument("--entity-id", default=DEFAULT_ENTITY_ID, help="Original overwritten intake batch ID")
    parser.add_argument("--apply", action="store_true", help="Write recovered batches")
    args = parser.parse_args()

    snapshots = load_snapshots(args.entity_id)
    if len(snapshots) < 2:
        raise SystemExit("未找到可恢复的连续待接收批次快照。")

    # The final snapshot is the record that remains visible in the list.
    source_ids = recovered_source_ids()
    candidates = [snapshot for snapshot in snapshots[:-1] if snapshot["auditEventId"] not in source_ids]
    print(f"审计快照 {len(snapshots)} 条；待恢复 {len(candidates)} 条。")
    for snapshot in candidates:
        item = snapshot["item"]
        print(f"- {snapshot['at']}  {item.get('batchNo', '')}  {item.get('iacuc', '')}  {item.get('quantity', '')}")

    if not args.apply:
        print("预演完成。使用 --apply 写入恢复结果。")
        return

    spec = {"collection": "intakeBatches", "id_prefix": "batch"}
    for snapshot in candidates:
        item = restore_item(snapshot)
        legacy.write_intake_batch_entity_state("POST", item["id"], {"item": item}, RECOVERY_ACTOR, spec)
    print(f"已恢复 {len(candidates)} 条待接收批次。")


if __name__ == "__main__":
    main()
