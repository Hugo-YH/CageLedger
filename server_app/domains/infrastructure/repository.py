"""Bounded infrastructure projections; no writes or derived business state."""

import json


def rooms(conn, room_ids=None):
    where, values = scope("id", room_ids)
    return payloads(conn, f"SELECT payload FROM rooms{where} ORDER BY rowid", values)


def scope(column, ids):
    if ids is None:
        return "", ()
    ids = sorted(set(ids))
    return (f" WHERE {column} IN ({','.join('?' for _ in ids)})", ids) if ids else (" WHERE 0", ())


def payloads(conn, sql, params=()):
    return [json.loads(row["payload"]) for row in conn.execute(sql, params)]


def structure(conn, room_ids):
    where, values = scope("r.room_id", room_ids)
    racks = payloads(conn, f"SELECT r.payload FROM racks r{where} ORDER BY r.room_id,r.index_no,r.rowid", values)
    counts = conn.execute(
        f"SELECT s.rack_id,COUNT(*) AS count FROM cage_slots s JOIN racks r ON r.id=s.rack_id{where} GROUP BY s.rack_id",
        values,
    ).fetchall()
    by_rack = {row["rack_id"]: row["count"] for row in counts}
    return racks, by_rack


def room(conn, room_id):
    row = conn.execute("SELECT payload FROM rooms WHERE id=?", (room_id,)).fetchone()
    return json.loads(row["payload"]) if row else None


def rack(conn, rack_id):
    row = conn.execute("SELECT room_id,payload FROM racks WHERE id=?", (rack_id,)).fetchone()
    return (row["room_id"], json.loads(row["payload"])) if row else (None, None)


def rack_slots(conn, rack_id):
    return payloads(conn, "SELECT payload FROM cage_slots WHERE rack_id=? ORDER BY row_no,col_no,rowid", (rack_id,))


def room_workspace(conn, room_id):
    return {
        "racks": payloads(conn, "SELECT payload FROM racks WHERE room_id=? ORDER BY index_no,rowid", (room_id,)),
        "slots": payloads(
            conn,
            "SELECT s.payload FROM cage_slots s JOIN racks r ON r.id=s.rack_id WHERE r.room_id=? ORDER BY s.rack_id,s.row_no,s.col_no,s.rowid",
            (room_id,),
        ),
        "occupancies": payloads(
            conn,
            "SELECT o.payload FROM occupancies o JOIN cage_slots s ON s.id=o.slot_id JOIN racks r ON r.id=s.rack_id WHERE r.room_id=? ORDER BY o.start_date,o.rowid",
            (room_id,),
        ),
        "placementTasks": payloads(
            conn,
            "SELECT payload FROM placement_tasks WHERE target_room_id=? ORDER BY planned_move_in_date,rowid",
            (room_id,),
        ),
    }
