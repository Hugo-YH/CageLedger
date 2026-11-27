"""Bounded infrastructure projections and room layout storage."""

import json

from server_app.repositories.payload import dump_json


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


def room_rack_sizes(conn, room_id):
    sizes = {}
    for row in conn.execute("SELECT id,payload FROM racks WHERE room_id=?", (room_id,)):
        rack = json.loads(row["payload"])
        sizes[row["id"]] = (rack.get("cols"), rack.get("rows"))
    return sizes


def read_rack_layout(conn, room_id):
    row = conn.execute(
        "SELECT placements_json,updated_at FROM room_rack_layouts WHERE room_id=?", (room_id,)
    ).fetchone()
    return {
        "placements": json.loads(row["placements_json"]) if row else [],
        "updatedAt": row["updated_at"] if row else "",
    }


def save_rack_layout(conn, room_id, layout):
    conn.execute(
        """
        INSERT INTO room_rack_layouts (room_id,placements_json,updated_at) VALUES (?,?,?)
        ON CONFLICT (room_id) DO UPDATE SET placements_json=excluded.placements_json, updated_at=excluded.updated_at
        """,
        (room_id, dump_json(layout["placements"]), layout["updatedAt"]),
    )


def room_occupancies(conn, room_id, current_only):
    source = "FROM occupancies o JOIN cage_slots s ON s.id=o.slot_id JOIN racks r ON r.id=s.rack_id"
    order = "ORDER BY o.start_date,o.rowid"
    if not current_only:
        return {"occupancies": payloads(conn, f"SELECT o.payload {source} WHERE r.room_id=? {order}", (room_id,))}

    rows = conn.execute(
        f"""
        SELECT o.id, o.payload,
            CASE WHEN json_type(o.payload,'$.strainStandard') IS NOT 'null' THEN COALESCE(
                NULLIF(TRIM(json_extract(o.payload,'$.strainStandard')), ''),
                NULLIF(TRIM(json_extract(o.payload,'$.strainRaw')), ''),
                NULLIF(TRIM(json_extract(t.payload,'$.strainStandard')), ''),
                NULLIF(TRIM(json_extract(t.payload,'$.strainRaw')), ''),
                NULLIF(TRIM(json_extract(b.payload,'$.strainStandard')), ''),
                NULLIF(TRIM(json_extract(b.payload,'$.strainRaw')), '')
            ) END AS strain,
            COALESCE(
                NULLIF(TRIM(json_extract(t.payload,'$.specification')), ''),
                NULLIF(TRIM(json_extract(b.payload,'$.specification')), '')
            ) AS specification,
            COALESCE(
                NULLIF(TRIM(json_extract(t.payload,'$.sex')), ''),
                NULLIF(TRIM(json_extract(b.payload,'$.sex')), '')
            ) AS sex
        {source}
        LEFT JOIN placement_tasks t ON t.id=json_extract(o.payload,'$.placementTaskId')
            AND t.target_room_id=r.room_id AND json_extract(t.payload,'$.reservedOccupancyId')=o.id
        LEFT JOIN intake_batches b ON b.id=t.source_batch_id
        WHERE r.room_id=? AND json_extract(o.payload,'$.status') IN ('active','reserved')
        {order}
        """,
        (room_id,),
    ).fetchall()
    result = {"occupancies": [json.loads(row["payload"]) for row in rows]}
    strains = {row["id"]: row["strain"] for row in rows if row["strain"]}
    if strains:
        result["occupancyStrains"] = strains
    intake_details = {
        row["id"]: {field: row[field] for field in ("specification", "sex") if row[field]}
        for row in rows
        if row["specification"] or row["sex"]
    }
    if intake_details:
        result["occupancyIntakeDetails"] = intake_details
    return result


def room_workspace(conn, room_id, *, current_only=False):
    task_filter = (
        " AND COALESCE(json_extract(payload,'$.status'),'') NOT IN ('active','cancelled')" if current_only else ""
    )
    return {
        "racks": payloads(conn, "SELECT payload FROM racks WHERE room_id=? ORDER BY index_no,rowid", (room_id,)),
        "slots": payloads(
            conn,
            "SELECT s.payload FROM cage_slots s JOIN racks r ON r.id=s.rack_id WHERE r.room_id=? ORDER BY s.rack_id,s.row_no,s.col_no,s.rowid",
            (room_id,),
        ),
        **room_occupancies(conn, room_id, current_only),
        "placementTasks": payloads(
            conn,
            f"SELECT payload FROM placement_tasks WHERE target_room_id=?{task_filter} ORDER BY planned_move_in_date,rowid",
            (room_id,),
        ),
    }
