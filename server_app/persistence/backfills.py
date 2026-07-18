import json

from server_app.repositories.payload import dump_json
from server_app.shared import clean_text


def ensure_animal_inspection_finding_location_schema(conn):
    table_exists = conn.execute(
        "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'animal_inspection_findings'"
    ).fetchone()
    if table_exists is None:
        return
    columns = {row[1] for row in conn.execute("PRAGMA table_info(animal_inspection_findings)")}
    for column, column_type in {"rack_hint": "TEXT", "cage_number": "TEXT"}.items():
        if column not in columns:
            conn.execute(f"ALTER TABLE animal_inspection_findings ADD COLUMN {column} {column_type}")


def backfill_quantity_sheet_staff(conn, room_ids=None):
    ensure_animal_inspection_finding_location_schema(conn)
    room_filter = {clean_text(item) for item in (room_ids or []) if clean_text(item)}
    room_rows = conn.execute("SELECT id, name, payload FROM rooms ORDER BY rowid").fetchall()
    rooms_by_id = {}
    rooms_by_name = {}
    for row in room_rows:
        payload = json.loads(row["payload"])
        room_manager = clean_text(payload.get("roomManager", ""))
        room_id = clean_text(row["id"])
        room_name = clean_text(row["name"])
        rooms_by_id[room_id] = room_manager
        if room_name and room_name not in rooms_by_name:
            rooms_by_name[room_name] = room_manager

    audit_actor_by_sheet = {}
    audit_rows = conn.execute(
        """
        SELECT entity_id, actor_display_name
        FROM audit_events
        WHERE entity_type = 'quantity_sheet' AND COALESCE(actor_display_name, '') <> ''
        ORDER BY at DESC, rowid DESC
        """
    ).fetchall()
    for row in audit_rows:
        sheet_id = clean_text(row["entity_id"])
        if sheet_id and sheet_id not in audit_actor_by_sheet:
            audit_actor_by_sheet[sheet_id] = clean_text(row["actor_display_name"])

    rows = conn.execute(
        "SELECT id, room_id, room_name, manager, payload FROM quantity_sheets ORDER BY rowid"
    ).fetchall()
    updated = 0
    for row in rows:
        room_id = clean_text(row["room_id"])
        if room_filter and room_id not in room_filter:
            continue
        payload = json.loads(row["payload"])
        registration_staff = clean_text(payload.get("manager", "") or row["manager"])
        if not registration_staff:
            registration_staff = audit_actor_by_sheet.get(clean_text(row["id"]), "")
        room_manager = clean_text(payload.get("roomManager", ""))
        if not room_manager:
            room_manager = rooms_by_id.get(room_id, "") or rooms_by_name.get(clean_text(row["room_name"]), "")
        if payload.get("manager", "") == registration_staff and payload.get("roomManager", "") == room_manager:
            continue
        payload["manager"] = registration_staff
        payload["roomManager"] = room_manager
        conn.execute(
            "UPDATE quantity_sheets SET manager = ?, payload = ? WHERE id = ?",
            (registration_staff, dump_json(payload), row["id"]),
        )
        updated += 1
    return updated
