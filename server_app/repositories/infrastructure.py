from .payload import dump_json


def insert_room_record(conn, room):
    conn.execute(
        """
        INSERT INTO rooms (id, name, area, rack_count, rows, cols, payload)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        """,
        (
            room.get("id"),
            room.get("name", ""),
            room.get("area", ""),
            _as_int(room.get("rackCount")),
            _as_int(room.get("rows")),
            _as_int(room.get("cols")),
            dump_json(room),
        ),
    )


def update_room_record(conn, room):
    conn.execute(
        """
        UPDATE rooms
        SET name = ?, area = ?, rack_count = ?, rows = ?, cols = ?, payload = ?
        WHERE id = ?
        """,
        (
            room.get("name", ""),
            room.get("area", ""),
            _as_int(room.get("rackCount")),
            _as_int(room.get("rows")),
            _as_int(room.get("cols")),
            dump_json(room),
            room.get("id"),
        ),
    )


def delete_room_record(conn, room_id):
    conn.execute("DELETE FROM rooms WHERE id = ?", (room_id,))


def insert_rack_record(conn, rack):
    conn.execute(
        """
        INSERT INTO racks (id, room_id, name, rows, cols, index_no, payload)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        """,
        (
            rack.get("id"),
            rack.get("roomId"),
            rack.get("name", ""),
            _as_int(rack.get("rows")),
            _as_int(rack.get("cols")),
            _as_int(rack.get("index")),
            dump_json(rack),
        ),
    )


def update_rack_record(conn, rack):
    conn.execute(
        """
        UPDATE racks
        SET room_id = ?, name = ?, rows = ?, cols = ?, index_no = ?, payload = ?
        WHERE id = ?
        """,
        (
            rack.get("roomId"),
            rack.get("name", ""),
            _as_int(rack.get("rows")),
            _as_int(rack.get("cols")),
            _as_int(rack.get("index")),
            dump_json(rack),
            rack.get("id"),
        ),
    )


def delete_rack_record(conn, rack_id):
    conn.execute("DELETE FROM racks WHERE id = ?", (rack_id,))


def insert_slot_record(conn, slot):
    conn.execute(
        """
        INSERT INTO cage_slots (id, rack_id, row_no, col_no, code, status, payload)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        """,
        (
            slot.get("id"),
            slot.get("rackId"),
            _as_int(slot.get("row")),
            _as_int(slot.get("col")),
            slot.get("code", ""),
            slot.get("status", "empty"),
            dump_json(slot),
        ),
    )


def delete_slot_record(conn, slot_id):
    conn.execute("DELETE FROM cage_slots WHERE id = ?", (slot_id,))


def _as_int(value):
    return int(value) if value not in (None, "") else None
