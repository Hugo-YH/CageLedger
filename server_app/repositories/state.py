import json

from server_app.cache import cache_get, cache_set
from server_app.shared import as_float, as_int

from .payload import dump_json, read_payloads, read_setting, set_setting, table_has_rows

STATE_TABLES = (
    "audit_logs",
    "billing_adjustments",
    "billing_rules",
    "occupancies",
    "placement_tasks",
    "cage_slots",
    "intake_batches",
    "racks",
    "rooms",
    "app_settings",
)


def _placeholders(values):
    return ", ".join("?" for _ in values)


def read_payloads_by_ids(conn, table, ids, order_by="rowid"):
    id_list = sorted({str(item).strip() for item in ids if item is not None and str(item).strip()})
    if not id_list:
        return []
    rows = conn.execute(
        f"SELECT payload FROM {table} WHERE id IN ({_placeholders(id_list)}) ORDER BY {order_by}", tuple(id_list)
    ).fetchall()
    return [json.loads(row["payload"]) for row in rows]


def read_occupancy_payloads_for_billing(conn, start, end, iacuc="", pi=""):
    clauses = [
        "status IN ('active', 'ended')",
        "start_date <> ''",
        "start_date <= ?",
        "(end_date IS NULL OR end_date = '' OR end_date >= ?)",
    ]
    params = [end, start]
    if iacuc:
        clauses.append("iacuc = ?")
        params.append(iacuc)
    if pi:
        clauses.append("pi = ?")
        params.append(pi)
    rows = conn.execute(
        f"SELECT payload FROM occupancies WHERE {' AND '.join(clauses)} ORDER BY start_date, rowid", tuple(params)
    ).fetchall()
    return [json.loads(row["payload"]) for row in rows]


def read_rack_room_map(conn, rack_ids):
    ids = sorted({str(item).strip() for item in rack_ids if item is not None and str(item).strip()})
    if not ids:
        return {}
    rows = conn.execute(f"SELECT id, room_id FROM racks WHERE id IN ({_placeholders(ids)})", ids).fetchall()
    return {row["id"]: row["room_id"] for row in rows}


def read_slot_room_map(conn, slot_ids):
    ids = sorted({str(item).strip() for item in slot_ids if item is not None and str(item).strip()})
    if not ids:
        return {}
    rows = conn.execute(
        f"""
        SELECT slots.id AS slot_id, racks.room_id AS room_id
        FROM cage_slots AS slots
        JOIN racks ON racks.id = slots.rack_id
        WHERE slots.id IN ({_placeholders(ids)})
        """,
        ids,
    ).fetchall()
    return {row["slot_id"]: row["room_id"] for row in rows}


def assemble_state(conn):
    if not any(
        table_has_rows(conn, table) for table in ("rooms", "racks", "cage_slots", "occupancies", "intake_batches")
    ):
        return None
    return {
        "baseRate": read_setting(conn, "baseRate", 4.5),
        "billingMonth": read_setting(conn, "billingMonth", ""),
        "billingIacuc": read_setting(conn, "billingIacuc", ""),
        "rooms": read_payloads(conn, "rooms", "rowid"),
        "racks": read_payloads(conn, "racks", "room_id, index_no, rowid"),
        "slots": read_payloads(conn, "cage_slots", "rack_id, row_no, col_no, rowid"),
        "occupancies": read_payloads(conn, "occupancies", "start_date, rowid"),
        "placementTasks": read_payloads(conn, "placement_tasks", "planned_move_in_date, rowid"),
        "billingRules": read_payloads(conn, "billing_rules", "rowid"),
        "adjustments": read_payloads(conn, "billing_adjustments", "rowid"),
        "intakeBatches": read_payloads(conn, "intake_batches", "updated_at DESC, rowid DESC"),
        "auditLogs": read_payloads(conn, "audit_logs", "at DESC, rowid DESC"),
    }


def read_cached_state(conn, empty_state_factory):
    cached = cache_get("assembled_state")
    if cached is not None:
        return cached
    return cache_set("assembled_state", assemble_state(conn) or empty_state_factory())


def read_applications_by_iacuc(conn, normalize_iacuc_number):
    cached = cache_get("applications_by_iacuc")
    if cached is not None:
        return cached
    rows = conn.execute("SELECT payload FROM experiment_applications ORDER BY rowid").fetchall()
    applications = {}
    for row in rows:
        item = json.loads(row["payload"])
        key = normalize_iacuc_number(item.get("iacuc", ""))
        if key and key not in applications:
            applications[key] = item
    return cache_set("applications_by_iacuc", applications)


def write_normalized_state(
    conn,
    state,
    updated_at,
    *,
    normalize_iacuc_number,
    occupancy_with_snapshots,
    occupancy_structured_values,
):
    for table in STATE_TABLES:
        conn.execute(f"DELETE FROM {table}")

    applications_by_iacuc = read_applications_by_iacuc(conn, normalize_iacuc_number)
    set_setting(conn, "baseRate", state.get("baseRate", 4.5), updated_at)
    set_setting(conn, "billingMonth", state.get("billingMonth", ""), updated_at)
    set_setting(conn, "billingIacuc", state.get("billingIacuc", ""), updated_at)

    for room in state.get("rooms", []):
        conn.execute(
            """
            INSERT INTO rooms (id, name, area, rack_count, rows, cols, payload)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            (
                room.get("id"),
                room.get("name", ""),
                room.get("area", ""),
                as_int(room.get("rackCount")),
                as_int(room.get("rows")),
                as_int(room.get("cols")),
                dump_json(room),
            ),
        )

    for rack in state.get("racks", []):
        conn.execute(
            """
            INSERT INTO racks (id, room_id, name, rows, cols, index_no, payload)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            (
                rack.get("id"),
                rack.get("roomId"),
                rack.get("name", ""),
                as_int(rack.get("rows")),
                as_int(rack.get("cols")),
                as_int(rack.get("index")),
                dump_json(rack),
            ),
        )

    for slot in state.get("slots", []):
        conn.execute(
            """
            INSERT INTO cage_slots (id, rack_id, row_no, col_no, code, status, payload)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            (
                slot.get("id"),
                slot.get("rackId"),
                as_int(slot.get("row")),
                as_int(slot.get("col")),
                slot.get("code", ""),
                slot.get("status", "empty"),
                dump_json(slot),
            ),
        )

    for occupancy_item in state.get("occupancies", []):
        occupancy = occupancy_with_snapshots(occupancy_item, state, applications_by_iacuc)
        structured = occupancy_structured_values(occupancy)
        conn.execute(
            """
            INSERT INTO occupancies (
                id, slot_id, room_id, rack_id, cage_code, status, iacuc, project, pi, owner, funding,
                species, billing_item, customer_type, animal_count, room_name, rack_name, slot_code,
                start_date, end_date, end_reason, notes, updated_at, payload
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                occupancy.get("id"),
                occupancy.get("slotId"),
                structured["room_id"],
                structured["rack_id"],
                occupancy.get("cageCode", ""),
                occupancy.get("status", ""),
                occupancy.get("iacuc", ""),
                occupancy.get("project", ""),
                occupancy.get("pi", ""),
                occupancy.get("owner", ""),
                occupancy.get("funding", ""),
                structured["species"],
                structured["billing_item"],
                structured["customer_type"],
                structured["animal_count"],
                occupancy.get("roomName", ""),
                occupancy.get("rackName", ""),
                occupancy.get("slotCode", ""),
                occupancy.get("startDate", ""),
                occupancy.get("endDate", ""),
                occupancy.get("endReason", ""),
                occupancy.get("notes", ""),
                occupancy.get("updatedAt", ""),
                dump_json(occupancy),
            ),
        )

    for task in state.get("placementTasks", []):
        conn.execute(
            """
            INSERT INTO placement_tasks (
                id, source_batch_id, source_receipt_id, target_room_id, planned_move_in_date,
                status, reserved_occupancy_id, actual_move_in_date, updated_at, payload
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                task.get("id"),
                task.get("sourceBatchId", ""),
                task.get("sourceReceiptId", ""),
                task.get("targetRoomId", ""),
                task.get("plannedMoveInDate", ""),
                task.get("status", "pending"),
                task.get("reservedOccupancyId", ""),
                task.get("actualMoveInDate", ""),
                task.get("updatedAt", updated_at),
                dump_json(task),
            ),
        )

    for rule in state.get("billingRules", []):
        conn.execute(
            """
            INSERT INTO billing_rules (id, name, unit, price, effective_start, effective_end, payload)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            (
                rule.get("id"),
                rule.get("name", ""),
                rule.get("unit", ""),
                as_float(rule.get("price")),
                rule.get("effectiveStart", ""),
                rule.get("effectiveEnd", ""),
                dump_json(rule),
            ),
        )

    for adjustment in state.get("adjustments", []):
        conn.execute(
            """
            INSERT INTO billing_adjustments (
                id, target_type, target_id, adjustment_type, value, reason,
                effective_start, effective_end, payload
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                adjustment.get("id"),
                adjustment.get("targetType", ""),
                adjustment.get("targetId", ""),
                adjustment.get("type", ""),
                as_float(adjustment.get("value")),
                adjustment.get("reason", ""),
                adjustment.get("effectiveStart", ""),
                adjustment.get("effectiveEnd", ""),
                dump_json(adjustment),
            ),
        )

    for batch in state.get("intakeBatches", []):
        conn.execute(
            """
            INSERT INTO intake_batches (
                id, batch_no, iacuc, supplier, pi, owner, quantity, card_count,
                room_name, intake_date, status, updated_at, payload
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                batch.get("id"),
                batch.get("batchNo", ""),
                batch.get("iacuc", ""),
                batch.get("supplier", ""),
                batch.get("pi", ""),
                batch.get("owner", ""),
                as_int(batch.get("quantity")) or 0,
                as_int(batch.get("finalCardCount")) or 0,
                batch.get("roomName", ""),
                batch.get("intakeDate", ""),
                batch.get("status", "draft"),
                batch.get("updatedAt", updated_at),
                dump_json(batch),
            ),
        )

    for log in state.get("auditLogs", []):
        conn.execute(
            """
            INSERT INTO audit_logs (id, message, at, payload)
            VALUES (?, ?, ?, ?)
            """,
            (log.get("id"), log.get("message", ""), log.get("at", ""), dump_json(log)),
        )


def upsert_occupancy_record(conn, occupancy, occupancy_structured_values):
    structured = occupancy_structured_values(occupancy)
    conn.execute(
        """
        INSERT INTO occupancies (
            id, slot_id, room_id, rack_id, cage_code, status, iacuc, project, pi, owner, funding,
            species, billing_item, customer_type, animal_count, room_name, rack_name, slot_code,
            start_date, end_date, end_reason, notes, updated_at, payload
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
            slot_id = excluded.slot_id,
            room_id = excluded.room_id,
            rack_id = excluded.rack_id,
            cage_code = excluded.cage_code,
            status = excluded.status,
            iacuc = excluded.iacuc,
            project = excluded.project,
            pi = excluded.pi,
            owner = excluded.owner,
            funding = excluded.funding,
            species = excluded.species,
            billing_item = excluded.billing_item,
            customer_type = excluded.customer_type,
            animal_count = excluded.animal_count,
            room_name = excluded.room_name,
            rack_name = excluded.rack_name,
            slot_code = excluded.slot_code,
            start_date = excluded.start_date,
            end_date = excluded.end_date,
            end_reason = excluded.end_reason,
            notes = excluded.notes,
            updated_at = excluded.updated_at,
            payload = excluded.payload
        """,
        (
            occupancy.get("id"),
            occupancy.get("slotId"),
            structured["room_id"],
            structured["rack_id"],
            occupancy.get("cageCode", ""),
            occupancy.get("status", ""),
            occupancy.get("iacuc", ""),
            occupancy.get("project", ""),
            occupancy.get("pi", ""),
            occupancy.get("owner", ""),
            occupancy.get("funding", ""),
            structured["species"],
            structured["billing_item"],
            structured["customer_type"],
            structured["animal_count"],
            occupancy.get("roomName", ""),
            occupancy.get("rackName", ""),
            occupancy.get("slotCode", ""),
            occupancy.get("startDate", ""),
            occupancy.get("endDate", ""),
            occupancy.get("endReason", ""),
            occupancy.get("notes", ""),
            occupancy.get("updatedAt", ""),
            dump_json(occupancy),
        ),
    )
