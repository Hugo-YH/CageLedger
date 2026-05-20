import json

from server_app.cache import cache_get, cache_set

from .payload import read_payloads, read_setting, table_has_rows


def assemble_state(conn):
    if not any(table_has_rows(conn, table) for table in ("rooms", "racks", "cage_slots", "occupancies", "intake_batches")):
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
    rows = conn.execute("SELECT payload FROM experiment_applications ORDER BY rowid").fetchall()
    applications = {}
    for row in rows:
        item = json.loads(row["payload"])
        key = normalize_iacuc_number(item.get("iacuc", ""))
        if key and key not in applications:
            applications[key] = item
    return applications
