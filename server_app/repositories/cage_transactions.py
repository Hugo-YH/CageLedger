"""Target and relationship projections for cage writes; caller owns the write lock."""

import json

from server_app.repositories.application_context import applications_for_iacucs


def _ids(values):
    return json.dumps(sorted({str(value) for value in values if value not in (None, "")}))


def _payloads(conn, table, ids, order="rowid"):
    values = _ids(ids)
    if values == "[]":
        return []
    return [
        json.loads(row[0])
        for row in conn.execute(
            f"SELECT payload FROM {table} WHERE id IN (SELECT value FROM json_each(?)) ORDER BY {order}", (values,)
        )
    ]


def read_cage_context(conn, collection, item_id, proposed=None, *, context=None):
    """Reuse existing mutations/permission/audit rules over only their dependencies.

    Read both sides of a slot move, any reserved occupancy, active neighbours and
    linked source batches. Include payload slot links for old unprojected rows.
    The default full bootstrap and generic aggregate writer remain separate.
    """
    proposed = proposed or {}
    context = context or {}
    target = _payloads(
        conn, "occupancies" if collection == "occupancies" else "placement_tasks", [item_id or proposed.get("id")]
    )
    occupancy_roots = target + [proposed] if collection == "occupancies" else []
    task_roots = target + [proposed] if collection == "placementTasks" else []
    task_ids = [item.get("placementTaskId") for item in occupancy_roots]
    if collection == "placementTasks":
        task_ids.extend([item_id, proposed.get("id")])
    tasks = _payloads(conn, "placement_tasks", task_ids, "planned_move_in_date,rowid")
    task_roots += tasks
    occupancy_ids = [item.get("reservedOccupancyId") for item in task_roots]
    if collection == "occupancies":
        occupancy_ids.extend([item_id, proposed.get("id")])
    linked = _payloads(conn, "occupancies", occupancy_ids, "start_date,rowid")
    occupancy_roots += linked
    slot_ids = [item.get("slotId") for item in occupancy_roots] + [context.get("slotId")]
    slots = _payloads(conn, "cage_slots", slot_ids, "rack_id,row_no,col_no,rowid")
    racks = _payloads(conn, "racks", [slot.get("rackId") for slot in slots], "room_id,index_no,rowid")
    room_ids = (
        [rack.get("roomId") for rack in racks]
        + [item.get("targetRoomId") for item in task_roots]
        + [context.get("roomId")]
    )
    rooms = _payloads(conn, "rooms", room_ids)
    # The payload is the original domain rule's source for status and slot links.
    # Indexed scalar/legacy links bound this to the selected slots, not history.
    # Materialize IDs before sorting; an OR with ORDER BY can scan all history.
    slots_json, occupancies_json = _ids(slot_ids), _ids(occupancy_ids)
    occupancies = [
        json.loads(row[0])
        for row in conn.execute(
            """SELECT payload FROM occupancies
           WHERE id IN (
             SELECT value FROM json_each(?)
             UNION
             SELECT id FROM occupancies WHERE slot_id IN (SELECT value FROM json_each(?))
               AND json_extract(payload,'$.status') IN ('active','reserved')
             UNION
             SELECT id FROM occupancies
               WHERE json_extract(payload,'$.slotId') IN (SELECT value FROM json_each(?))
               AND json_extract(payload,'$.status') IN ('active','reserved'))
           ORDER BY start_date,rowid""",
            (occupancies_json, slots_json, slots_json),
        )
    ]
    batch_ids = _ids([item.get("sourceBatchId") for item in occupancy_roots + task_roots])
    batches = [
        {"id": row[0], "intakePurpose": row[1]}
        for row in conn.execute(
            """SELECT json_extract(payload,'$.id'), json_extract(payload,'$.intakePurpose')
           FROM intake_batches WHERE id IN (SELECT value FROM json_each(?))
           ORDER BY updated_at DESC,rowid DESC""",
            (batch_ids,),
        )
    ]
    return {
        "baseRate": 4.5,
        "billingRules": [],
        "adjustments": [],
        "rooms": rooms,
        "racks": racks,
        "slots": slots,
        "occupancies": occupancies,
        "placementTasks": tasks,
        "intakeBatches": batches,
        "auditLogs": [],
    }


def read_cage_applications(conn, occupancies):
    """Preserve first normalized IACUC match without loading the whole directory.

    Legacy payload numbers may differ from their indexed scalar. Scan only that
    tiny number projection, then decode the matching payloads in insertion order.
    No shared cache is consumed or published inside the caller's write transaction.
    """
    return applications_for_iacucs(conn, [item.get("iacuc", "") for item in occupancies])
