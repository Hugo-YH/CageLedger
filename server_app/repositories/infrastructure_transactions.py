"""Read dependencies for infrastructure commands under the caller's writer lock."""

import json


def _ids(values):
    return json.dumps(sorted({str(value) for value in values if value not in (None, "")}))


def _payloads(conn, table, values, order):
    if not values:
        return []
    return [
        json.loads(row[0])
        for row in conn.execute(
            f"SELECT payload FROM {table} WHERE id IN (SELECT value FROM json_each(?)) ORDER BY {order}",
            (_ids(values),),
        )
    ]


def read_infrastructure_context(conn, batches):
    """Keep the existing mutations/permission diff over their actual dependencies.

    Descendants are needed for cascade deletion; occupancy payloads are needed
    only for explicit slot deletion's original active/reserved protection.
    Unrelated history and finance data never participate in these mutations.
    """
    proposed = {
        name: [*batches.get(name, []), *batches.get(updates, [])]
        for name, updates in (("rooms", "roomUpdates"), ("racks", "rackUpdates"), ("slots", "slotUpdates"))
    }
    room_ids = {item.get("id") for item in proposed["rooms"]} | set(batches.get("roomDeletes", []))
    rack_ids = {item.get("id") for item in proposed["racks"]} | set(batches.get("rackDeletes", []))
    slot_ids = {item.get("id") for item in proposed["slots"]} | set(batches.get("slotDeletes", []))
    room_deletes = batches.get("roomDeletes", [])
    cascade_racks = set(batches.get("rackDeletes", []))
    if room_deletes:
        cascade_racks.update(
            row[0]
            for row in conn.execute(
                """SELECT id FROM racks WHERE room_id IN (SELECT value FROM json_each(?))
                OR json_extract(payload,'$.roomId') IN (SELECT value FROM json_each(?))""",
                (_ids(room_deletes), _ids(room_deletes)),
            )
        )
    rack_ids.update(cascade_racks)
    if cascade_racks:
        slot_ids.update(
            row[0]
            for row in conn.execute(
                """SELECT id FROM cage_slots WHERE rack_id IN (SELECT value FROM json_each(?))
                OR json_extract(payload,'$.rackId') IN (SELECT value FROM json_each(?))""",
                (_ids(cascade_racks), _ids(cascade_racks)),
            )
        )
    slots = _payloads(conn, "cage_slots", slot_ids, "rack_id,row_no,col_no,rowid")
    rack_ids.update(item.get("rackId") for item in [*slots, *proposed["slots"]])
    racks = _payloads(conn, "racks", rack_ids, "room_id,index_no,rowid")
    room_ids.update(item.get("roomId") for item in [*racks, *proposed["racks"]])
    rooms = _payloads(conn, "rooms", room_ids, "rowid")
    occupancies = []
    if batches.get("slotDeletes"):
        occupancies = [
            json.loads(row[0])
            for row in conn.execute(
                """SELECT payload FROM occupancies
                WHERE json_extract(payload,'$.slotId') IN (SELECT value FROM json_each(?))
                AND json_extract(payload,'$.status') IN ('active','reserved') ORDER BY start_date,rowid""",
                (_ids(batches["slotDeletes"]),),
            )
        ]
    return {"rooms": rooms, "racks": racks, "slots": slots, "occupancies": occupancies}


def entity_batches(collection, method, item_id, item):
    prefix = {"rooms": "room", "racks": "rack", "slots": "slot"}[collection]
    key = collection if method == "POST" else prefix + ("Deletes" if method == "DELETE" else "Updates")
    return {key: [item_id] if method == "DELETE" else [item]}
