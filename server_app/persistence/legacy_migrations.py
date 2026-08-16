"""Legacy table migrations that remain compatible with existing SQLite files."""

import json
from collections.abc import Callable

from server_app.repositories.payload import dump_json
from server_app.shared import as_int, clean_text


def table_columns(conn, table):
    return {
        row["name"]: {"type": row["type"], "notnull": row["notnull"], "default": row["dflt_value"], "pk": row["pk"]}
        for row in conn.execute(f'PRAGMA table_info("{table}")').fetchall()
    }


def ensure_experiment_applications_duplicate_schema(conn):
    columns = table_columns(conn, "experiment_applications")
    pk_column = next((name for name, info in columns.items() if info.get("pk")), "")
    if "id" in columns and pk_column == "id":
        return

    conn.execute("ALTER TABLE experiment_applications RENAME TO experiment_applications_legacy")
    conn.execute(
        """
        CREATE TABLE experiment_applications (
            id TEXT PRIMARY KEY,
            iacuc TEXT NOT NULL,
            raw_iacuc TEXT,
            project TEXT,
            pi TEXT,
            owner TEXT,
            funding TEXT,
            imported_at TEXT NOT NULL,
            payload TEXT NOT NULL
        )
        """
    )
    rows = conn.execute("SELECT rowid, * FROM experiment_applications_legacy ORDER BY rowid").fetchall()
    for index, row in enumerate(rows, start=1):
        payload = json.loads(row["payload"])
        raw_iacuc = clean_text(payload.get("rawIacuc", "") or row["raw_iacuc"] or row["iacuc"])
        item = {
            **payload,
            "id": payload.get("id") or f"app-{index:06d}",
            "iacuc": clean_text(payload.get("iacuc", "") or raw_iacuc or row["iacuc"]),
            "rawIacuc": raw_iacuc,
        }
        conn.execute(
            """
            INSERT INTO experiment_applications (
                id, iacuc, raw_iacuc, project, pi, owner, funding, imported_at, payload
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                item["id"],
                item["iacuc"],
                item.get("rawIacuc", ""),
                item.get("project", ""),
                item.get("pi", ""),
                item.get("owner", ""),
                item.get("funding", ""),
                row["imported_at"],
                dump_json(item),
            ),
        )
    conn.execute("DROP TABLE experiment_applications_legacy")


def ensure_occupancies_structured_columns(conn, backfill: Callable):
    columns = table_columns(conn, "occupancies")
    additions = {
        "room_id": "TEXT",
        "rack_id": "TEXT",
        "species": "TEXT",
        "billing_item": "TEXT",
        "customer_type": "TEXT",
        "animal_count": "INTEGER",
    }
    changed = False
    for column, column_type in additions.items():
        if column in columns:
            continue
        conn.execute(f"ALTER TABLE occupancies ADD COLUMN {column} {column_type}")
        changed = True
    if changed:
        backfill(conn)


def backfill_occupancy_structured_columns(
    conn,
    *,
    assemble_state: Callable,
    empty_state: Callable,
    read_applications_by_iacuc: Callable,
    occupancy_with_snapshots: Callable,
    occupancy_structured_values: Callable,
):
    state = assemble_state(conn) or empty_state()
    applications_by_iacuc = read_applications_by_iacuc(conn)
    for occupancy in state.get("occupancies", []):
        normalized = occupancy_with_snapshots(occupancy, state, applications_by_iacuc)
        values = occupancy_structured_values(normalized)
        conn.execute(
            """
            UPDATE occupancies
            SET room_id = ?, rack_id = ?, species = ?, billing_item = ?,
                customer_type = ?, animal_count = ?, payload = ?
            WHERE id = ?
            """,
            (
                values["room_id"],
                values["rack_id"],
                values["species"],
                values["billing_item"],
                values["customer_type"],
                values["animal_count"],
                dump_json(normalized),
                normalized.get("id"),
            ),
        )


def ensure_intake_batch_structured_columns(conn):
    columns = table_columns(conn, "intake_batches")
    additions = {
        "pi": "TEXT",
        "owner": "TEXT",
        "quantity": "INTEGER",
        "card_count": "INTEGER",
    }
    changed = False
    for column, column_type in additions.items():
        if column in columns:
            continue
        conn.execute(f"ALTER TABLE intake_batches ADD COLUMN {column} {column_type}")
        changed = True
    if changed:
        backfill_intake_batch_structured_columns(conn)


def backfill_intake_batch_structured_columns(conn):
    rows = conn.execute("SELECT id, payload FROM intake_batches").fetchall()
    for row in rows:
        payload = json.loads(row["payload"])
        conn.execute(
            """
            UPDATE intake_batches
            SET pi = ?, owner = ?, quantity = ?, card_count = ?
            WHERE id = ?
            """,
            (
                clean_text(payload.get("pi", "")),
                clean_text(payload.get("owner", "")),
                as_int(payload.get("quantity")) or 0,
                as_int(payload.get("finalCardCount")) or 0,
                row["id"],
            ),
        )


def ensure_occupancies_history_schema(conn):
    columns = table_columns(conn, "occupancies")
    foreign_keys = conn.execute("PRAGMA foreign_key_list(occupancies)").fetchall()
    slot_not_null = bool(columns.get("slot_id", {}).get("notnull"))
    required_columns = {"funding", "room_name", "rack_name", "slot_code"}
    if not foreign_keys and not slot_not_null and required_columns.issubset(columns):
        return

    conn.execute("ALTER TABLE occupancies RENAME TO occupancies_legacy")
    conn.execute(
        """
        CREATE TABLE occupancies (
            id TEXT PRIMARY KEY,
            slot_id TEXT,
            room_id TEXT,
            rack_id TEXT,
            cage_code TEXT,
            status TEXT NOT NULL,
            iacuc TEXT,
            project TEXT,
            pi TEXT,
            owner TEXT,
            funding TEXT,
            species TEXT,
            billing_item TEXT,
            customer_type TEXT,
            animal_count INTEGER,
            room_name TEXT,
            rack_name TEXT,
            slot_code TEXT,
            start_date TEXT,
            end_date TEXT,
            end_reason TEXT,
            notes TEXT,
            updated_at TEXT,
            payload TEXT NOT NULL
        )
        """
    )
    rows = conn.execute("SELECT * FROM occupancies_legacy").fetchall()
    for row in rows:
        payload = json.loads(row["payload"])
        conn.execute(
            """
            INSERT INTO occupancies (
                id, slot_id, room_id, rack_id, cage_code, status, iacuc, project, pi, owner, funding,
                species, billing_item, customer_type, animal_count,
                room_name, rack_name, slot_code, start_date, end_date, end_reason,
                notes, updated_at, payload
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                row["id"],
                row["slot_id"],
                payload.get("roomId", ""),
                payload.get("rackId", ""),
                row["cage_code"],
                row["status"],
                row["iacuc"],
                row["project"],
                row["pi"],
                row["owner"],
                payload.get("funding", ""),
                payload.get("species", ""),
                payload.get("billingItem", ""),
                payload.get("customerType", ""),
                as_int(payload.get("animalCount")),
                payload.get("roomName", ""),
                payload.get("rackName", ""),
                payload.get("slotCode", ""),
                row["start_date"],
                row["end_date"],
                row["end_reason"],
                row["notes"],
                row["updated_at"],
                dump_json(payload),
            ),
        )
    conn.execute("DROP TABLE occupancies_legacy")
