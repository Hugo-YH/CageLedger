"""Bounded intake mutation context and global card-code projection."""

import json


def _payloads(conn, table, where="", params=(), order="rowid"):
    clause = f" WHERE {where}" if where else ""
    return [json.loads(row[0]) for row in conn.execute(f"SELECT payload FROM {table}{clause} ORDER BY {order}", params)]


def read_intake_context(conn, batch_ids):
    """Caller holds the write lock; load only records a batch mutation can affect.

    Keep all room definitions for the existing name lookup semantics. Linked
    occupancies protect purpose changes; tasks protect rollback and room changes.
    Both scalar and legacy payload links are included without loading other rows.
    """
    ids = json.dumps(list(dict.fromkeys(batch_ids)))
    batches = _payloads(
        conn, "intake_batches", "id IN (SELECT value FROM json_each(?))", (ids,), "updated_at DESC,rowid DESC"
    )
    tasks = _payloads(
        conn,
        "placement_tasks",
        "source_batch_id IN (SELECT value FROM json_each(?)) OR json_extract(payload,'$.sourceBatchId') IN (SELECT value FROM json_each(?))",
        (ids, ids),
        "planned_move_in_date,rowid",
    )
    task_ids = json.dumps([task.get("id") for task in tasks])
    occupancies = _payloads(
        conn,
        "occupancies",
        "json_extract(payload,'$.sourceBatchId') IN (SELECT value FROM json_each(?)) OR json_extract(payload,'$.placementTaskId') IN (SELECT value FROM json_each(?))",
        (ids, task_ids),
        "start_date,rowid",
    )
    return {
        "intakeBatches": batches,
        "placementTasks": tasks,
        "occupancies": occupancies,
        "rooms": _payloads(conn, "rooms"),
    }


def reserved_card_qr_ids(conn, exclude_batch_id):
    """Return the same candidates as collect_cage_card_qr_ids, without full payloads.

    The exclusion deliberately follows the original payload relationships: own
    cards/tasks and occupancies linked to own tasks do not reserve their codes.
    Validation and sequence allocation remain in the existing domain helper.
    """
    rows = conn.execute(
        """SELECT CASE WHEN card.type='object' THEN json_extract(card.value,'$.qrId') END
           FROM intake_batches b,json_each(b.payload,'$.cards') card
           WHERE coalesce(json_extract(b.payload,'$.id'),'') != ?
           UNION ALL
           SELECT json_extract(payload,'$.qrId') FROM placement_tasks
           WHERE coalesce(json_extract(payload,'$.sourceBatchId'),'') != ?
           UNION ALL
           SELECT json_extract(payload,'$.qrId') FROM occupancies
           WHERE coalesce(json_extract(payload,'$.placementTaskId'),'') NOT IN (
             SELECT json_extract(payload,'$.id') FROM placement_tasks
             WHERE json_extract(payload,'$.sourceBatchId')=? AND json_extract(payload,'$.id') IS NOT NULL
             AND json_extract(payload,'$.id')!=''
           )""",
        (exclude_batch_id, exclude_batch_id, exclude_batch_id),
    )
    return [row[0] for row in rows]
