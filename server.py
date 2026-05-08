#!/usr/bin/env python3
import base64
import calendar
import csv
import hashlib
import hmac
import io
import json
import os
import re
import secrets
import sqlite3
from datetime import datetime, timedelta, timezone
from email.utils import format_datetime
from http import HTTPStatus
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import unquote, urlparse
from urllib.request import Request, urlopen


ROOT = Path(__file__).resolve().parent
DB_PATH = Path(os.environ.get("CAGELEDGER_DB", ROOT / "data" / "cageledger.sqlite"))
IACUC_INDEX_PATH = Path(os.environ.get("CAGELEDGER_IACUC_INDEX", DB_PATH.parent / "iacuc-index.json"))
LEGACY_IACUC_INDEX_PATH = ROOT / "src" / "iacuc-data.local.json"
HOST = os.environ.get("CAGELEDGER_HOST", "0.0.0.0")
PORT = int(os.environ.get("CAGELEDGER_PORT", "5173"))
MAX_BODY_BYTES = 10 * 1024 * 1024
SESSION_COOKIE = "cageledger_session"
SESSION_TTL_DAYS = 14
BILLING_PRINCIPAL_PI = "pi"
BILLING_PRINCIPAL_INDEPENDENT = "independent"
FREE_CAGES_PI = 20
FREE_CAGES_INDEPENDENT = 10
FREE_CAGES_DEFAULT = FREE_CAGES_PI
BILLING_TIER_LIMIT = 160
BILLING_TIER_BASE_PRICE = 4.5
BILLING_TIER_OVER_PRICE = 6.5
BILLING_RULES = {
    "mouse_standard": {"species": "mouse", "unit": "cage_day", "internalPrice": 4.5, "externalPrice": 13.5, "tiered": True, "freeAllowance": True},
    "mouse_diabetic": {"species": "mouse", "unit": "cage_day", "internalPrice": 7.2, "externalPrice": 21.6, "tiered": False, "freeAllowance": False},
    "rat_standard": {"species": "rat", "unit": "cage_day", "internalPrice": 8.5, "externalPrice": 25.5, "tiered": False, "freeAllowance": False},
    "rat_diabetic": {"species": "rat", "unit": "cage_day", "internalPrice": 14, "externalPrice": 42, "tiered": False, "freeAllowance": False},
    "guinea_pig": {"species": "guinea_pig", "unit": "animal_day", "internalPrice": 3, "externalPrice": 9, "tiered": False, "freeAllowance": False},
    "rabbit": {"species": "rabbit", "unit": "animal_day", "internalPrice": 5, "externalPrice": 15, "tiered": False, "freeAllowance": False},
    "monkey": {"species": "monkey", "unit": "animal_day", "internalPrice": 35, "externalPrice": 65, "tiered": False, "freeAllowance": False},
    "pig": {"species": "pig", "unit": "animal_day", "internalPrice": 15, "externalPrice": 45, "tiered": False, "freeAllowance": False},
    "dog": {"species": "dog", "unit": "animal_day", "internalPrice": 15, "externalPrice": 45, "tiered": False, "freeAllowance": False},
}
WORKFLOW_STATUS_IN_FEEDING = "in_feeding"
WORKFLOW_STATUS_GENERATED = "statement_generated"
WORKFLOW_STATUS_SENT = "statement_sent"
WORKFLOW_STATUS_SIGNED = "statement_signed_returned"
WORKFLOW_STATUS_FINANCE = "submitted_to_finance"
WORKFLOW_STATUSES = (
    WORKFLOW_STATUS_IN_FEEDING,
    WORKFLOW_STATUS_GENERATED,
    WORKFLOW_STATUS_SENT,
    WORKFLOW_STATUS_SIGNED,
    WORKFLOW_STATUS_FINANCE,
)
VERSION_STATUS_ACTIVE = "active"
VERSION_STATUS_VOIDED = "voided"
DEFAULT_ADMIN_USERNAME = os.environ.get("CAGELEDGER_ADMIN_USERNAME", "admin")
DEFAULT_ADMIN_PASSWORD = os.environ.get("CAGELEDGER_ADMIN_PASSWORD", "admin123")
CAGELEDGER_VERSION = os.environ.get("CAGELEDGER_VERSION", "").strip()
CAGELEDGER_APP_VERSION = os.environ.get("CAGELEDGER_APP_VERSION", "").strip()
CAGELEDGER_ORGANIZATION = os.environ.get("CAGELEDGER_ORGANIZATION", "中山大学中山眼科中心").strip()
CAGELEDGER_DEPARTMENT = os.environ.get("CAGELEDGER_DEPARTMENT", "实验动物中心").strip()
CAGELEDGER_DEVELOPER = os.environ.get("CAGELEDGER_DEVELOPER", "Hugo").strip()
CAGELEDGER_CONTACT_EMAIL = os.environ.get("CAGELEDGER_CONTACT_EMAIL", "info@cellnucle.us").strip()
CAGELEDGER_LICENSE = os.environ.get("CAGELEDGER_LICENSE", "Apache-2.0").strip()
CAGELEDGER_COPYRIGHT = os.environ.get(
    "CAGELEDGER_COPYRIGHT",
    f"© 2026 {CAGELEDGER_ORGANIZATION} {CAGELEDGER_DEPARTMENT}. Licensed under Apache-2.0.",
).strip()
CAGELEDGER_REPOSITORY = os.environ.get("CAGELEDGER_REPOSITORY", "Hugo-YH/CageLedger")
CAGELEDGER_BRANCH = os.environ.get("CAGELEDGER_BRANCH", "main")
TABLES = (
    "audit_logs",
    "billing_adjustments",
    "billing_rules",
    "occupancies",
    "cage_slots",
    "racks",
    "rooms",
    "app_settings",
)
ENTITY_ENDPOINTS = {
    "/api/rooms": "rooms",
    "/api/racks": "racks",
    "/api/cage-slots": "cage_slots",
    "/api/occupancies": "occupancies",
    "/api/billing-rules": "billing_rules",
    "/api/billing-adjustments": "billing_adjustments",
    "/api/experiment-applications": "experiment_applications",
    "/api/billing-statements": "billing_statements",
    "/api/billing-statement-lines": "billing_statement_lines",
    "/api/audit-events": "audit_events",
}
ENTITY_ORDER_BY = {
    "rooms": "rowid",
    "racks": "room_id, index_no, rowid",
    "cage_slots": "rack_id, row_no, col_no, rowid",
    "occupancies": "start_date, rowid",
    "billing_rules": "rowid",
    "billing_adjustments": "rowid",
    "experiment_applications": "iacuc",
    "billing_statements": "month DESC, iacuc, rowid DESC",
    "billing_statement_lines": "statement_id, line_date, rowid",
}
WRITABLE_ENTITY_ENDPOINTS = {
    "/api/rooms": {"collection": "rooms", "id_prefix": "room"},
    "/api/racks": {"collection": "racks", "id_prefix": "rack"},
    "/api/cage-slots": {"collection": "slots", "id_prefix": "slot"},
    "/api/occupancies": {"collection": "occupancies", "id_prefix": "occ"},
    "/api/billing-rules": {"collection": "billingRules", "id_prefix": "rule"},
    "/api/billing-adjustments": {"collection": "adjustments", "id_prefix": "adj"},
}


def connect_db():
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    initialize_schema(conn)
    return conn


def initialize_schema(conn):
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS app_state (
            id TEXT PRIMARY KEY,
            payload TEXT NOT NULL,
            updated_at TEXT NOT NULL
        )
        """
    )
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS app_settings (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL,
            updated_at TEXT NOT NULL
        )
        """
    )
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS rooms (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            area TEXT,
            rack_count INTEGER,
            rows INTEGER,
            cols INTEGER,
            payload TEXT NOT NULL
        )
        """
    )
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS racks (
            id TEXT PRIMARY KEY,
            room_id TEXT NOT NULL,
            name TEXT NOT NULL,
            rows INTEGER,
            cols INTEGER,
            index_no INTEGER,
            payload TEXT NOT NULL,
            FOREIGN KEY(room_id) REFERENCES rooms(id) ON DELETE CASCADE
        )
        """
    )
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS cage_slots (
            id TEXT PRIMARY KEY,
            rack_id TEXT NOT NULL,
            row_no INTEGER,
            col_no INTEGER,
            code TEXT,
            status TEXT,
            payload TEXT NOT NULL,
            FOREIGN KEY(rack_id) REFERENCES racks(id) ON DELETE CASCADE
        )
        """
    )
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS occupancies (
            id TEXT PRIMARY KEY,
            slot_id TEXT,
            cage_code TEXT,
            status TEXT NOT NULL,
            iacuc TEXT,
            project TEXT,
            pi TEXT,
            owner TEXT,
            funding TEXT,
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
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS experiment_applications (
            iacuc TEXT PRIMARY KEY,
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
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS principal_identities (
            pi TEXT PRIMARY KEY,
            principal_type TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            payload TEXT NOT NULL
        )
        """
    )
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS billing_rules (
            id TEXT PRIMARY KEY,
            name TEXT,
            unit TEXT,
            price REAL,
            effective_start TEXT,
            effective_end TEXT,
            payload TEXT NOT NULL
        )
        """
    )
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS billing_adjustments (
            id TEXT PRIMARY KEY,
            target_type TEXT,
            target_id TEXT,
            adjustment_type TEXT,
            value REAL,
            reason TEXT,
            effective_start TEXT,
            effective_end TEXT,
            payload TEXT NOT NULL
        )
        """
    )
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS quantity_sheets (
            id TEXT PRIMARY KEY,
            month TEXT NOT NULL,
            iacuc TEXT NOT NULL,
            room_id TEXT,
            room_name TEXT,
            manager TEXT,
            project TEXT,
            pi TEXT,
            owner TEXT,
            funding TEXT,
            updated_at TEXT NOT NULL,
            payload TEXT NOT NULL
        )
        """
    )
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS billing_statements (
            id TEXT PRIMARY KEY,
            iacuc TEXT NOT NULL,
            month TEXT NOT NULL,
            project TEXT,
            pi TEXT,
            owner TEXT,
            funding TEXT,
            total_cage_days INTEGER,
            total_amount REAL,
            status TEXT NOT NULL,
            generated_at TEXT NOT NULL,
            locked_at TEXT,
            payload TEXT NOT NULL
        )
        """
    )
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS billing_statement_lines (
            id TEXT PRIMARY KEY,
            statement_id TEXT NOT NULL,
            line_date TEXT NOT NULL,
            cage_count INTEGER,
            unit_price REAL,
            discount_percent REAL,
            amount REAL,
            cumulative REAL,
            occupancy_ids TEXT,
            payload TEXT NOT NULL,
            FOREIGN KEY(statement_id) REFERENCES billing_statements(id) ON DELETE CASCADE
        )
        """
    )
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS billing_workflows (
            id TEXT PRIMARY KEY,
            business_key TEXT NOT NULL UNIQUE,
            iacuc TEXT NOT NULL,
            month TEXT NOT NULL,
            source_type TEXT NOT NULL,
            workflow_status TEXT NOT NULL,
            current_version_id TEXT,
            current_version_no INTEGER NOT NULL DEFAULT 0,
            latest_event_at TEXT,
            payload TEXT NOT NULL
        )
        """
    )
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS billing_statement_versions (
            id TEXT PRIMARY KEY,
            workflow_id TEXT NOT NULL,
            version_no INTEGER NOT NULL,
            version_status TEXT NOT NULL,
            workflow_status TEXT NOT NULL,
            generated_at TEXT NOT NULL,
            voided_at TEXT,
            created_by TEXT,
            payload TEXT NOT NULL,
            FOREIGN KEY(workflow_id) REFERENCES billing_workflows(id) ON DELETE CASCADE
        )
        """
    )
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS billing_statement_version_lines (
            id TEXT PRIMARY KEY,
            version_id TEXT NOT NULL,
            line_date TEXT NOT NULL,
            payload TEXT NOT NULL,
            FOREIGN KEY(version_id) REFERENCES billing_statement_versions(id) ON DELETE CASCADE
        )
        """
    )
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS billing_workflow_events (
            id TEXT PRIMARY KEY,
            workflow_id TEXT NOT NULL,
            version_id TEXT,
            event_type TEXT NOT NULL,
            from_status TEXT,
            to_status TEXT,
            at TEXT NOT NULL,
            payload TEXT NOT NULL,
            FOREIGN KEY(workflow_id) REFERENCES billing_workflows(id) ON DELETE CASCADE,
            FOREIGN KEY(version_id) REFERENCES billing_statement_versions(id) ON DELETE SET NULL
        )
        """
    )
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS audit_logs (
            id TEXT PRIMARY KEY,
            message TEXT,
            at TEXT,
            payload TEXT NOT NULL
        )
        """
    )
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS users (
            id TEXT PRIMARY KEY,
            username TEXT NOT NULL UNIQUE,
            display_name TEXT NOT NULL,
            password_hash TEXT NOT NULL,
            role TEXT NOT NULL,
            room_ids TEXT NOT NULL,
            active INTEGER NOT NULL DEFAULT 1,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        )
        """
    )
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS sessions (
            token_hash TEXT PRIMARY KEY,
            user_id TEXT NOT NULL,
            created_at TEXT NOT NULL,
            expires_at TEXT NOT NULL,
            FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
        )
        """
    )
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS audit_events (
            id TEXT PRIMARY KEY,
            actor_user_id TEXT,
            actor_username TEXT,
            actor_display_name TEXT,
            action TEXT NOT NULL,
            entity_type TEXT NOT NULL,
            entity_id TEXT,
            message TEXT NOT NULL,
            slot_ids TEXT NOT NULL,
            at TEXT NOT NULL,
            payload TEXT NOT NULL
        )
        """
    )
    migrate_schema(conn)
    repair_missing_cage_slots(conn)
    conn.commit()
    ensure_default_admin(conn)


def migrate_schema(conn):
    ensure_occupancies_history_schema(conn)
    migrate_billing_workflow_schema(conn)
    backfill_billing_workflow_scope(conn)


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
            cage_code TEXT,
            status TEXT NOT NULL,
            iacuc TEXT,
            project TEXT,
            pi TEXT,
            owner TEXT,
            funding TEXT,
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
                id, slot_id, cage_code, status, iacuc, project, pi, owner, funding,
                room_name, rack_name, slot_code, start_date, end_date, end_reason,
                notes, updated_at, payload
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                row["id"],
                row["slot_id"],
                row["cage_code"],
                row["status"],
                row["iacuc"],
                row["project"],
                row["pi"],
                row["owner"],
                payload.get("funding", ""),
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


def migrate_billing_workflow_schema(conn):
    if table_has_rows(conn, "billing_workflows"):
        return
    if not table_has_rows(conn, "billing_statements"):
        return

    rows = conn.execute(
        "SELECT id, payload, generated_at, rowid FROM billing_statements ORDER BY month, iacuc, generated_at, rowid"
    ).fetchall()
    grouped = {}
    for row in rows:
        statement = json.loads(row["payload"])
        source_type = normalize_workflow_source(statement.get("sourceType", ""))
        scope_type, scope_key = workflow_scope_for_statement(statement)
        business_key = billing_workflow_business_key(scope_type, scope_key, statement.get("month", ""), source_type)
        grouped.setdefault(business_key, []).append((row, statement, source_type))

    for items in grouped.values():
        first_statement = items[0][1]
        source_type = items[0][2]
        workflow_id = new_id("bwf")
        versions = []
        latest_at = ""
        for index, (row, statement, grouped_source) in enumerate(items, start=1):
            version_id = row["id"]
            generated_at = statement.get("generatedAt") or row["generated_at"] or now_iso()
            lines = [
                json.loads(line_row["payload"])
                for line_row in conn.execute(
                    "SELECT payload FROM billing_statement_lines WHERE statement_id = ? ORDER BY line_date, rowid",
                    (row["id"],),
                ).fetchall()
            ]
            version_status = VERSION_STATUS_ACTIVE if index == len(items) else VERSION_STATUS_VOIDED
            workflow_status = WORKFLOW_STATUS_GENERATED
            document_number = statement.get("documentNumber") or make_statement_document_number(statement, index)
            enriched = enrich_statement_for_workflow(
                statement,
                workflow_id=workflow_id,
                version_id=version_id,
                version_no=index,
                version_status=version_status,
                workflow_status=workflow_status,
                document_number=document_number,
            )
            version_payload = build_version_payload(
                enriched,
                workflow_id,
                index,
                version_status,
                workflow_status,
                generated_at,
                "",
                "",
                "",
            )
            conn.execute(
                """
                INSERT INTO billing_statement_versions (
                    id, workflow_id, version_no, version_status, workflow_status,
                    generated_at, voided_at, created_by, payload
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    version_id,
                    workflow_id,
                    index,
                    version_status,
                    workflow_status,
                    generated_at,
                    generated_at if version_status == VERSION_STATUS_VOIDED else "",
                    "",
                    dump_json(version_payload),
                ),
            )
            for line in lines:
                conn.execute(
                    """
                    INSERT INTO billing_statement_version_lines (id, version_id, line_date, payload)
                    VALUES (?, ?, ?, ?)
                    """,
                    (line.get("id") or new_id("line"), version_id, line.get("date", ""), dump_json(line)),
                )
            event_at = generated_at
            event_payload = build_workflow_event_payload(
                new_id("wevt"),
                workflow_id,
                version_id,
                "statement_generated",
                "",
                WORKFLOW_STATUS_GENERATED,
                {
                    "displayName": "系统迁移",
                    "username": "system",
                    "id": "system",
                },
                event_at,
                "system",
                "由旧版 billing_statements 迁移生成",
            )
            conn.execute(
                """
                INSERT INTO billing_workflow_events (
                    id, workflow_id, version_id, event_type, from_status, to_status, at, payload
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    event_payload["id"],
                    workflow_id,
                    version_id,
                    event_payload["eventType"],
                    event_payload["fromStatus"],
                    event_payload["toStatus"],
                    event_payload["at"],
                    dump_json(event_payload),
                ),
            )
            versions.append(version_payload)
            latest_at = max(latest_at, generated_at)

        current_version = versions[-1]
        workflow_payload = build_workflow_payload(
            workflow_id,
            first_statement.get("iacuc", ""),
            first_statement.get("month", ""),
            source_type,
            WORKFLOW_STATUS_GENERATED,
            current_version,
            latest_at,
        )
        conn.execute(
            """
            INSERT INTO billing_workflows (
                id, business_key, iacuc, month, source_type, workflow_status,
                current_version_id, current_version_no, latest_event_at, payload
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                workflow_id,
                workflow_payload.get("businessKey", ""),
                first_statement.get("iacuc", ""),
                first_statement.get("month", ""),
                grouped_source,
                WORKFLOW_STATUS_GENERATED,
                current_version["id"],
                current_version["versionNo"],
                latest_at,
                dump_json(workflow_payload),
            ),
        )


def backfill_billing_workflow_scope(conn):
    rows = conn.execute("SELECT id, payload FROM billing_workflows").fetchall()
    for row in rows:
        workflow = json.loads(row["payload"])
        current_version = workflow.get("currentVersion") or {}
        statement = current_version.get("statement") or {}
        scope_type, scope_key = workflow_scope_for_statement(statement)
        desired_key = billing_workflow_business_key(scope_type, scope_key, workflow.get("month", ""), workflow.get("sourceType", ""))
        conflict = conn.execute(
            "SELECT id FROM billing_workflows WHERE business_key = ? AND id != ?",
            (desired_key, row["id"]),
        ).fetchone()
        if conflict:
            desired_key = f"{desired_key}|legacy|{row['id']}"
        if workflow.get("scopeType") == scope_type and workflow.get("scopeKey") == scope_key and desired_key == workflow.get("businessKey"):
            continue
        workflow["scopeType"] = scope_type
        workflow["scopeKey"] = scope_key
        workflow["businessKey"] = desired_key
        workflow["iacucs"] = statement.get("iacucs", workflow.get("iacucs", []))
        conn.execute(
            """
            UPDATE billing_workflows
            SET business_key = ?, payload = ?
            WHERE id = ?
            """,
            (desired_key, dump_json(workflow), row["id"]),
        )


def table_columns(conn, table):
    return {
        row["name"]: {"type": row["type"], "notnull": bool(row["notnull"])}
        for row in conn.execute(f"PRAGMA table_info({table})").fetchall()
    }


def repair_missing_cage_slots(conn):
    racks = conn.execute("SELECT id, rows, cols FROM racks").fetchall()
    if not racks:
        return

    existing_rows = conn.execute("SELECT rack_id, row_no, col_no FROM cage_slots").fetchall()
    existing_positions = {
        (row["rack_id"], int(row["row_no"] or 0), int(row["col_no"] or 0))
        for row in existing_rows
    }
    for rack in racks:
        rows = max(as_int(rack["rows"]) or 0, 0)
        cols = max(as_int(rack["cols"]) or 0, 0)
        for row_no in range(1, rows + 1):
            for col_no in range(1, cols + 1):
                position = (rack["id"], row_no, col_no)
                if position in existing_positions:
                    continue
                slot = {
                    "id": slot_id_for_rack(rack["id"], row_no, col_no),
                    "rackId": rack["id"],
                    "row": row_no,
                    "col": col_no,
                    "code": f"{column_label(col_no)}{row_no}",
                    "status": "empty",
                }
                conn.execute(
                    """
                    INSERT INTO cage_slots (id, rack_id, row_no, col_no, code, status, payload)
                    VALUES (?, ?, ?, ?, ?, ?, ?)
                    """,
                    (slot["id"], slot["rackId"], slot["row"], slot["col"], slot["code"], slot["status"], dump_json(slot)),
                )
                existing_positions.add(position)


def slot_id_for_rack(rack_id, row_no, col_no):
    suffix = str(rack_id).removeprefix("rack-")
    return f"slot-{suffix}-{row_no}-{col_no}"


def column_label(index):
    value = int(index)
    label = ""
    while value > 0:
        value -= 1
        label = chr(65 + (value % 26)) + label
        value //= 26
    return label or "A"


def read_state():
    with connect_db() as conn:
        migrate_legacy_state(conn)
        state = assemble_state(conn)
        updated_at = read_updated_at(conn)
    if not state:
        return {"state": None, "updatedAt": None}
    return {"state": state, "updatedAt": updated_at}


def filter_state_for_actor(state, actor):
    if not state or not actor or actor.get("role") == "admin":
        return state

    allowed_rooms = set(actor.get("roomIds", []))
    rooms = [room for room in state.get("rooms", []) if room.get("id") in allowed_rooms]
    room_ids = {room.get("id") for room in rooms}
    racks = [rack for rack in state.get("racks", []) if rack.get("roomId") in room_ids]
    rack_ids = {rack.get("id") for rack in racks}
    slots = [slot for slot in state.get("slots", []) if slot.get("rackId") in rack_ids]
    slot_ids = {slot.get("id") for slot in slots}
    occupancies = [item for item in state.get("occupancies", []) if item.get("slotId") in slot_ids]

    return {
        **state,
        "rooms": rooms,
        "racks": racks,
        "slots": slots,
        "occupancies": occupancies,
    }


def filter_entity_payloads_for_actor(collection, items, actor):
    if not actor or actor.get("role") == "admin":
        return items

    allowed_rooms = set(actor.get("roomIds", []))
    if collection == "rooms":
        return [item for item in items if item.get("id") in allowed_rooms]
    if collection in ("racks", "slots", "occupancies"):
        with connect_db() as conn:
            state = assemble_state(conn) or empty_state()
        visible = filter_state_for_actor(state, actor)
        visible_ids = {
            "racks": {item.get("id") for item in visible.get("racks", [])},
            "slots": {item.get("id") for item in visible.get("slots", [])},
            "occupancies": {item.get("id") for item in visible.get("occupancies", [])},
        }[collection]
        return [item for item in items if item.get("id") in visible_ids]
    return items


def write_state(state, actor):
    updated_at = datetime.now(timezone.utc).isoformat()
    with connect_db() as conn:
        old_state = assemble_state(conn) or {}
        validate_state_write_permission(conn, actor, old_state, state)
        events = build_audit_events(actor, old_state, state, updated_at)
        state["auditLogs"] = merge_audit_logs(state.get("auditLogs", []), events)
        write_normalized_state(conn, state, updated_at)
        write_audit_events(conn, events)
        conn.commit()
    return {"ok": True, "updatedAt": updated_at, "auditLogs": merge_audit_logs([], events)}


def write_entity_state(endpoint, method, item_id, payload, actor):
    spec = WRITABLE_ENTITY_ENDPOINTS[endpoint]
    collection = spec["collection"]
    current = read_state()
    state = current.get("state") or empty_state()

    item = normalize_entity_payload(collection, payload, item_id, method, spec["id_prefix"])
    status = HTTPStatus.OK
    if method == "POST":
        insert_entity(state, collection, item)
        status = HTTPStatus.CREATED
    elif method == "PUT":
        replace_entity(state, collection, item_id, item)
    elif method == "DELETE":
        item = delete_entity(state, collection, item_id)
    else:
        raise ValueError("Unsupported entity write method")

    if collection == "occupancies":
        sync_slot_statuses(state)

    result = write_state(state, actor)
    return {"item": item, "updatedAt": result["updatedAt"], "auditLogs": result["auditLogs"]}, status


def write_infrastructure_state(payload, actor):
    if not isinstance(payload, dict):
        raise ValueError("Request body must be a JSON object")

    current = read_state()
    state = current.get("state") or empty_state()
    created_rooms = normalize_entity_batch("rooms", payload.get("rooms", []), "POST")
    updated_rooms = normalize_entity_batch("rooms", payload.get("roomUpdates", []), "PUT")
    created_racks = normalize_entity_batch("racks", payload.get("racks", []), "POST")
    updated_racks = normalize_entity_batch("racks", payload.get("rackUpdates", []), "PUT")
    deleted_rack_ids = normalize_id_batch(payload.get("rackDeletes", []), "rackDeletes")
    created_slots = normalize_entity_batch("slots", payload.get("slots", []), "POST")
    deleted_slot_ids = normalize_id_batch(payload.get("slotDeletes", []), "slotDeletes")

    for room in created_rooms:
        insert_entity(state, "rooms", room)
    for room in updated_rooms:
        replace_entity(state, "rooms", room["id"], room)
    for rack in created_racks:
        insert_entity(state, "racks", rack)
    for rack in updated_racks:
        replace_entity(state, "racks", rack["id"], rack)
    for slot in created_slots:
        insert_entity(state, "slots", slot)
    validate_infrastructure_slot_deletes(state, deleted_slot_ids)
    for slot_id in deleted_slot_ids:
        delete_entity(state, "slots", slot_id)
    for rack_id in deleted_rack_ids:
        delete_entity(state, "racks", rack_id)

    result = write_state(state, actor)
    return {
        "rooms": created_rooms,
        "roomUpdates": updated_rooms,
        "racks": created_racks,
        "rackUpdates": updated_racks,
        "rackDeletes": deleted_rack_ids,
        "slots": created_slots,
        "slotDeletes": deleted_slot_ids,
        "updatedAt": result["updatedAt"],
        "auditLogs": result["auditLogs"],
    }


def normalize_entity_batch(collection, items, method):
    if items is None:
        return []
    if not isinstance(items, list):
        raise ValueError("批量保存内容必须是数组")

    spec = {
        "rooms": {"id_prefix": "room"},
        "racks": {"id_prefix": "rack"},
        "slots": {"id_prefix": "slot"},
    }[collection]
    normalized = []
    for item in items:
        item_id = item.get("id") if isinstance(item, dict) else None
        normalized.append(normalize_entity_payload(collection, item, item_id, method, spec["id_prefix"]))
    return normalized


def normalize_id_batch(items, label):
    if items is None:
        return []
    if not isinstance(items, list):
        raise ValueError(f"{label} 必须是数组")
    return [str(item) for item in items if str(item).strip()]


def validate_infrastructure_slot_deletes(state, slot_ids):
    if not slot_ids:
        return
    deleting = set(slot_ids)
    active = [
        item
        for item in state.get("occupancies", [])
        if item.get("slotId") in deleting and item.get("status") in ("active", "reserved")
    ]
    if active:
        raise ValueError("不能移除仍在用或已预约的笼位")


def empty_state():
    return {
        "baseRate": 4.5,
        "billingMonth": "",
        "billingIacuc": "",
        "rooms": [],
        "racks": [],
        "slots": [],
        "occupancies": [],
        "billingRules": [],
        "adjustments": [],
        "auditLogs": [],
    }


def normalize_entity_payload(collection, payload, item_id, method, id_prefix):
    if method == "DELETE":
        return {}
    if not isinstance(payload, dict):
        raise ValueError("Request body must be a JSON object")

    item = dict(payload.get("item") if isinstance(payload.get("item"), dict) else payload)
    if method == "POST":
        item["id"] = str(item.get("id") or new_id(id_prefix))
    else:
        if not item_id:
            raise ValueError("Entity id is required")
        item["id"] = item_id

    validate_entity_payload(collection, item)
    return item


def validate_entity_payload(collection, item):
    if not item.get("id"):
        raise ValueError("实体 id 不能为空")
    if collection == "rooms":
        require_text(item, "name", "饲养间名称不能为空")
    elif collection == "racks":
        require_text(item, "roomId", "笼架必须关联饲养间")
        require_text(item, "name", "笼架名称不能为空")
    elif collection == "slots":
        require_text(item, "rackId", "笼位必须关联笼架")
        status = item.get("status", "empty")
        if status not in ("empty", "reserved", "active"):
            raise ValueError("笼位状态只能是 empty、reserved 或 active")
    elif collection == "occupancies":
        require_text(item, "slotId", "占用记录必须关联笼位")
        status = item.get("status")
        if status not in ("reserved", "active", "ended"):
            raise ValueError("占用状态只能是 reserved、active 或 ended")
    elif collection == "billingRules":
        require_text(item, "unit", "计费规则单位不能为空")
    elif collection == "adjustments":
        require_text(item, "targetType", "减免规则目标类型不能为空")
        require_text(item, "targetId", "减免规则目标不能为空")


def require_text(item, key, message):
    if not str(item.get(key, "")).strip():
        raise ValueError(message)


def insert_entity(state, collection, item):
    items = state.setdefault(collection, [])
    if any(existing.get("id") == item["id"] for existing in items):
        raise sqlite3.IntegrityError(f"Duplicate id: {item['id']}")
    validate_entity_references(state, collection, item)
    items.append(item)


def replace_entity(state, collection, item_id, item):
    items = state.setdefault(collection, [])
    for index, existing in enumerate(items):
        if existing.get("id") == item_id:
            validate_entity_references(state, collection, item)
            items[index] = item
            return
    raise LookupError("实体不存在")


def delete_entity(state, collection, item_id):
    items = state.setdefault(collection, [])
    deleted = None
    kept = []
    for item in items:
        if item.get("id") == item_id:
            deleted = item
        else:
            kept.append(item)
    if deleted is None:
        raise LookupError("实体不存在")
    state[collection] = kept

    if collection == "rooms":
        rack_ids = {rack.get("id") for rack in state.get("racks", []) if rack.get("roomId") == item_id}
        state["racks"] = [rack for rack in state.get("racks", []) if rack.get("roomId") != item_id]
        state["slots"] = [slot for slot in state.get("slots", []) if slot.get("rackId") not in rack_ids]
    elif collection == "racks":
        state["slots"] = [slot for slot in state.get("slots", []) if slot.get("rackId") != item_id]

    return deleted


def validate_entity_references(state, collection, item):
    if collection == "racks" and not entity_exists(state, "rooms", item.get("roomId")):
        raise ValueError("关联的饲养间不存在")
    if collection == "slots" and not entity_exists(state, "racks", item.get("rackId")):
        raise ValueError("关联的笼架不存在")
    if collection == "occupancies" and not entity_exists(state, "slots", item.get("slotId")):
        raise ValueError("关联的笼位不存在")


def entity_exists(state, collection, item_id):
    return any(item.get("id") == item_id for item in state.get(collection, []))


def sync_slot_statuses(state):
    status_by_slot = {
        item.get("slotId"): item.get("status")
        for item in state.get("occupancies", [])
        if item.get("status") in ("active", "reserved")
    }
    state["slots"] = [
        {**slot, "status": status_by_slot.get(slot.get("id"), "empty")}
        for slot in state.get("slots", [])
    ]


def migrate_legacy_state(conn):
    if table_has_rows(conn, "rooms"):
        return
    row = conn.execute("SELECT payload, updated_at FROM app_state WHERE id = ?", ("default",)).fetchone()
    if not row:
        return
    write_normalized_state(conn, json.loads(row["payload"]), row["updated_at"])


def write_normalized_state(conn, state, updated_at):
    for table in TABLES:
        conn.execute(f"DELETE FROM {table}")

    applications_by_iacuc = read_applications_by_iacuc(conn)
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
        conn.execute(
            """
            INSERT INTO occupancies (
                id, slot_id, cage_code, status, iacuc, project, pi, owner, funding,
                room_name, rack_name, slot_code,
                start_date, end_date, end_reason, notes, updated_at, payload
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                occupancy.get("id"),
                occupancy.get("slotId"),
                occupancy.get("cageCode", ""),
                occupancy.get("status", ""),
                occupancy.get("iacuc", ""),
                occupancy.get("project", ""),
                occupancy.get("pi", ""),
                occupancy.get("owner", ""),
                occupancy.get("funding", ""),
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

    for log in state.get("auditLogs", []):
        conn.execute(
            """
            INSERT INTO audit_logs (id, message, at, payload)
            VALUES (?, ?, ?, ?)
            """,
            (log.get("id"), log.get("message", ""), log.get("at", ""), dump_json(log)),
        )


def assemble_state(conn):
    if not any(table_has_rows(conn, table) for table in ("rooms", "racks", "cage_slots", "occupancies")):
        return None

    return {
        "baseRate": read_setting(conn, "baseRate", 4.5),
        "billingMonth": read_setting(conn, "billingMonth", ""),
        "billingIacuc": read_setting(conn, "billingIacuc", ""),
        "rooms": read_payloads(conn, "rooms", "rowid"),
        "racks": read_payloads(conn, "racks", "room_id, index_no, rowid"),
        "slots": read_payloads(conn, "cage_slots", "rack_id, row_no, col_no, rowid"),
        "occupancies": read_payloads(conn, "occupancies", "start_date, rowid"),
        "billingRules": read_payloads(conn, "billing_rules", "rowid"),
        "adjustments": read_payloads(conn, "billing_adjustments", "rowid"),
        "auditLogs": read_payloads(conn, "audit_logs", "at DESC, rowid DESC"),
    }


def read_payloads(conn, table, order_by):
    rows = conn.execute(f"SELECT payload FROM {table} ORDER BY {order_by}").fetchall()
    return [json.loads(row["payload"]) for row in rows]


def read_applications_by_iacuc(conn):
    rows = conn.execute("SELECT payload FROM experiment_applications").fetchall()
    return {
        normalize_iacuc_number(item.get("iacuc", "")): item
        for item in (json.loads(row["payload"]) for row in rows)
        if normalize_iacuc_number(item.get("iacuc", ""))
    }


def occupancy_with_snapshots(occupancy, state, applications_by_iacuc):
    item = dict(occupancy)
    iacuc = normalize_iacuc_number(item.get("iacuc", ""))
    if iacuc:
        item["iacuc"] = iacuc
    application = applications_by_iacuc.get(iacuc, {})
    for key in ("project", "pi", "owner", "funding"):
        if not item.get(key) and application.get(key):
            item[key] = application.get(key, "")

    slot_context = slot_snapshot_context(state, item.get("slotId"))
    for key, value in slot_context.items():
        if value and not item.get(key):
            item[key] = value
    return item


def slot_snapshot_context(state, slot_id):
    slot = next((item for item in state.get("slots", []) if item.get("id") == slot_id), None)
    if not slot:
        return {}
    rack = next((item for item in state.get("racks", []) if item.get("id") == slot.get("rackId")), None)
    room = next((item for item in state.get("rooms", []) if item.get("id") == (rack or {}).get("roomId")), None)
    return {
        "roomName": (room or {}).get("name", ""),
        "rackName": (rack or {}).get("name", ""),
        "slotCode": slot.get("code", ""),
    }


def set_setting(conn, key, value, updated_at):
    conn.execute(
        """
        INSERT INTO app_settings (key, value, updated_at)
        VALUES (?, ?, ?)
        ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
        """,
        (key, json.dumps(value, ensure_ascii=False), updated_at),
    )


def read_setting(conn, key, default):
    row = conn.execute("SELECT value FROM app_settings WHERE key = ?", (key,)).fetchone()
    if not row:
        return default
    return json.loads(row["value"])


def read_updated_at(conn):
    row = conn.execute("SELECT MAX(updated_at) AS updated_at FROM app_settings").fetchone()
    return row["updated_at"] if row else None


def table_has_rows(conn, table):
    row = conn.execute(f"SELECT 1 FROM {table} LIMIT 1").fetchone()
    return row is not None


def dump_json(value):
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"))


def as_int(value):
    return int(value) if value not in (None, "") else None


def as_float(value):
    return float(value) if value not in (None, "") else None


def ensure_default_admin(conn):
    row = conn.execute("SELECT 1 FROM users LIMIT 1").fetchone()
    if row:
        return
    now = now_iso()
    conn.execute(
        """
        INSERT INTO users (id, username, display_name, password_hash, role, room_ids, active, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            new_id("user"),
            DEFAULT_ADMIN_USERNAME,
            "系统管理员",
            hash_password(DEFAULT_ADMIN_PASSWORD),
            "admin",
            "[]",
            1,
            now,
            now,
        ),
    )
    conn.commit()


def hash_password(password):
    salt = secrets.token_bytes(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, 200_000)
    return "pbkdf2_sha256$200000$" + base64.b64encode(salt).decode() + "$" + base64.b64encode(digest).decode()


def verify_password(password, password_hash):
    try:
        algorithm, iterations, salt_text, digest_text = password_hash.split("$", 3)
        if algorithm != "pbkdf2_sha256":
            return False
        salt = base64.b64decode(salt_text)
        expected = base64.b64decode(digest_text)
        actual = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, int(iterations))
        return hmac.compare_digest(actual, expected)
    except Exception:
        return False


def create_session(conn, user_id):
    token = secrets.token_urlsafe(32)
    token_hash = hash_token(token)
    now = datetime.now(timezone.utc)
    expires_at = now + timedelta(days=SESSION_TTL_DAYS)
    conn.execute(
        """
        INSERT INTO sessions (token_hash, user_id, created_at, expires_at)
        VALUES (?, ?, ?, ?)
        """,
        (token_hash, user_id, now.isoformat(), expires_at.isoformat()),
    )
    conn.commit()
    return token, expires_at


def delete_session(conn, token):
    if not token:
        return
    conn.execute("DELETE FROM sessions WHERE token_hash = ?", (hash_token(token),))
    conn.commit()


def hash_token(token):
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def user_from_token(conn, token):
    if not token:
        return None
    row = conn.execute(
        """
        SELECT users.*
        FROM sessions
        JOIN users ON users.id = sessions.user_id
        WHERE sessions.token_hash = ? AND sessions.expires_at > ? AND users.active = 1
        """,
        (hash_token(token), now_iso()),
    ).fetchone()
    return sanitize_user(row) if row else None


def authenticate(conn, username, password):
    row = conn.execute("SELECT * FROM users WHERE username = ? AND active = 1", (username,)).fetchone()
    if not row or not verify_password(password, row["password_hash"]):
        return None
    return sanitize_user(row)


def sanitize_user(row):
    if not row:
        return None
    return {
        "id": row["id"],
        "username": row["username"],
        "displayName": row["display_name"],
        "role": row["role"],
        "roomIds": json.loads(row["room_ids"] or "[]"),
        "active": bool(row["active"]),
    }


def list_users(conn):
    rows = conn.execute("SELECT * FROM users ORDER BY role, username").fetchall()
    return [sanitize_user(row) for row in rows]


def create_user(conn, payload):
    username = str(payload.get("username", "")).strip()
    password = str(payload.get("password", ""))
    display_name = str(payload.get("displayName", "")).strip() or username
    role = payload.get("role", "room_admin")
    room_ids = payload.get("roomIds", [])
    if not username or not password:
        raise ValueError("用户名和密码不能为空")
    if role not in ("admin", "room_admin"):
        raise ValueError("角色只能是 admin 或 room_admin")
    if not isinstance(room_ids, list):
        raise ValueError("roomIds 必须是数组")

    now = now_iso()
    user_id = new_id("user")
    conn.execute(
        """
        INSERT INTO users (id, username, display_name, password_hash, role, room_ids, active, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (user_id, username, display_name, hash_password(password), role, dump_json(room_ids), 1, now, now),
    )
    conn.commit()
    row = conn.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()
    return sanitize_user(row)


def update_user(conn, actor, user_id, payload):
    if user_id == actor["id"]:
        raise PermissionError("不能在账号管理中修改当前登录账号")

    row = conn.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()
    if not row:
        raise LookupError("账号不存在")

    username = str(payload.get("username", row["username"])).strip()
    display_name = str(payload.get("displayName", row["display_name"])).strip() or username
    password = str(payload.get("password", ""))
    role = payload.get("role", row["role"])
    room_ids = payload.get("roomIds", json.loads(row["room_ids"] or "[]"))

    if not username:
        raise ValueError("用户名不能为空")
    if role not in ("admin", "room_admin"):
        raise ValueError("角色只能是 admin 或 room_admin")
    if not isinstance(room_ids, list):
        raise ValueError("roomIds 必须是数组")

    now = now_iso()
    if password:
        conn.execute(
            """
            UPDATE users
            SET username = ?, display_name = ?, password_hash = ?, role = ?, room_ids = ?, updated_at = ?
            WHERE id = ?
            """,
            (username, display_name, hash_password(password), role, dump_json(room_ids), now, user_id),
        )
    else:
        conn.execute(
            """
            UPDATE users
            SET username = ?, display_name = ?, role = ?, room_ids = ?, updated_at = ?
            WHERE id = ?
            """,
            (username, display_name, role, dump_json(room_ids), now, user_id),
        )
    conn.execute("DELETE FROM sessions WHERE user_id = ?", (user_id,))
    conn.commit()
    row = conn.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()
    return sanitize_user(row)


def delete_user(conn, actor, user_id):
    if user_id == actor["id"]:
        raise PermissionError("不能删除当前登录账号")

    row = conn.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()
    if not row:
        raise LookupError("账号不存在")

    conn.execute("DELETE FROM sessions WHERE user_id = ?", (user_id,))
    conn.execute("DELETE FROM users WHERE id = ?", (user_id,))
    conn.commit()


def validate_state_write_permission(conn, actor, old_state, new_state):
    if actor["role"] == "admin":
        return

    allowed_rooms = set(actor.get("roomIds", []))
    if not allowed_rooms:
        raise PermissionError("当前账号没有可编辑的饲养间")

    old_rooms = {item.get("id"): item for item in old_state.get("rooms", [])}
    new_rooms = {item.get("id"): item for item in new_state.get("rooms", [])}
    if set(old_rooms) != set(new_rooms):
        raise PermissionError("房间管理员不能新增或删除饲养间")
    for room_id in changed_keys(old_rooms, new_rooms):
        if room_id not in allowed_rooms:
            raise PermissionError("不能修改未授权饲养间配置")
        old_room = old_rooms.get(room_id, {})
        new_room = new_rooms.get(room_id, {})
        allowed_room_update_keys = {"rackCount"}
        changed_fields = {key for key in set(old_room) | set(new_room) if old_room.get(key) != new_room.get(key)}
        if not changed_fields.issubset(allowed_room_update_keys):
            raise PermissionError("房间管理员不能修改饲养间基础信息")

    old_racks = {item.get("id"): item for item in old_state.get("racks", [])}
    new_racks = {item.get("id"): item for item in new_state.get("racks", [])}
    rack_rooms = rack_room_map(old_state, new_state)
    for rack_id in changed_keys(old_racks, new_racks):
        if rack_rooms.get(rack_id) not in allowed_rooms:
            raise PermissionError("不能修改未授权饲养间的笼架配置")
    if comparable_items(old_state.get("billingRules", [])) != comparable_items(new_state.get("billingRules", [])):
        raise PermissionError("房间管理员不能修改计费规则")
    if old_state.get("baseRate") != new_state.get("baseRate"):
        raise PermissionError("房间管理员不能修改计费规则")
    if comparable_items(old_state.get("adjustments", [])) != comparable_items(new_state.get("adjustments", [])):
        raise PermissionError("房间管理员不能修改减免规则")

    old_slots = {item.get("id"): item for item in old_state.get("slots", [])}
    new_slots = {item.get("id"): item for item in new_state.get("slots", [])}
    slot_rooms = slot_room_map(new_state)
    old_slot_rooms = slot_room_map(old_state)
    for slot_id in changed_keys(old_slots, new_slots):
        room_id = slot_rooms.get(slot_id) or old_slot_rooms.get(slot_id)
        if room_id not in allowed_rooms:
            raise PermissionError("不能修改未授权饲养间的笼位结构")
    for slot_id, new_slot in new_slots.items():
        old_slot = dict(old_slots.get(slot_id, {}))
        if not old_slot:
            continue
        comparable_old = {k: v for k, v in old_slot.items() if k != "status"}
        comparable_new = {k: v for k, v in new_slot.items() if k != "status"}
        if comparable_old != comparable_new and slot_rooms.get(slot_id) not in allowed_rooms:
            raise PermissionError("房间管理员不能修改笼位结构")
        if old_slot.get("status") != new_slot.get("status") and slot_rooms.get(slot_id) not in allowed_rooms:
            raise PermissionError("不能修改未授权饲养间的笼位状态")

    old_occupancies = {item.get("id"): item for item in old_state.get("occupancies", [])}
    new_occupancies = {item.get("id"): item for item in new_state.get("occupancies", [])}
    changed_ids = changed_keys(old_occupancies, new_occupancies)
    for occupancy_id in changed_ids:
        item = new_occupancies.get(occupancy_id) or old_occupancies.get(occupancy_id) or {}
        if slot_rooms.get(item.get("slotId")) not in allowed_rooms:
            raise PermissionError("不能修改未授权饲养间的笼位信息")


def comparable_items(items):
    return {item.get("id"): item for item in items}


def changed_keys(old_items, new_items):
    keys = set(old_items) | set(new_items)
    return {key for key in keys if old_items.get(key) != new_items.get(key)}


def slot_room_map(state):
    rack_rooms = {rack.get("id"): rack.get("roomId") for rack in state.get("racks", [])}
    return {slot.get("id"): rack_rooms.get(slot.get("rackId")) for slot in state.get("slots", [])}


def rack_room_map(*states):
    rooms = {}
    for state in states:
        for rack in state.get("racks", []):
            rooms[rack.get("id")] = rack.get("roomId")
    return rooms


def build_audit_events(actor, old_state, new_state, at):
    events = []
    slot_labels = slot_label_map(new_state)
    old_occupancies = {item.get("id"): item for item in old_state.get("occupancies", [])}
    new_occupancies = {item.get("id"): item for item in new_state.get("occupancies", [])}
    for occupancy_id in sorted(changed_keys(old_occupancies, new_occupancies)):
        old_item = old_occupancies.get(occupancy_id)
        new_item = new_occupancies.get(occupancy_id)
        item = new_item or old_item or {}
        slot_id = item.get("slotId", "")
        label = slot_labels.get(slot_id, slot_id)
        if old_item is None:
            action = "occupancy.created"
            message = f"{actor['displayName']} 新增笼位 {label} 的占用记录"
        elif new_item is None:
            action = "occupancy.deleted"
            message = f"{actor['displayName']} 删除笼位 {label} 的占用记录"
        elif new_item.get("status") == "ended" and new_item.get("endReason") == "sampled" and old_item.get("status") != "ended":
            action = "occupancy.sampled"
            message = f"{actor['displayName']} 将笼位 {label} 标记为已取材，最后计费日期 {new_item.get('endDate', '')}"
        elif new_item.get("status") == "ended" and new_item.get("endReason") == "cleared" and old_item.get("status") != "ended":
            action = "occupancy.cleared"
            message = f"{actor['displayName']} 将笼位 {label} 设为空"
        else:
            action = "occupancy.updated"
            message = f"{actor['displayName']} 更新笼位 {label} 的占用信息"
        events.append(audit_event(actor, action, "occupancy", occupancy_id, message, [slot_id], at, old_item, new_item))

    old_rooms = {item.get("id"): item for item in old_state.get("rooms", [])}
    new_rooms = {item.get("id"): item for item in new_state.get("rooms", [])}
    for room_id in sorted(changed_keys(old_rooms, new_rooms)):
        old_item = old_rooms.get(room_id)
        new_item = new_rooms.get(room_id)
        action = "room.updated"
        if old_item is None:
            action = "room.created"
        elif new_item is None:
            action = "room.deleted"
        name = (new_item or old_item or {}).get("name", room_id)
        message = f"{actor['displayName']} {action_label(action)}饲养间 {name}"
        events.append(audit_event(actor, action, "room", room_id, message, [], at, old_item, new_item))

    return events[:100]


def action_label(action):
    if action.endswith(".created"):
        return "新增"
    if action.endswith(".deleted"):
        return "删除"
    return "更新"


def audit_event(actor, action, entity_type, entity_id, message, slot_ids, at, before, after):
    return {
        "id": new_id("audit"),
        "actorUserId": actor["id"],
        "actorUsername": actor["username"],
        "actorDisplayName": actor["displayName"],
        "action": action,
        "entityType": entity_type,
        "entityId": entity_id,
        "message": message,
        "slotIds": slot_ids,
        "at": at,
        "before": before,
        "after": after,
    }


def write_audit_events(conn, events):
    for event in events:
        conn.execute(
            """
            INSERT INTO audit_events (
                id, actor_user_id, actor_username, actor_display_name, action,
                entity_type, entity_id, message, slot_ids, at, payload
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                event["id"],
                event["actorUserId"],
                event["actorUsername"],
                event["actorDisplayName"],
                event["action"],
                event["entityType"],
                event["entityId"],
                event["message"],
                dump_json(event["slotIds"]),
                event["at"],
                dump_json(event),
            ),
        )


def merge_audit_logs(client_logs, events):
    normalized_events = [
        {
            "id": event["id"],
            "message": event["message"],
            "at": event["at"],
            "actorUsername": event["actorUsername"],
            "actorDisplayName": event["actorDisplayName"],
            "action": event["action"],
            "slotIds": event["slotIds"],
        }
        for event in events
    ]
    seen = set()
    merged = []
    for item in normalized_events + list(client_logs):
        item_id = item.get("id")
        if item_id in seen:
            continue
        seen.add(item_id)
        merged.append(item)
    return merged[:500]


def slot_label_map(state):
    rack_by_id = {rack.get("id"): rack for rack in state.get("racks", [])}
    room_by_id = {room.get("id"): room for room in state.get("rooms", [])}
    labels = {}
    for slot in state.get("slots", []):
        rack = rack_by_id.get(slot.get("rackId"), {})
        room = room_by_id.get(rack.get("roomId"), {})
        rack_index = rack.get("index", "")
        rack_code = str(rack_index).zfill(2) if str(rack_index).isdigit() else str(rack_index)
        labels[slot.get("id")] = f"{room.get('name', '')}-{rack_code}-{slot.get('code', '')}".strip("-")
    return labels


def new_id(prefix):
    return f"{prefix}-{secrets.token_hex(8)}"


def now_iso():
    return datetime.now(timezone.utc).isoformat()


def format_http_date(value):
    return format_datetime(value, usegmt=True)


def read_iacuc_index():
    with connect_db() as conn:
        rows = conn.execute("SELECT payload, imported_at FROM experiment_applications ORDER BY iacuc").fetchall()
        if rows:
            items = [json.loads(row["payload"]) for row in rows]
            updated_at = max(row["imported_at"] for row in rows)
            return {
                "items": items,
                "count": len(items),
                "updatedAt": updated_at,
                "source": "database",
            }

    path = IACUC_INDEX_PATH if IACUC_INDEX_PATH.exists() else LEGACY_IACUC_INDEX_PATH
    if not path.exists():
        return {"items": [], "count": 0, "updatedAt": None, "source": None}

    items = json.loads(path.read_text(encoding="utf-8"))
    stat = path.stat()
    return {
        "items": items,
        "count": len(items),
        "updatedAt": datetime.fromtimestamp(stat.st_mtime, timezone.utc).isoformat(),
        "source": "data" if path == IACUC_INDEX_PATH else "legacy",
    }


def write_experiment_applications(conn, items, imported_at):
    conn.execute("DELETE FROM experiment_applications")
    for item in items:
        normalized = application_payload(item, imported_at)
        conn.execute(
            """
            INSERT INTO experiment_applications (
                iacuc, raw_iacuc, project, pi, owner, funding, imported_at, payload
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                normalized["iacuc"],
                normalized.get("rawIacuc", ""),
                normalized.get("project", ""),
                normalized.get("pi", ""),
                normalized.get("owner", ""),
                normalized.get("funding", ""),
                imported_at,
                dump_json(normalized),
            ),
        )


def list_principal_identities(conn):
    rows = conn.execute("SELECT payload FROM principal_identities").fetchall()
    identity_by_pi = {
        clean_text(item.get("pi", "")): item
        for item in (json.loads(row["payload"]) for row in rows)
        if clean_text(item.get("pi", ""))
    }
    principal_names = {
        clean_text(row["pi"])
        for row in conn.execute("SELECT DISTINCT pi FROM experiment_applications WHERE TRIM(COALESCE(pi, '')) != ''").fetchall()
    }
    principal_names.update(
        clean_text(row["pi"])
        for row in conn.execute("SELECT DISTINCT pi FROM quantity_sheets WHERE TRIM(COALESCE(pi, '')) != ''").fetchall()
    )
    principal_names.update(
        clean_text(row["pi"])
        for row in conn.execute("SELECT DISTINCT pi FROM occupancies WHERE TRIM(COALESCE(pi, '')) != ''").fetchall()
    )
    principal_names.update(identity_by_pi.keys())
    items = []
    for pi_name in sorted((name for name in principal_names if name), key=lambda value: value.lower()):
        saved = identity_by_pi.get(pi_name, {})
        principal_type = normalize_principal_type(saved.get("principalType", BILLING_PRINCIPAL_INDEPENDENT))
        items.append(
            {
                "pi": pi_name,
                "principalType": principal_type,
                "freeCageAllowance": free_cages_for_principal_type(principal_type),
                "updatedAt": saved.get("updatedAt", ""),
            }
        )
    return items


def save_principal_identity(conn, payload, actor, pi_name):
    pi_name = clean_text(pi_name or payload.get("pi", ""))
    if not pi_name:
        raise ValueError("项目负责人不能为空")
    principal_type = normalize_principal_type(payload.get("principalType", ""))
    now = now_iso()
    item = {
        "pi": pi_name,
        "principalType": principal_type,
        "freeCageAllowance": free_cages_for_principal_type(principal_type),
        "updatedAt": now,
    }
    conn.execute(
        """
        INSERT INTO principal_identities (pi, principal_type, updated_at, payload)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(pi) DO UPDATE SET
            principal_type = excluded.principal_type,
            updated_at = excluded.updated_at,
            payload = excluded.payload
        """,
        (pi_name, principal_type, now, dump_json(item)),
    )
    event = audit_event(
        actor,
        "principal_identity.updated",
        "principal_identity",
        pi_name,
        f"{actor['displayName']} 更新项目负责人 {pi_name} 身份为 {principal_type_label(principal_type)}",
        [],
        now,
        None,
        item,
    )
    write_audit_events(conn, [event])
    return item, merge_audit_logs([], [event])


def application_payload(item, imported_at):
    normalized = {
        "iacuc": normalize_iacuc_number(item.get("iacuc", "")),
        "rawIacuc": clean_text(item.get("rawIacuc", "")),
        "project": clean_text(item.get("project", "")),
        "pi": clean_text(item.get("pi", "")),
        "owner": clean_text(item.get("owner", "")),
        "funding": clean_text(item.get("funding", "")),
        "importedAt": imported_at,
    }
    if not normalized["rawIacuc"]:
        normalized["rawIacuc"] = normalized["iacuc"]
    return normalized


def save_iacuc_index_file(items):
    IACUC_INDEX_PATH.parent.mkdir(parents=True, exist_ok=True)
    IACUC_INDEX_PATH.write_text(json.dumps(items, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def system_update_status():
    current = current_revision()
    latest = latest_github_revision()
    latest_sha = latest.get("sha") or ""
    update_available = None
    if current and latest_sha:
        update_available = not revisions_match(current, latest_sha)

    return {
        "repository": CAGELEDGER_REPOSITORY,
        "branch": CAGELEDGER_BRANCH,
        "appVersion": app_version(),
        "current": current or None,
        "currentShort": short_revision(current),
        "latest": latest_sha or None,
        "latestShort": short_revision(latest_sha),
        "latestUrl": latest.get("url"),
        "latestMessage": latest.get("message"),
        "latestDate": latest.get("date"),
        "updateAvailable": update_available,
        "checkedAt": now_iso(),
    }


def system_info():
    return {
        "name": "CageLedger",
        "title": "CageLedger 实验动物笼位管理与计费系统",
        "description": "实验动物笼位管理与计费系统",
        "version": app_version(),
        "organization": CAGELEDGER_ORGANIZATION,
        "department": CAGELEDGER_DEPARTMENT,
        "developer": CAGELEDGER_DEVELOPER,
        "contactEmail": CAGELEDGER_CONTACT_EMAIL,
        "license": CAGELEDGER_LICENSE,
        "copyright": CAGELEDGER_COPYRIGHT,
        "repository": CAGELEDGER_REPOSITORY,
        "branch": CAGELEDGER_BRANCH,
        "revision": current_revision() or None,
        "revisionShort": short_revision(current_revision()),
    }


def app_version():
    if CAGELEDGER_APP_VERSION:
        return CAGELEDGER_APP_VERSION
    package_path = ROOT / "package.json"
    try:
        return json.loads(package_path.read_text(encoding="utf-8")).get("version", "")
    except (OSError, json.JSONDecodeError):
        return ""


def current_revision():
    if CAGELEDGER_VERSION:
        return CAGELEDGER_VERSION
    return read_git_revision(ROOT)


def read_git_revision(root):
    git_dir = root / ".git"
    if git_dir.is_file():
        content = git_dir.read_text(encoding="utf-8", errors="replace").strip()
        if content.startswith("gitdir:"):
            git_dir = (git_dir.parent / content.split(":", 1)[1].strip()).resolve()
    if not git_dir.exists():
        return ""

    head_path = git_dir / "HEAD"
    if not head_path.exists():
        return ""
    head = head_path.read_text(encoding="utf-8", errors="replace").strip()
    if head.startswith("ref:"):
        ref = head.split(":", 1)[1].strip()
        ref_path = git_dir / ref
        if ref_path.exists():
            return ref_path.read_text(encoding="utf-8", errors="replace").strip()
        packed_refs = git_dir / "packed-refs"
        if packed_refs.exists():
            for line in packed_refs.read_text(encoding="utf-8", errors="replace").splitlines():
                if not line or line.startswith("#") or line.startswith("^"):
                    continue
                sha, _, packed_ref = line.partition(" ")
                if packed_ref == ref:
                    return sha.strip()
        return ""
    return head


def latest_github_revision():
    url = f"https://api.github.com/repos/{CAGELEDGER_REPOSITORY}/commits/{CAGELEDGER_BRANCH}"
    request = Request(url, headers={"Accept": "application/vnd.github+json", "User-Agent": "CageLedger"})
    try:
        with urlopen(request, timeout=8) as response:
            payload = json.loads(response.read().decode("utf-8"))
    except HTTPError as exc:
        raise ValueError(f"GitHub 返回错误：HTTP {exc.code}") from exc
    except URLError as exc:
        raise ValueError(f"无法连接 GitHub：{exc.reason}") from exc
    except TimeoutError as exc:
        raise ValueError("连接 GitHub 超时") from exc

    commit = payload.get("commit") or {}
    author = commit.get("author") or {}
    return {
        "sha": payload.get("sha", ""),
        "url": payload.get("html_url", ""),
        "message": first_line(commit.get("message", "")),
        "date": author.get("date", ""),
    }


def revisions_match(current, latest):
    current = str(current or "").strip()
    latest = str(latest or "").strip()
    return bool(current and latest and (current.startswith(latest) or latest.startswith(current)))


def short_revision(value):
    value = str(value or "").strip()
    return value[:7] if value else None


def first_line(value):
    return str(value or "").splitlines()[0] if value else ""


def parse_iacuc_csv(raw):
    text = decode_csv_bytes(raw)
    reader = csv.DictReader(io.StringIO(text))
    if not reader.fieldnames:
        raise ValueError("CSV 文件缺少表头")

    field_by_name = {clean_text(name): name for name in reader.fieldnames if clean_text(name)}
    required = {
        "iacuc": "动物伦理编号",
        "project": "动物实验名称",
        "pi": "项目负责人",
        "owner": "实验负责人",
    }
    missing = [label for label in required.values() if label not in field_by_name]
    if missing:
        raise ValueError(f"CSV 缺少必要列：{', '.join(missing)}")
    funding_field = next(
        (
            field_by_name[label]
            for label in ("项目来源", "支撑经费", "经费来源", "课题来源", "经费项目")
            if label in field_by_name
        ),
        None,
    )

    records_by_iacuc = {}
    duplicate_count = 0
    row_count = 0
    empty_iacuc_count = 0
    for row in reader:
        row_count += 1
        raw_iacuc = clean_text(row.get(field_by_name[required["iacuc"]], ""))
        iacuc = normalize_iacuc_number(raw_iacuc)
        if not iacuc:
            empty_iacuc_count += 1
            continue
        if not is_valid_iacuc_number(iacuc):
            empty_iacuc_count += 1
            continue
        if iacuc in records_by_iacuc:
            duplicate_count += 1
        records_by_iacuc[iacuc] = {
            "iacuc": iacuc,
            "rawIacuc": raw_iacuc,
            "project": clean_text(row.get(field_by_name[required["project"]], "")),
            "pi": clean_text(row.get(field_by_name[required["pi"]], "")),
            "owner": clean_text(row.get(field_by_name[required["owner"]], "")),
            "funding": clean_text(row.get(funding_field, "")) if funding_field else "",
        }

    items = sorted(records_by_iacuc.values(), key=lambda item: item["iacuc"])
    return {
        "items": items,
        "summary": {
            "rowCount": row_count,
            "count": len(items),
            "emptyIacucCount": empty_iacuc_count,
            "duplicateCount": duplicate_count,
        },
    }


def decode_csv_bytes(raw):
    for encoding in ("utf-8-sig", "utf-8", "gb18030"):
        try:
            return raw.decode(encoding)
        except UnicodeDecodeError:
            continue
    raise ValueError("CSV 编码无法识别，请使用 UTF-8 或 GB18030")


def clean_text(value):
    if value is None:
        return ""
    return re.sub(r"\s+", " ", str(value).strip())


def normalize_iacuc_number(value):
    text = clean_text(value)
    text = re.sub(r"（.*?）", "", text)
    text = re.sub(r"\(.*?\)", "", text)
    return text.strip()


def is_valid_iacuc_number(value):
    return bool(re.search(r"\d", value))


def list_quantity_sheets(conn):
    rows = conn.execute("SELECT payload FROM quantity_sheets ORDER BY month DESC, iacuc, updated_at DESC").fetchall()
    return [json.loads(row["payload"]) for row in rows]


def get_quantity_sheet(conn, sheet_id):
    row = conn.execute("SELECT payload FROM quantity_sheets WHERE id = ?", (sheet_id,)).fetchone()
    if not row:
        raise LookupError("数量统计表不存在")
    return json.loads(row["payload"])


def save_quantity_sheet(conn, payload, actor, sheet_id=None):
    now = now_iso()
    sheet = normalize_quantity_sheet(payload, sheet_id, now)
    validate_quantity_sheet_permission(actor, sheet)
    exists = conn.execute("SELECT 1 FROM quantity_sheets WHERE id = ?", (sheet["id"],)).fetchone()
    if exists:
        conn.execute(
            """
            UPDATE quantity_sheets
            SET month = ?, iacuc = ?, room_id = ?, room_name = ?, manager = ?,
                project = ?, pi = ?, owner = ?, funding = ?, updated_at = ?, payload = ?
            WHERE id = ?
            """,
            quantity_sheet_db_values(sheet) + (sheet["id"],),
        )
        action = "quantity_sheet.updated"
        message = f"{actor['displayName']} 更新 {sheet['iacuc']} {sheet['month']} 数量统计表"
        status = HTTPStatus.OK
    else:
        conn.execute(
            """
            INSERT INTO quantity_sheets (
                month, iacuc, room_id, room_name, manager, project, pi, owner,
                funding, updated_at, payload, id
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            quantity_sheet_db_values(sheet) + (sheet["id"],),
        )
        action = "quantity_sheet.created"
        message = f"{actor['displayName']} 创建 {sheet['iacuc']} {sheet['month']} 数量统计表"
        status = HTTPStatus.CREATED

    transfer_events = sync_quantity_sheet_transfer_rows(conn, sheet, actor, now)
    event = audit_event(actor, action, "quantity_sheet", sheet["id"], message, [], now, None, sheet)
    events = [event, *transfer_events]
    write_audit_events(conn, events)
    return sheet, merge_audit_logs([], events), status


def delete_quantity_sheet(conn, actor, sheet_id):
    sheet = get_quantity_sheet(conn, sheet_id)
    validate_quantity_sheet_permission(actor, sheet)
    now = now_iso()
    conn.execute("DELETE FROM quantity_sheets WHERE id = ?", (sheet_id,))
    event = audit_event(
        actor,
        "quantity_sheet.deleted",
        "quantity_sheet",
        sheet_id,
        f"{actor['displayName']} 删除 {sheet.get('iacuc', '')} {sheet.get('month', '')} 数量统计表",
        [],
        now,
        sheet,
        None,
    )
    write_audit_events(conn, [event])
    return merge_audit_logs([], [event])


def quantity_sheet_db_values(sheet):
    return (
        sheet["month"],
        sheet["iacuc"],
        sheet.get("roomId", ""),
        sheet.get("roomName", ""),
        sheet.get("manager", ""),
        sheet.get("project", ""),
        sheet.get("pi", ""),
        sheet.get("owner", ""),
        sheet.get("funding", ""),
        sheet["updatedAt"],
        dump_json(sheet),
    )


def sync_quantity_sheet_transfer_rows(conn, source_sheet, actor, now):
    month = source_sheet.get("month", "")
    source_sheet_id = source_sheet.get("id", "")
    source_iacuc = normalize_iacuc_number(source_sheet.get("iacuc", ""))
    if not month or not source_sheet_id or not source_iacuc:
        return []

    applications_by_iacuc = read_applications_by_iacuc(conn)
    rows = source_sheet.get("rows", [])
    transfer_rows = []
    for row in rows:
        if clean_text(row.get("transferSourceSheetId", "")):
            continue
        row_id = clean_text(row.get("id", "")) or new_id("qrow")
        row_date = clean_text(row.get("date", "")) or f"{month}-01"
        row_notes = clean_text(row.get("notes", ""))
        added_count = as_int(row.get("addedCount")) or 0
        removed_count = as_int(row.get("removedCount")) or 0
        target_iacuc = normalize_iacuc_number(row.get("transferOutToIacuc", ""))
        if target_iacuc and removed_count > 0 and target_iacuc != source_iacuc:
            transfer_rows.append(
                {
                    "direction": "out_to_in",
                    "sourceRowId": row_id,
                    "date": row_date,
                    "notes": row_notes,
                    "targetIacuc": target_iacuc,
                    "count": removed_count,
                    "fromIacuc": source_iacuc,
                    "toIacuc": target_iacuc,
                }
            )
        from_iacuc = normalize_iacuc_number(row.get("transferInFromIacuc", ""))
        if from_iacuc and added_count > 0 and from_iacuc != source_iacuc:
            transfer_rows.append(
                {
                    "direction": "in_to_out",
                    "sourceRowId": row_id,
                    "date": row_date,
                    "notes": row_notes,
                    "targetIacuc": from_iacuc,
                    "count": added_count,
                    "fromIacuc": from_iacuc,
                    "toIacuc": source_iacuc,
                }
            )

    sheet_rows = conn.execute("SELECT id, payload FROM quantity_sheets WHERE month = ?", (month,)).fetchall()
    sheets = [json.loads(row["payload"]) for row in sheet_rows]
    events = []

    for target_sheet in sheets:
        if target_sheet.get("id") == source_sheet_id:
            continue
        original_rows = target_sheet.get("rows", [])
        next_rows = []
        changed = False
        for row in original_rows:
            if clean_text(row.get("transferSourceSheetId", "")) == source_sheet_id:
                changed = True
                continue
            contrib = row.get("transferMirrorContrib")
            if isinstance(contrib, dict):
                next_contrib = {}
                row_changed = False
                for key, value in contrib.items():
                    if not str(key).startswith(f"{source_sheet_id}:"):
                        next_contrib[key] = as_int(value) or 0
                        continue
                    amount = as_int(value) or 0
                    if amount <= 0:
                        continue
                    direction = "out_to_in" if key.endswith(":out_to_in") else "in_to_out"
                    if direction == "out_to_in":
                        row["addedCount"] = max((as_int(row.get("addedCount")) or 0) - amount, 0)
                    else:
                        row["removedCount"] = max((as_int(row.get("removedCount")) or 0) - amount, 0)
                    row_changed = True
                    changed = True
                if row_changed:
                    if next_contrib:
                        row["transferMirrorContrib"] = next_contrib
                    else:
                        row.pop("transferMirrorContrib", None)
            next_rows.append(row)
        if changed:
            target_sheet["rows"] = sorted(next_rows, key=lambda item: (item.get("date", ""), item.get("id", "")))
            target_sheet["updatedAt"] = now
            conn.execute(
                """
                UPDATE quantity_sheets
                SET month = ?, iacuc = ?, room_id = ?, room_name = ?, manager = ?,
                    project = ?, pi = ?, owner = ?, funding = ?, updated_at = ?, payload = ?
                WHERE id = ?
                """,
                quantity_sheet_db_values(target_sheet) + (target_sheet["id"],),
            )

    target_sheet_by_iacuc = {}
    for target_sheet in sheets:
        key = normalize_iacuc_number(target_sheet.get("iacuc", ""))
        if key and key != source_iacuc and key not in target_sheet_by_iacuc:
            target_sheet_by_iacuc[key] = target_sheet

    for transfer in transfer_rows:
        target_iacuc = transfer["targetIacuc"]
        target_sheet = target_sheet_by_iacuc.get(target_iacuc)
        if not target_sheet:
            app = applications_by_iacuc.get(target_iacuc, {})
            target_sheet = {
                "id": new_id("qsheet"),
                "month": month,
                "roomId": "",
                "roomName": "",
                "manager": actor.get("displayName", ""),
                "iacuc": target_iacuc,
                "project": clean_text(app.get("project", "")),
                "pi": clean_text(app.get("pi", "")),
                "owner": clean_text(app.get("owner", "")),
                "contact": "",
                "funding": clean_text(app.get("funding", "")),
                "billingUnit": "cage_day",
                "initialAnimalCount": 0,
                "initialCageCount": 0,
                "rows": [],
                "updatedAt": now,
            }
            conn.execute(
                """
                INSERT INTO quantity_sheets (
                    month, iacuc, room_id, room_name, manager, project, pi, owner,
                    funding, updated_at, payload, id
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                quantity_sheet_db_values(target_sheet) + (target_sheet["id"],),
            )
            target_sheet_by_iacuc[target_iacuc] = target_sheet
            sheets.append(target_sheet)
            events.append(
                audit_event(
                    actor,
                    "quantity_sheet.transfer_placeholder_created",
                    "quantity_sheet",
                    target_sheet["id"],
                    f"{actor['displayName']} 自动创建 {target_iacuc} {month} 数量统计表（转移入账）",
                    [],
                    now,
                    None,
                    target_sheet,
                )
            )

        row_id = f"xfer-{source_sheet_id}-{transfer['sourceRowId']}-{target_iacuc}-{transfer['direction']}"
        contrib_key = f"{source_sheet_id}:{transfer['sourceRowId']}:{target_iacuc}:{transfer['direction']}"
        if transfer["direction"] == "out_to_in":
            mirrored_row = {
                "id": row_id,
                "date": transfer["date"],
                "addedCount": transfer["count"],
                "addedType": "转入",
                "transferInFromIacuc": transfer["fromIacuc"],
                "removedCount": None,
                "removedType": "",
                "transferOutToIacuc": "",
                "animalCount": None,
                "cageCount": None,
                "notes": transfer["notes"],
                "transferSourceSheetId": source_sheet_id,
                "transferSourceIacuc": source_iacuc,
            }
        else:
            mirrored_row = {
                "id": row_id,
                "date": transfer["date"],
                "addedCount": None,
                "addedType": "",
                "transferInFromIacuc": "",
                "removedCount": transfer["count"],
                "removedType": "转出",
                "transferOutToIacuc": transfer["toIacuc"],
                "animalCount": None,
                "cageCount": None,
                "notes": transfer["notes"],
                "transferSourceSheetId": source_sheet_id,
                "transferSourceIacuc": source_iacuc,
            }
        target_rows = [row for row in target_sheet.get("rows", []) if row.get("id") != row_id]
        merged = False
        for row in target_rows:
            if clean_text(row.get("transferSourceSheetId", "")):
                continue
            if clean_text(row.get("date", "")) != transfer["date"]:
                continue
            if transfer["direction"] == "out_to_in":
                if clean_text(row.get("addedType", "")) not in ("", "转入"):
                    continue
                if row.get("cageCount") is not None:
                    continue
                existing = row.get("transferMirrorContrib")
                contrib = existing if isinstance(existing, dict) else {}
                row["addedType"] = "转入"
                row["transferInFromIacuc"] = transfer["fromIacuc"]
                row["addedCount"] = (as_int(row.get("addedCount")) or 0) + transfer["count"]
                contrib[contrib_key] = transfer["count"]
                row["transferMirrorContrib"] = contrib
                merged = True
                break
            if clean_text(row.get("removedType", "")) not in ("", "转出"):
                continue
            if row.get("cageCount") is not None:
                continue
            existing = row.get("transferMirrorContrib")
            contrib = existing if isinstance(existing, dict) else {}
            row["removedType"] = "转出"
            row["transferOutToIacuc"] = transfer["toIacuc"]
            row["removedCount"] = (as_int(row.get("removedCount")) or 0) + transfer["count"]
            contrib[contrib_key] = transfer["count"]
            row["transferMirrorContrib"] = contrib
            merged = True
            break
        if not merged:
            target_rows.append(mirrored_row)
        target_sheet["rows"] = sorted(target_rows, key=lambda item: (item.get("date", ""), item.get("id", "")))
        target_sheet["updatedAt"] = now
        conn.execute(
            """
            UPDATE quantity_sheets
            SET month = ?, iacuc = ?, room_id = ?, room_name = ?, manager = ?,
                project = ?, pi = ?, owner = ?, funding = ?, updated_at = ?, payload = ?
            WHERE id = ?
            """,
            quantity_sheet_db_values(target_sheet) + (target_sheet["id"],),
        )
        events.append(
            audit_event(
                actor,
                "quantity_sheet.transfer_synced",
                "quantity_sheet",
                target_sheet["id"],
                f"{actor['displayName']} 将 {source_iacuc} 转移记录同步到 {target_iacuc} 数量统计表",
                [],
                now,
                None,
                {"targetSheetId": target_sheet["id"], "targetIacuc": target_iacuc, "rowId": row_id},
            )
        )
    return events


def normalize_quantity_sheet(payload, sheet_id, updated_at):
    source = payload.get("sheet") if isinstance(payload, dict) and isinstance(payload.get("sheet"), dict) else payload
    if not isinstance(source, dict):
        raise ValueError("数量统计表必须是 JSON 对象")

    month = clean_text(source.get("month", ""))
    iacuc = normalize_iacuc_number(source.get("iacuc", ""))
    if not re.fullmatch(r"\d{4}-\d{2}", month):
        raise ValueError("结算月份格式应为 YYYY-MM")
    if not iacuc:
        raise ValueError("IACUC 编号不能为空")

    rows = source.get("rows", [])
    if not isinstance(rows, list):
        raise ValueError("统计表明细必须是数组")

    sheet = {
        "id": clean_text(sheet_id or source.get("id") or new_id("qsheet")),
        "month": month,
        "roomId": clean_text(source.get("roomId", "")),
        "roomName": clean_text(source.get("roomName", "")),
        "manager": clean_text(source.get("manager", "")),
        "iacuc": iacuc,
        "project": clean_text(source.get("project", "")),
        "pi": clean_text(source.get("pi", "")),
        "owner": clean_text(source.get("owner", "")),
        "contact": clean_text(source.get("contact", "")),
        "funding": clean_text(source.get("funding", "")),
        "billingUnit": "animal_day" if clean_text(source.get("billingUnit", "")) == "animal_day" else "cage_day",
        "initialAnimalCount": as_int(source.get("initialAnimalCount")),
        "initialCageCount": as_int(source.get("initialCageCount")),
        "rows": [normalize_quantity_sheet_row(row, month) for row in rows],
        "updatedAt": updated_at,
    }
    sheet["rows"] = sorted(sheet["rows"], key=lambda item: (item["date"], item["id"]))
    return sheet


def normalize_quantity_sheet_row(row, month):
    if not isinstance(row, dict):
        raise ValueError("统计表明细行必须是 JSON 对象")
    date = normalize_sheet_date(row.get("date", ""), month)
    return {
        "id": clean_text(row.get("id", "")) or new_id("qrow"),
        "date": date,
        "addedCount": as_int(row.get("addedCount")),
        "addedType": clean_text(row.get("addedType", "")),
        "removedCount": as_int(row.get("removedCount")),
        "removedType": clean_text(row.get("removedType", "")),
        "transferInFromIacuc": normalize_iacuc_number(row.get("transferInFromIacuc", "")),
        "transferOutToIacuc": normalize_iacuc_number(row.get("transferOutToIacuc", "")),
        "animalCount": as_int(row.get("animalCount")),
        "cageCount": as_int(row.get("cageCount")),
        "notes": clean_text(row.get("notes", "")),
        "transferSourceSheetId": clean_text(row.get("transferSourceSheetId", "")),
        "transferSourceIacuc": normalize_iacuc_number(row.get("transferSourceIacuc", "")),
        "transferMirrorContrib": {
            clean_text(key): max(as_int(value) or 0, 0)
            for key, value in (row.get("transferMirrorContrib") or {}).items()
            if clean_text(key)
        }
        if isinstance(row.get("transferMirrorContrib"), dict)
        else {},
    }


def normalize_sheet_date(value, month):
    text = clean_text(value)
    if re.fullmatch(r"\d{4}-\d{2}-\d{2}", text):
        date = text
    elif re.fullmatch(r"\d{1,2}[./-]\d{1,2}", text):
        year = month.split("-", 1)[0]
        month_no, day = [int(part) for part in re.split(r"[./-]", text)]
        date = f"{int(year):04d}-{month_no:02d}-{day:02d}"
    elif re.fullmatch(r"\d{1,2}", text):
        date = f"{month}-{int(text):02d}"
    else:
        raise ValueError("统计表日期格式应为 YYYY-MM-DD、M.D 或当月日期")
    if not date.startswith(month + "-"):
        raise ValueError("统计表明细日期必须属于结算月份")
    try:
        datetime.strptime(date, "%Y-%m-%d")
    except ValueError as exc:
        raise ValueError("统计表明细日期无效") from exc
    return date


def validate_quantity_sheet_permission(actor, sheet):
    if actor["role"] == "admin":
        return
    room_id = sheet.get("roomId", "")
    allowed_rooms = set(actor.get("roomIds", []))
    if room_id and room_id not in allowed_rooms:
        raise PermissionError("不能维护未授权饲养间的数量统计表")


def generate_quantity_sheet_statement(conn, sheet_id, payload, actor):
    sheet = get_quantity_sheet(conn, sheet_id)
    validate_quantity_sheet_permission(actor, sheet)
    status = clean_text(payload.get("status", "draft")) or "draft"
    persist = bool(payload.get("persist"))
    if status not in ("draft", "locked"):
        raise ValueError("结算单状态只能是 draft 或 locked")

    sheet_iacuc = normalize_iacuc_number(sheet.get("iacuc", ""))
    if not sheet_iacuc:
        raise ValueError("数量统计表缺少伦理号，无法生成按伦理号拆分的结算单")
    sheets = [
        item
        for item in list_quantity_sheets(conn)
        if item.get("month") == sheet["month"] and normalize_iacuc_number(item.get("iacuc", "")) == sheet_iacuc
    ]
    for item in sheets:
        validate_quantity_sheet_permission(actor, item)
    pi_name = clean_text(sheet.get("pi", ""))
    principal_type_by_pi = read_principal_type_by_pi(conn)
    principal_type = principal_type_by_pi.get(pi_name, BILLING_PRINCIPAL_INDEPENDENT)
    # IACUC 分表阶段不应用 PI 免费笼位，避免跨伦理号结算失真。
    free_cages = 0
    rooms = read_payloads(conn, "rooms", "rowid")
    lines = quantity_sheet_statement_lines(sheets, free_cages, rooms)
    generated_at = now_iso()
    iacucs = sorted({normalize_iacuc_number(item.get("iacuc", "")) for item in sheets if item.get("iacuc")})
    statement_iacuc = iacucs[0] if iacucs else sheet_iacuc
    statement = {
        "id": new_id("stmt"),
        "iacuc": statement_iacuc,
        "iacucs": iacucs,
        "month": sheet["month"],
        "project": "、".join(sorted({item.get("project", "") for item in sheets if item.get("project")})),
        "pi": pi_name,
        "owner": sheet.get("owner", ""),
        "funding": "、".join(sorted({item.get("funding", "") for item in sheets if item.get("funding")})),
        "sourceType": "quantity_sheet",
        "sourceId": sheet["id"],
        "sourceIds": [item["id"] for item in sheets],
        "sourceLabel": "数量统计表",
        "roomName": "、".join(sorted({item.get("roomName", "") for item in sheets if item.get("roomName")})),
        "manager": "、".join(sorted({item.get("manager", "") for item in sheets if item.get("manager")})),
        "billingUnit": "cage_day",
        "principalType": principal_type,
        "freeCageAllowance": free_cages,
        "tierLimit": BILLING_TIER_LIMIT,
        "baseUnitPrice": BILLING_TIER_BASE_PRICE,
        "overageUnitPrice": BILLING_TIER_OVER_PRICE,
        "totalCageDays": sum(line["cageCount"] for line in lines),
        "totalFreeCageDays": sum(line.get("freeCages", 0) for line in lines),
        "totalBillableCageDays": sum(line.get("billableCages", 0) for line in lines),
        "totalTier1CageDays": sum(line.get("tier1BillableCages", 0) for line in lines),
        "totalTier2CageDays": sum(line.get("tier2BillableCages", 0) for line in lines),
        "totalAnimalDays": sum(line.get("animalCount", 0) for line in lines),
        "totalAmount": lines[-1]["cumulative"] if lines else 0,
        "status": status,
        "generatedAt": generated_at,
        "lockedAt": generated_at if status == "locked" else "",
    }
    for line in lines:
        line["statementId"] = statement["id"]

    if not persist:
        return statement, lines, []

    workflow, version, statement, lines, workflow_events = save_billing_statement_workflow(
        conn,
        statement,
        lines,
        actor,
        f"根据数量统计表生成 {statement_iacuc} {sheet['month']} 饲养费结算单",
    )
    event = audit_event(
        actor,
        "billing_statement.generated_from_quantity_sheet",
        "billing_workflow",
        workflow["id"],
        f"{actor['displayName']} 根据数量统计表生成 {statement_iacuc} {sheet['month']} 饲养费结算单",
        [],
        generated_at,
        sheet,
        {"workflow": workflow, "version": version},
    )
    write_audit_events(conn, [event])
    return statement, lines, merge_audit_logs([], [event])


def quantity_sheet_statement_lines(sheets, free_cages, rooms=None):
    if not sheets:
        return []

    room_by_id = {room.get("id"): room for room in rooms or []}
    sheet_states = []
    sheet_state_by_iacuc = {}
    month = sheets[0]["month"]
    for sheet in sheets:
        rows_by_date = {}
        for row in sheet.get("rows", []):
            rows_by_date.setdefault(row["date"], []).append(row)
        profile = billing_profile_for_room(room_by_id.get(sheet.get("roomId"), {}), sheet.get("billingUnit"))
        state = {
            "sheet": sheet,
            "rowsByDate": rows_by_date,
            "profile": profile,
            "animalCount": sheet.get("initialAnimalCount") or 0,
            "cageCount": sheet.get("initialCageCount") or 0,
        }
        sheet_states.append(state)
        iacuc = normalize_iacuc_number(sheet.get("iacuc", ""))
        if iacuc and iacuc not in sheet_state_by_iacuc:
            sheet_state_by_iacuc[iacuc] = state

    cumulative = 0
    lines = []
    for date in dates_in_month(month):
        transfer_deltas = {}
        breakdown = []
        animal_count = 0
        cage_count = 0
        charge_groups = {}
        quantity_row_ids = []
        for state in sheet_states:
            day_rows = state["rowsByDate"].get(date, [])
            for row in day_rows:
                added_count = row.get("addedCount") or 0
                removed_count = row.get("removedCount") or 0
                profile = state["profile"]
                if profile["unit"] == "animal_day":
                    if row.get("animalCount") is not None:
                        state["animalCount"] = row.get("animalCount") or 0
                    else:
                        state["animalCount"] = max(state["animalCount"] + added_count - removed_count, 0)
                    if row.get("cageCount") is not None:
                        state["cageCount"] = row.get("cageCount") or 0
                else:
                    if row.get("cageCount") is not None:
                        state["cageCount"] = row.get("cageCount") or 0
                    else:
                        state["cageCount"] = max(state["cageCount"] + added_count - removed_count, 0)
                    if row.get("animalCount") is not None:
                        state["animalCount"] = row.get("animalCount") or 0
                transfer_out_iacuc = normalize_iacuc_number(row.get("transferOutToIacuc", ""))
                if transfer_out_iacuc and removed_count > 0:
                    transfer_deltas[transfer_out_iacuc] = transfer_deltas.get(transfer_out_iacuc, 0) + removed_count
                transfer_in_from_iacuc = normalize_iacuc_number(row.get("transferInFromIacuc", ""))
                if transfer_in_from_iacuc and added_count > 0:
                    transfer_deltas[transfer_in_from_iacuc] = transfer_deltas.get(transfer_in_from_iacuc, 0) - added_count
            sheet = state["sheet"]
            quantity_row_ids.extend(row["id"] for row in day_rows)

        for iacuc, delta in transfer_deltas.items():
            target = sheet_state_by_iacuc.get(iacuc)
            if not target:
                continue
            if target["profile"]["unit"] == "animal_day":
                target["animalCount"] = max((target.get("animalCount") or 0) + delta, 0)
            else:
                target["cageCount"] = max((target.get("cageCount") or 0) + delta, 0)

        for state in sheet_states:
            sheet = state["sheet"]
            profile = state["profile"]
            animal_count += state["animalCount"]
            cage_count += state["cageCount"]
            charge_count = state["animalCount"] if profile["unit"] == "animal_day" else state["cageCount"]
            add_charge_group(charge_groups, profile, charge_count)
            if state["cageCount"] or state["animalCount"]:
                breakdown.append(
                    {
                        "iacuc": sheet.get("iacuc", ""),
                        "project": sheet.get("project", ""),
                        "animalCount": state["animalCount"],
                        "cageCount": state["cageCount"],
                        "billingItem": profile["billingItem"],
                        "billingUnit": profile["unit"],
                    }
                )

        charges = combined_daily_charge(charge_groups, free_cages)
        cumulative += charges["amount"]
        lines.append(
            {
                "id": new_id("line"),
                "date": date,
                "animalCount": animal_count,
                "cageCount": cage_count,
                **charges,
                "cumulative": cumulative,
                "iacucBreakdown": breakdown,
                "quantitySheetRowIds": quantity_row_ids,
                "occupancyIds": [],
            }
        )
    return lines


def generate_billing_statement(conn, payload, actor):
    iacuc = normalize_iacuc_number(payload.get("iacuc", ""))
    requested_pi = clean_text(payload.get("pi", ""))
    month = clean_text(payload.get("month", ""))
    status = clean_text(payload.get("status", "draft")) or "draft"
    persist = bool(payload.get("persist"))
    if not re.fullmatch(r"\d{4}-\d{2}", month):
        raise ValueError("结算月份格式应为 YYYY-MM")
    if status not in ("draft", "locked"):
        raise ValueError("结算单状态只能是 draft 或 locked")
    if not iacuc:
        raise ValueError("请先选择伦理号后再生成结算单")

    applications_by_iacuc = read_applications_by_iacuc(conn)
    state = {
        "rooms": read_payloads(conn, "rooms", "rowid"),
        "racks": read_payloads(conn, "racks", "room_id, index_no, rowid"),
        "slots": read_payloads(conn, "cage_slots", "rack_id, row_no, col_no, rowid"),
    }
    occupancies = [
        occupancy_with_snapshots(item, state, applications_by_iacuc)
        for item in read_payloads(conn, "occupancies", "start_date, rowid")
    ]
    dates = dates_in_month(month)
    generated_at = now_iso()
    cumulative = 0
    lines = []
    pi_name = requested_pi or pi_for_iacuc(iacuc, applications_by_iacuc, occupancies)
    if not pi_name:
        raise ValueError("项目负责人不能为空")
    principal_type_by_pi = read_principal_type_by_pi(conn)
    principal_type = principal_type_by_pi.get(pi_name, BILLING_PRINCIPAL_INDEPENDENT)
    # IACUC 分表阶段不应用 PI 免费笼位，避免跨伦理号结算失真。
    free_cages = 0
    iacucs = [iacuc]

    for date in dates:
        active_items = [
            item
            for item in occupancies
            if normalize_iacuc_number(item.get("iacuc", "")) == iacuc and occupancy_active_on_date(item, date)
        ]
        charge_groups = {}
        cage_count = 0
        animal_count = 0
        for item in active_items:
            profile = billing_profile_for_occupancy(item, state)
            if profile["unit"] == "animal_day":
                count = occupancy_animal_count(item, profile)
                animal_count += count
            else:
                count = 1
                cage_count += 1
            add_charge_group(charge_groups, profile, count)
        charges = combined_daily_charge(charge_groups, free_cages)
        amount = charges["amount"]
        cumulative += amount
        breakdown = []
        if active_items:
            for item in active_items:
                profile = billing_profile_for_occupancy(item, state)
                found = next(
                    (
                        entry
                        for entry in breakdown
                        if entry["iacuc"] == iacuc and entry.get("billingItem") == profile["billingItem"]
                    ),
                    None,
                )
                if not found:
                    found = {
                        "iacuc": iacuc,
                        "project": statement_application_snapshot(iacuc, applications_by_iacuc, occupancies).get("project", ""),
                        "animalCount": 0,
                        "cageCount": 0,
                        "billingItem": profile["billingItem"],
                        "billingUnit": profile["unit"],
                    }
                    breakdown.append(found)
                if profile["unit"] == "animal_day":
                    found["animalCount"] += occupancy_animal_count(item, profile)
                else:
                    found["cageCount"] += 1
        line = {
            "id": new_id("line"),
            "date": date,
            "animalCount": animal_count,
            "cageCount": cage_count,
            **charges,
            "amount": amount,
            "cumulative": cumulative,
            "iacucBreakdown": breakdown,
            "occupancyIds": [item.get("id") for item in active_items if item.get("id")],
        }
        lines.append(line)

    application = statement_application_snapshot(iacuc, applications_by_iacuc, occupancies)
    statement = {
        "id": new_id("stmt"),
        "iacuc": iacuc,
        "iacucs": iacucs,
        "month": month,
        "project": application.get("project", ""),
        "pi": pi_name,
        "owner": application.get("owner", ""),
        "funding": application.get("funding", ""),
        "sourceType": "cage_map",
        "sourceLabel": "动态笼位图",
        "billingUnit": statement_billing_unit_from_lines(lines),
        "principalType": principal_type,
        "freeCageAllowance": free_cages,
        "tierLimit": BILLING_TIER_LIMIT,
        "baseUnitPrice": BILLING_TIER_BASE_PRICE,
        "overageUnitPrice": BILLING_TIER_OVER_PRICE,
        "totalCageDays": sum(line["cageCount"] for line in lines),
        "totalFreeCageDays": sum(line.get("freeCages", 0) for line in lines),
        "totalBillableCageDays": sum(line.get("billableCages", 0) for line in lines),
        "totalTier1CageDays": sum(line.get("tier1BillableCages", 0) for line in lines),
        "totalTier2CageDays": sum(line.get("tier2BillableCages", 0) for line in lines),
        "totalAnimalDays": sum(line.get("animalCount", 0) for line in lines),
        "totalAmount": cumulative,
        "status": status,
        "generatedAt": generated_at,
        "lockedAt": generated_at if status == "locked" else "",
    }
    for line in lines:
        line["statementId"] = statement["id"]

    if not persist:
        return statement, lines, []

    workflow, version, statement, lines, workflow_events = save_billing_statement_workflow(
        conn,
        statement,
        lines,
        actor,
        f"生成 {pi_name} {month} 饲养费结算单",
    )
    event = audit_event(
        actor,
        "billing_statement.generated",
        "billing_workflow",
        workflow["id"],
        f"{actor['displayName']} 生成 {pi_name} {month} 饲养费结算单",
        [],
        generated_at,
        None,
        {"workflow": workflow, "version": version},
    )
    write_audit_events(conn, [event])
    return statement, lines, merge_audit_logs([], [event])


def generate_billing_statement_by_pi(conn, payload, actor):
    month = clean_text(payload.get("month", ""))
    pi_name = clean_text(payload.get("pi", ""))
    status = clean_text(payload.get("status", "draft")) or "draft"
    source_type = clean_text(payload.get("sourceType", "cage_map")) or "cage_map"
    persist = bool(payload.get("persist"))
    if not re.fullmatch(r"\d{4}-\d{2}", month):
        raise ValueError("结算月份格式应为 YYYY-MM")
    if status not in ("draft", "locked"):
        raise ValueError("结算单状态只能是 draft 或 locked")
    if source_type not in ("cage_map", "quantity_sheet"):
        raise ValueError("sourceType 只能是 cage_map 或 quantity_sheet")
    if not pi_name:
        raise ValueError("按 PI 合表需要提供项目负责人")

    principal_type_by_pi = read_principal_type_by_pi(conn)
    principal_type = principal_type_by_pi.get(pi_name, BILLING_PRINCIPAL_INDEPENDENT)
    free_cages = billing_free_cages_for_pi(principal_type_by_pi, pi_name)
    generated_at = now_iso()
    iacucs = []

    if source_type == "cage_map":
        applications_by_iacuc = read_applications_by_iacuc(conn)
        state = {
            "rooms": read_payloads(conn, "rooms", "rowid"),
            "racks": read_payloads(conn, "racks", "room_id, index_no, rowid"),
            "slots": read_payloads(conn, "cage_slots", "rack_id, row_no, col_no, rowid"),
        }
        occupancies = [
            occupancy_with_snapshots(item, state, applications_by_iacuc)
            for item in read_payloads(conn, "occupancies", "start_date, rowid")
        ]
        iacucs = sorted(
            {
                normalize_iacuc_number(item.get("iacuc", ""))
                for item in occupancies
                if clean_text(item.get("pi", "")) == pi_name and normalize_iacuc_number(item.get("iacuc", ""))
            }
        )
        cumulative = 0
        lines = []
        for date in dates_in_month(month):
            active_items = [
                item
                for item in occupancies
                if clean_text(item.get("pi", "")) == pi_name and occupancy_active_on_date(item, date)
            ]
            charge_groups = {}
            cage_count = 0
            animal_count = 0
            for item in active_items:
                profile = billing_profile_for_occupancy(item, state)
                if profile["unit"] == "animal_day":
                    count = occupancy_animal_count(item, profile)
                    animal_count += count
                else:
                    count = 1
                    cage_count += 1
                add_charge_group(charge_groups, profile, count)
            charges = combined_daily_charge(charge_groups, free_cages)
            cumulative += charges["amount"]
            breakdown = []
            for item in active_items:
                item_iacuc = normalize_iacuc_number(item.get("iacuc", ""))
                profile = billing_profile_for_occupancy(item, state)
                found = next(
                    (
                        entry
                        for entry in breakdown
                        if entry["iacuc"] == item_iacuc and entry.get("billingItem") == profile["billingItem"]
                    ),
                    None,
                )
                if not found:
                    found = {
                        "iacuc": item_iacuc,
                        "project": item.get("project", ""),
                        "animalCount": 0,
                        "cageCount": 0,
                        "billingItem": profile["billingItem"],
                        "billingUnit": profile["unit"],
                    }
                    breakdown.append(found)
                if profile["unit"] == "animal_day":
                    found["animalCount"] += occupancy_animal_count(item, profile)
                else:
                    found["cageCount"] += 1
            lines.append(
                {
                    "id": new_id("line"),
                    "date": date,
                    "animalCount": animal_count,
                    "cageCount": cage_count,
                    **charges,
                    "amount": charges["amount"],
                    "cumulative": cumulative,
                    "iacucBreakdown": breakdown,
                    "occupancyIds": [item.get("id") for item in active_items if item.get("id")],
                }
            )
        application = statement_pi_snapshot(pi_name, applications_by_iacuc, occupancies)
        statement = {
            "id": new_id("stmt"),
            "iacuc": f"pi::{pi_name}",
            "iacucs": iacucs,
            "month": month,
            "project": application.get("project", ""),
            "pi": pi_name,
            "owner": application.get("owner", ""),
            "funding": application.get("funding", ""),
            "sourceType": "pi_merged_cage_map",
            "sourceLabel": "动态笼位图（按 PI 合表）",
            "billingUnit": statement_billing_unit_from_lines(lines),
            "principalType": principal_type,
            "freeCageAllowance": free_cages,
            "tierLimit": BILLING_TIER_LIMIT,
            "baseUnitPrice": BILLING_TIER_BASE_PRICE,
            "overageUnitPrice": BILLING_TIER_OVER_PRICE,
            "totalCageDays": sum(line["cageCount"] for line in lines),
            "totalFreeCageDays": sum(line.get("freeCages", 0) for line in lines),
            "totalBillableCageDays": sum(line.get("billableCages", 0) for line in lines),
            "totalTier1CageDays": sum(line.get("tier1BillableCages", 0) for line in lines),
            "totalTier2CageDays": sum(line.get("tier2BillableCages", 0) for line in lines),
            "totalAnimalDays": sum(line.get("animalCount", 0) for line in lines),
            "totalAmount": cumulative,
            "status": status,
            "generatedAt": generated_at,
            "lockedAt": generated_at if status == "locked" else "",
        }
    else:
        sheets = [
            item
            for item in list_quantity_sheets(conn)
            if item.get("month") == month and clean_text(item.get("pi", "")) == pi_name
        ]
        if not sheets:
            raise ValueError("未找到该 PI 在结算月份内的数量统计表")
        for item in sheets:
            validate_quantity_sheet_permission(actor, item)
        iacucs = sorted({normalize_iacuc_number(item.get("iacuc", "")) for item in sheets if item.get("iacuc")})
        rooms = read_payloads(conn, "rooms", "rowid")
        lines = quantity_sheet_statement_lines(sheets, free_cages, rooms)
        statement = {
            "id": new_id("stmt"),
            "iacuc": f"pi::{pi_name}",
            "iacucs": iacucs,
            "month": month,
            "project": "、".join(sorted({item.get("project", "") for item in sheets if item.get("project")})),
            "pi": pi_name,
            "owner": "、".join(sorted({item.get("owner", "") for item in sheets if item.get("owner")})),
            "funding": "、".join(sorted({item.get("funding", "") for item in sheets if item.get("funding")})),
            "sourceType": "pi_merged_quantity_sheet",
            "sourceIds": [item["id"] for item in sheets],
            "sourceLabel": "数量统计表（按 PI 合表）",
            "roomName": "、".join(sorted({item.get("roomName", "") for item in sheets if item.get("roomName")})),
            "manager": "、".join(sorted({item.get("manager", "") for item in sheets if item.get("manager")})),
            "billingUnit": statement_billing_unit_from_lines(lines),
            "principalType": principal_type,
            "freeCageAllowance": free_cages,
            "tierLimit": BILLING_TIER_LIMIT,
            "baseUnitPrice": BILLING_TIER_BASE_PRICE,
            "overageUnitPrice": BILLING_TIER_OVER_PRICE,
            "totalCageDays": sum(line["cageCount"] for line in lines),
            "totalFreeCageDays": sum(line.get("freeCages", 0) for line in lines),
            "totalBillableCageDays": sum(line.get("billableCages", 0) for line in lines),
            "totalTier1CageDays": sum(line.get("tier1BillableCages", 0) for line in lines),
            "totalTier2CageDays": sum(line.get("tier2BillableCages", 0) for line in lines),
            "totalAnimalDays": sum(line.get("animalCount", 0) for line in lines),
            "totalAmount": lines[-1]["cumulative"] if lines else 0,
            "status": status,
            "generatedAt": generated_at,
            "lockedAt": generated_at if status == "locked" else "",
        }

    for line in lines:
        line["statementId"] = statement["id"]
    if not persist:
        return statement, lines, []
    workflow, version, statement, lines, workflow_events = save_billing_statement_workflow(
        conn,
        statement,
        lines,
        actor,
        f"按 PI 合表生成 {pi_name} {month} 饲养费结算单",
    )
    event = audit_event(
        actor,
        "billing_statement.generated_by_pi",
        "billing_workflow",
        workflow["id"],
        f"{actor['displayName']} 按 PI 合表生成 {pi_name} {month} 饲养费结算单",
        [],
        generated_at,
        None,
        {"workflow": workflow, "version": version},
    )
    write_audit_events(conn, [event])
    return statement, lines, merge_audit_logs([], [event])


def dates_in_month(month):
    year, month_no = [int(part) for part in month.split("-")]
    day_count = calendar.monthrange(year, month_no)[1]
    return [f"{year:04d}-{month_no:02d}-{day:02d}" for day in range(1, day_count + 1)]


def tiered_daily_charge(cage_count, free_cages):
    cage_count = max(as_int(cage_count) or 0, 0)
    free_cages = min(max(as_int(free_cages) or 0, 0), cage_count)
    tier1_cages = min(cage_count, BILLING_TIER_LIMIT)
    tier2_cages = max(cage_count - BILLING_TIER_LIMIT, 0)
    tier1_free = min(free_cages, tier1_cages)
    tier2_free = min(max(free_cages - tier1_free, 0), tier2_cages)
    tier1_billable = max(tier1_cages - tier1_free, 0)
    tier2_billable = max(tier2_cages - tier2_free, 0)
    amount = tier1_billable * BILLING_TIER_BASE_PRICE + tier2_billable * BILLING_TIER_OVER_PRICE
    return {
        "freeCages": free_cages,
        "billableCages": tier1_billable + tier2_billable,
        "tier1Cages": tier1_cages,
        "tier2Cages": tier2_cages,
        "tier1BillableCages": tier1_billable,
        "tier2BillableCages": tier2_billable,
        "unitPrice": BILLING_TIER_BASE_PRICE,
        "overageUnitPrice": BILLING_TIER_OVER_PRICE,
        "discountPercent": 0,
        "amount": amount,
    }


def normalize_billing_item(value):
    text = clean_text(value)
    return text if text in BILLING_RULES else "mouse_standard"


def normalize_customer_type(value):
    return "external" if clean_text(value) == "external" else "internal"


def normalize_billing_unit(value):
    return "animal_day" if clean_text(value) == "animal_day" else "cage_day"


def billing_item_for_species(species):
    return {
        "mouse": "mouse_standard",
        "rat": "rat_standard",
        "guinea_pig": "guinea_pig",
        "rabbit": "rabbit",
        "monkey": "monkey",
        "pig": "pig",
        "dog": "dog",
    }.get(clean_text(species), "mouse_standard")


def infer_billing_item_from_room(room=None):
    room = room or {}
    text = " ".join(
        clean_text(room.get(key, ""))
        for key in ("name", "area", "defaultSpecies", "species")
        if clean_text(room.get(key, ""))
    )
    if re.search(r"糖尿病.*大鼠|大鼠.*糖尿病", text):
        return "rat_diabetic"
    if re.search(r"糖尿病.*小鼠|小鼠.*糖尿病", text):
        return "mouse_diabetic"
    if "豚鼠" in text:
        return "guinea_pig"
    if "大鼠" in text:
        return "rat_standard"
    if "兔" in text:
        return "rabbit"
    if "猴" in text:
        return "monkey"
    if "犬" in text or "狗" in text:
        return "dog"
    if "猪" in text:
        return "pig"
    if "小鼠" in text:
        return "mouse_standard"
    return ""


def room_has_manual_billing_profile(room=None, inferred_billing_item=""):
    room = room or {}
    if room.get("billingProfileConfirmed"):
        return True
    if not room.get("billingProfileConfigured"):
        return False
    fallback_mouse = (
        clean_text(room.get("defaultBillingItem", "")) in ("", "mouse_standard")
        and clean_text(room.get("defaultSpecies", "")) in ("", "mouse")
    )
    return not (fallback_mouse and inferred_billing_item and inferred_billing_item != "mouse_standard")


def billing_profile_for_room(room=None, fallback_unit=None):
    room = room or {}
    inferred_billing_item = infer_billing_item_from_room(room)
    manual_billing = room_has_manual_billing_profile(room, inferred_billing_item)
    billing_item = normalize_billing_item(
        (room.get("defaultBillingItem") if manual_billing else inferred_billing_item)
        or room.get("defaultBillingItem")
        or billing_item_for_species(room.get("defaultSpecies", "mouse"))
    )
    if fallback_unit == "animal_day" and billing_item == "mouse_standard":
        billing_item = "guinea_pig"
    rule = BILLING_RULES.get(billing_item, BILLING_RULES["mouse_standard"])
    customer_type = normalize_customer_type(room.get("defaultCustomerType", "internal"))
    unit_price = rule["externalPrice"] if customer_type == "external" else rule["internalPrice"]
    return {
        "facility": clean_text(room.get("facility", "zhujiang")) or "zhujiang",
        "species": rule["species"],
        "billingItem": billing_item,
        "customerType": customer_type,
        "unit": rule["unit"],
        "unitPrice": unit_price,
        "tiered": bool(rule.get("tiered") and customer_type == "internal"),
        "freeAllowance": bool(rule.get("freeAllowance") and customer_type == "internal"),
        "defaultAnimalCount": max(as_int(room.get("defaultAnimalCount")) or 1, 1),
    }


def billing_profile_for_occupancy(occupancy, state):
    slot = next((item for item in state.get("slots", []) if item.get("id") == occupancy.get("slotId")), None)
    rack = next((item for item in state.get("racks", []) if item.get("id") == (slot or {}).get("rackId")), None)
    room = next((item for item in state.get("rooms", []) if item.get("id") == (rack or {}).get("roomId")), None)
    base = billing_profile_for_room(room)
    billing_item = normalize_billing_item(occupancy.get("billingItem") or base["billingItem"])
    rule = BILLING_RULES.get(billing_item, BILLING_RULES["mouse_standard"])
    customer_type = normalize_customer_type(occupancy.get("customerType") or base["customerType"])
    unit_price = rule["externalPrice"] if customer_type == "external" else rule["internalPrice"]
    return {
        **base,
        "species": rule["species"],
        "billingItem": billing_item,
        "customerType": customer_type,
        "unit": rule["unit"],
        "unitPrice": unit_price,
        "tiered": bool(rule.get("tiered") and customer_type == "internal"),
        "freeAllowance": bool(rule.get("freeAllowance") and customer_type == "internal"),
    }


def occupancy_animal_count(occupancy, profile):
    return max(as_int(occupancy.get("animalCount")) or as_int(profile.get("defaultAnimalCount")) or 1, 1)


def flat_daily_charge(count, profile):
    count = max(as_int(count) or 0, 0)
    amount = count * float(profile.get("unitPrice") or 0)
    if profile.get("unit") == "animal_day":
        return {
            "freeCages": 0,
            "billableCages": 0,
            "tier1Cages": 0,
            "tier2Cages": 0,
            "tier1BillableCages": 0,
            "tier2BillableCages": 0,
            "billableAnimals": count,
            "unitPrice": profile.get("unitPrice") or 0,
            "overageUnitPrice": 0,
            "discountPercent": 0,
            "amount": amount,
        }
    return {
        "freeCages": 0,
        "billableCages": count,
        "tier1Cages": count,
        "tier2Cages": 0,
        "tier1BillableCages": count,
        "tier2BillableCages": 0,
        "billableAnimals": 0,
        "unitPrice": profile.get("unitPrice") or 0,
        "overageUnitPrice": 0,
        "discountPercent": 0,
        "amount": amount,
    }


def add_charge_group(groups, profile, count):
    count = max(as_int(count) or 0, 0)
    if count <= 0:
        return
    key = "|".join(
        [
            profile.get("billingItem", ""),
            profile.get("customerType", ""),
            profile.get("unit", ""),
            str(profile.get("unitPrice") or 0),
        ]
    )
    if key not in groups:
        groups[key] = {"profile": profile, "count": 0}
    groups[key]["count"] += count


def combined_daily_charge(groups, free_cages):
    total = {
        "freeCages": 0,
        "billableCages": 0,
        "tier1Cages": 0,
        "tier2Cages": 0,
        "tier1BillableCages": 0,
        "tier2BillableCages": 0,
        "billableAnimals": 0,
        "unitPrice": BILLING_TIER_BASE_PRICE,
        "overageUnitPrice": BILLING_TIER_OVER_PRICE,
        "discountPercent": 0,
        "amount": 0,
    }
    remaining_free_cages = max(as_int(free_cages) or 0, 0)
    for group in groups.values():
        profile = group["profile"]
        count = group["count"]
        if profile.get("tiered"):
            allowance = remaining_free_cages if profile.get("freeAllowance") else 0
            charges = tiered_daily_charge(count, allowance)
            remaining_free_cages = max(remaining_free_cages - charges.get("freeCages", 0), 0)
        else:
            charges = flat_daily_charge(count, profile)
        for key in (
            "freeCages",
            "billableCages",
            "tier1Cages",
            "tier2Cages",
            "tier1BillableCages",
            "tier2BillableCages",
            "billableAnimals",
            "amount",
        ):
            total[key] += charges.get(key, 0)
        total["unitPrice"] = charges.get("unitPrice", total["unitPrice"])
        if charges.get("overageUnitPrice"):
            total["overageUnitPrice"] = charges.get("overageUnitPrice")
    return total


def statement_billing_unit_from_lines(lines):
    has_animals = any((line.get("animalCount") or 0) > 0 for line in lines)
    has_cages = any((line.get("cageCount") or 0) > 0 for line in lines)
    if has_animals and has_cages:
        return "mixed"
    return "animal_day" if has_animals else "cage_day"


def occupancy_active_on_date(item, date):
    if item.get("status") not in ("active", "ended"):
        return False
    if not item.get("startDate") or item.get("startDate") > date:
        return False
    if item.get("endDate") and item.get("endDate") < date:
        return False
    return True


def billing_unit_price_for(rules, date):
    for rule in rules:
        after_start = not rule.get("effectiveStart") or rule.get("effectiveStart") <= date
        before_end = not rule.get("effectiveEnd") or rule.get("effectiveEnd") >= date
        if rule.get("unit") == "cage_day" and after_start and before_end:
            return float(rule.get("price") or 0)
    return 4.5


def billing_discount_for(adjustments, iacuc, date):
    for adjustment in adjustments:
        in_range = (
            (not adjustment.get("effectiveStart") or adjustment.get("effectiveStart") <= date)
            and (not adjustment.get("effectiveEnd") or adjustment.get("effectiveEnd") >= date)
        )
        if (
            adjustment.get("targetType") == "iacuc"
            and normalize_iacuc_number(adjustment.get("targetId", "")) == iacuc
            and adjustment.get("type") == "discount"
            and in_range
        ):
            return float(adjustment.get("value") or 0)
    return 0


def billing_free_cages_for(adjustments, pi_name):
    for adjustment in adjustments:
        if (
            adjustment.get("targetType") == "pi"
            and clean_text(adjustment.get("targetId", "")) == pi_name
            and adjustment.get("type") == "free_cages"
        ):
            if adjustment.get("principalType"):
                return free_cages_for_principal_type(adjustment.get("principalType"))
            return max(as_int(adjustment.get("value")) or 0, 0)
    return FREE_CAGES_DEFAULT


def read_principal_type_by_pi(conn):
    rows = conn.execute("SELECT payload FROM principal_identities").fetchall()
    return {
        clean_text(item.get("pi", "")): normalize_principal_type(item.get("principalType", ""))
        for item in (json.loads(row["payload"]) for row in rows)
        if clean_text(item.get("pi", ""))
    }


def billing_free_cages_for_pi(principal_type_by_pi, pi_name):
    return free_cages_for_principal_type(principal_type_by_pi.get(clean_text(pi_name), BILLING_PRINCIPAL_INDEPENDENT))


def normalize_principal_type(value):
    return BILLING_PRINCIPAL_PI if value == BILLING_PRINCIPAL_PI else BILLING_PRINCIPAL_INDEPENDENT


def free_cages_for_principal_type(value):
    return FREE_CAGES_PI if normalize_principal_type(value) == BILLING_PRINCIPAL_PI else FREE_CAGES_INDEPENDENT


def principal_type_label(value):
    return "PI" if normalize_principal_type(value) == BILLING_PRINCIPAL_PI else "独立科研人员"


def pi_for_iacuc(iacuc, applications_by_iacuc, occupancies):
    if not iacuc:
        return ""
    application = applications_by_iacuc.get(iacuc)
    if application and application.get("pi"):
        return clean_text(application.get("pi", ""))
    for item in occupancies:
        if normalize_iacuc_number(item.get("iacuc", "")) == iacuc and item.get("pi"):
            return clean_text(item.get("pi", ""))
    return ""


def statement_application_snapshot(iacuc, applications_by_iacuc, occupancies):
    application = applications_by_iacuc.get(iacuc)
    if application:
        return application
    for item in occupancies:
        if normalize_iacuc_number(item.get("iacuc", "")) == iacuc:
            return {
                "project": item.get("project", ""),
                "pi": item.get("pi", ""),
                "owner": item.get("owner", ""),
                "funding": item.get("funding", ""),
            }
    return {}


def statement_pi_snapshot(pi_name, applications_by_iacuc, occupancies):
    projects = []
    owners = []
    fundings = []
    for application in applications_by_iacuc.values():
        if clean_text(application.get("pi", "")) == pi_name:
            projects.append(application.get("project", ""))
            owners.append(application.get("owner", ""))
            fundings.append(application.get("funding", ""))
    for item in occupancies:
        if clean_text(item.get("pi", "")) == pi_name:
            projects.append(item.get("project", ""))
            owners.append(item.get("owner", ""))
            fundings.append(item.get("funding", ""))
    return {
        "project": "、".join(sorted({value for value in projects if value})),
        "pi": pi_name,
        "owner": "、".join(sorted({value for value in owners if value})),
        "funding": "、".join(sorted({value for value in fundings if value})),
    }


def normalize_workflow_source(source_type):
    text = clean_text(source_type or "")
    return text if text else "cage_map"


def workflow_scope_for_statement(statement):
    source_type = normalize_workflow_source(statement.get("sourceType", ""))
    pi_name = clean_text(statement.get("pi", ""))
    if source_type.startswith("pi_merged_") and pi_name:
        return "pi", f"pi::{pi_name}"
    if source_type in ("cage_map", "quantity_sheet") and pi_name:
        return "pi", f"pi::{pi_name}"
    iacuc = clean_text(statement.get("iacuc", ""))
    return "iacuc", iacuc


def billing_workflow_business_key(scope_type, scope_key, month, source_type):
    return "|".join([clean_text(scope_type), clean_text(scope_key), clean_text(month), normalize_workflow_source(source_type)])


def make_statement_document_number(statement, version_no):
    source = normalize_workflow_source(statement.get("sourceType", ""))
    source_code = {
        "quantity_sheet": "QS",
        "pi_merged_quantity_sheet": "PQS",
        "pi_merged_cage_map": "PCM",
    }.get(source, "CM")
    month = re.sub(r"\D", "", clean_text(statement.get("month", "")) or "000000")
    iacuc = re.sub(r"[^A-Za-z0-9]", "", clean_text(statement.get("iacuc", "")) or "UNKNOWN").upper()
    return f"CL-{source_code}-{month}-{iacuc}-V{int(version_no):02d}"


def enrich_statement_for_workflow(
    statement,
    *,
    workflow_id,
    version_id,
    version_no,
    version_status,
    workflow_status,
    document_number,
):
    return {
        **statement,
        "id": version_id,
        "workflowId": workflow_id,
        "versionId": version_id,
        "versionNo": version_no,
        "versionStatus": version_status,
        "workflowStatus": workflow_status,
        "documentNumber": document_number,
    }


def build_version_payload(
    statement,
    workflow_id,
    version_no,
    version_status,
    workflow_status,
    generated_at,
    voided_at,
    voided_by,
    void_reason,
):
    return {
        "id": statement["id"],
        "workflowId": workflow_id,
        "versionNo": version_no,
        "versionStatus": version_status,
        "workflowStatus": workflow_status,
        "generatedAt": generated_at,
        "voidedAt": voided_at,
        "voidedBy": voided_by,
        "voidReason": void_reason,
        "documentNumber": statement.get("documentNumber", ""),
        "statement": statement,
        "summary": {
            "iacuc": statement.get("iacuc", ""),
            "iacucs": statement.get("iacucs", []),
            "month": statement.get("month", ""),
            "sourceType": statement.get("sourceType", ""),
            "pi": statement.get("pi", ""),
            "project": statement.get("project", ""),
            "owner": statement.get("owner", ""),
            "funding": statement.get("funding", ""),
            "totalAmount": statement.get("totalAmount", 0),
            "totalCageDays": statement.get("totalCageDays", 0),
            "status": statement.get("status", "draft"),
        },
    }


def build_workflow_payload(workflow_id, iacuc, month, source_type, workflow_status, current_version, latest_event_at):
    statement = current_version.get("statement", {})
    scope_type, scope_key = workflow_scope_for_statement(statement)
    timestamps = {
        "generatedAt": current_version.get("generatedAt", ""),
        "sentAt": statement.get("sentAt", ""),
        "signedReturnedAt": statement.get("signedReturnedAt", ""),
        "submittedToFinanceAt": statement.get("submittedToFinanceAt", ""),
    }
    return {
        "id": workflow_id,
        "businessKey": billing_workflow_business_key(scope_type, scope_key, month, source_type),
        "scopeType": scope_type,
        "scopeKey": scope_key,
        "iacuc": iacuc,
        "iacucs": statement.get("iacucs", []),
        "month": month,
        "sourceType": source_type,
        "workflowStatus": workflow_status,
        "currentVersionId": current_version.get("id", ""),
        "currentVersionNo": current_version.get("versionNo", 0),
        "currentVersion": current_version,
        "latestEventAt": latest_event_at,
        "pi": statement.get("pi", ""),
        "project": statement.get("project", ""),
        "owner": statement.get("owner", ""),
        "funding": statement.get("funding", ""),
        "totalAmount": statement.get("totalAmount", 0),
        "totalCageDays": statement.get("totalCageDays", 0),
        **timestamps,
    }


def build_workflow_event_payload(event_id, workflow_id, version_id, event_type, from_status, to_status, actor, at, channel, note):
    return {
        "id": event_id,
        "workflowId": workflow_id,
        "versionId": version_id,
        "eventType": event_type,
        "fromStatus": from_status,
        "toStatus": to_status,
        "actor": {
            "id": actor.get("id", ""),
            "username": actor.get("username", ""),
            "displayName": actor.get("displayName", ""),
        },
        "channel": channel,
        "note": note,
        "at": at,
    }


def get_billing_workflow_by_key(conn, business_key):
    row = conn.execute("SELECT payload FROM billing_workflows WHERE business_key = ?", (business_key,)).fetchone()
    return json.loads(row["payload"]) if row else None


def get_billing_workflow(conn, workflow_id):
    row = conn.execute("SELECT payload FROM billing_workflows WHERE id = ?", (workflow_id,)).fetchone()
    return json.loads(row["payload"]) if row else None


def get_billing_version(conn, version_id):
    row = conn.execute("SELECT payload FROM billing_statement_versions WHERE id = ?", (version_id,)).fetchone()
    return json.loads(row["payload"]) if row else None


def list_billing_workflows(conn):
    rows = conn.execute("SELECT payload FROM billing_workflows ORDER BY month DESC, rowid DESC").fetchall()
    return [json.loads(row["payload"]) for row in rows]


def delete_billing_workflow(conn, workflow_id):
    workflow = get_billing_workflow(conn, workflow_id)
    if not workflow:
        raise LookupError("结算流程不存在")
    conn.execute(
        """
        DELETE FROM billing_statement_version_lines
        WHERE version_id IN (
            SELECT id FROM billing_statement_versions WHERE workflow_id = ?
        )
        """,
        (workflow_id,),
    )
    conn.execute("DELETE FROM billing_workflow_events WHERE workflow_id = ?", (workflow_id,))
    conn.execute("DELETE FROM billing_statement_versions WHERE workflow_id = ?", (workflow_id,))
    conn.execute("DELETE FROM billing_workflows WHERE id = ?", (workflow_id,))
    return workflow


def list_billing_workflow_versions(conn, workflow_id):
    rows = conn.execute(
        "SELECT payload FROM billing_statement_versions WHERE workflow_id = ? ORDER BY version_no DESC, rowid DESC",
        (workflow_id,),
    ).fetchall()
    return [json.loads(row["payload"]) for row in rows]


def list_billing_workflow_events(conn, workflow_id):
    rows = conn.execute(
        "SELECT payload FROM billing_workflow_events WHERE workflow_id = ? ORDER BY at DESC, rowid DESC",
        (workflow_id,),
    ).fetchall()
    return [json.loads(row["payload"]) for row in rows]


def list_billing_statement_lines_for_version(conn, version_id):
    rows = conn.execute(
        "SELECT payload FROM billing_statement_version_lines WHERE version_id = ? ORDER BY line_date, rowid",
        (version_id,),
    ).fetchall()
    return [json.loads(row["payload"]) for row in rows]


def list_current_billing_statements(conn):
    statements = []
    for workflow in list_billing_workflows(conn):
        current_version = workflow.get("currentVersion") or {}
        statement = dict((current_version.get("statement") or {}))
        if statement:
            statements.append(statement)
    return statements


def save_billing_statement_workflow(conn, statement, lines, actor, note=""):
    source_type = normalize_workflow_source(statement.get("sourceType", ""))
    scope_type, scope_key = workflow_scope_for_statement(statement)
    business_key = billing_workflow_business_key(scope_type, scope_key, statement.get("month", ""), source_type)
    existing = get_billing_workflow_by_key(conn, business_key)
    generated_at = statement.get("generatedAt") or now_iso()
    default_note = note or "生成饲养费结算单"
    events = []

    if not existing:
        workflow_id = new_id("bwf")
        version_id = new_id("stmt")
        version_no = 1
        lines = [{**line, "statementId": version_id} for line in lines]
        document_number = make_statement_document_number(statement, version_no)
        statement = enrich_statement_for_workflow(
            statement,
            workflow_id=workflow_id,
            version_id=version_id,
            version_no=version_no,
            version_status=VERSION_STATUS_ACTIVE,
            workflow_status=WORKFLOW_STATUS_GENERATED,
            document_number=document_number,
        )
        version_payload = build_version_payload(
            statement,
            workflow_id,
            version_no,
            VERSION_STATUS_ACTIVE,
            WORKFLOW_STATUS_GENERATED,
            generated_at,
            "",
            "",
            "",
        )
        workflow_payload = build_workflow_payload(
            workflow_id,
            statement.get("iacuc", ""),
            statement.get("month", ""),
            source_type,
            WORKFLOW_STATUS_GENERATED,
            version_payload,
            generated_at,
        )
        insert_billing_workflow(conn, workflow_payload)
        insert_billing_version(conn, version_payload)
        replace_version_lines(conn, version_id, lines)
        event = build_workflow_event_payload(
            new_id("wevt"),
            workflow_id,
            version_id,
            "statement_generated",
            "",
            WORKFLOW_STATUS_GENERATED,
            actor,
            generated_at,
            "manual",
            default_note,
        )
        insert_billing_workflow_event(conn, event)
        events.append(event)
        return workflow_payload, version_payload, statement, lines, events

    workflow_id = existing["id"]
    current_version = existing.get("currentVersion") or {}
    current_version_id = current_version.get("id")
    current_workflow_status = existing.get("workflowStatus", WORKFLOW_STATUS_GENERATED)

    if current_workflow_status == WORKFLOW_STATUS_GENERATED and current_version_id:
        version_id = current_version_id
        version_no = int(current_version.get("versionNo") or existing.get("currentVersionNo") or 1)
        lines = [{**line, "statementId": version_id} for line in lines]
        document_number = current_version.get("documentNumber") or make_statement_document_number(statement, version_no)
        statement = enrich_statement_for_workflow(
            statement,
            workflow_id=workflow_id,
            version_id=version_id,
            version_no=version_no,
            version_status=VERSION_STATUS_ACTIVE,
            workflow_status=WORKFLOW_STATUS_GENERATED,
            document_number=document_number,
        )
        version_payload = build_version_payload(
            statement,
            workflow_id,
            version_no,
            VERSION_STATUS_ACTIVE,
            WORKFLOW_STATUS_GENERATED,
            generated_at,
            "",
            "",
            "",
        )
        update_billing_version(conn, version_payload)
        replace_version_lines(conn, version_id, lines)
        workflow_payload = build_workflow_payload(
            workflow_id,
            statement.get("iacuc", ""),
            statement.get("month", ""),
            source_type,
            WORKFLOW_STATUS_GENERATED,
            version_payload,
            generated_at,
        )
        update_billing_workflow(conn, workflow_payload)
        event = build_workflow_event_payload(
            new_id("wevt"),
            workflow_id,
            version_id,
            "statement_generated",
            WORKFLOW_STATUS_GENERATED,
            WORKFLOW_STATUS_GENERATED,
            actor,
            generated_at,
            "manual",
            default_note,
        )
        insert_billing_workflow_event(conn, event)
        events.append(event)
        return workflow_payload, version_payload, statement, lines, events

    void_at = generated_at
    if current_version_id:
        previous = get_billing_version(conn, current_version_id) or current_version
        previous_statement = dict(previous.get("statement") or {})
        previous_statement["workflowStatus"] = current_workflow_status
        previous_payload = build_version_payload(
            previous_statement,
            workflow_id,
            int(previous.get("versionNo") or existing.get("currentVersionNo") or 1),
            VERSION_STATUS_VOIDED,
            current_workflow_status,
            previous.get("generatedAt") or generated_at,
            void_at,
            actor.get("displayName", ""),
            note or "根据更正数据生成修订版",
        )
        update_billing_version(conn, previous_payload)
        void_event = build_workflow_event_payload(
            new_id("wevt"),
            workflow_id,
            current_version_id,
            "statement_voided",
            current_workflow_status,
            current_workflow_status,
            actor,
            void_at,
            "manual",
            note or "旧版本作废，生成修订版",
        )
        insert_billing_workflow_event(conn, void_event)
        events.append(void_event)

    version_no = int(existing.get("currentVersionNo") or 0) + 1
    version_id = new_id("stmt")
    lines = [{**line, "statementId": version_id} for line in lines]
    document_number = make_statement_document_number(statement, version_no)
    statement = enrich_statement_for_workflow(
        statement,
        workflow_id=workflow_id,
        version_id=version_id,
        version_no=version_no,
        version_status=VERSION_STATUS_ACTIVE,
        workflow_status=WORKFLOW_STATUS_GENERATED,
        document_number=document_number,
    )
    version_payload = build_version_payload(
        statement,
        workflow_id,
        version_no,
        VERSION_STATUS_ACTIVE,
        WORKFLOW_STATUS_GENERATED,
        generated_at,
        "",
        "",
        "",
    )
    insert_billing_version(conn, version_payload)
    replace_version_lines(conn, version_id, lines)
    workflow_payload = build_workflow_payload(
        workflow_id,
        statement.get("iacuc", ""),
        statement.get("month", ""),
        source_type,
        WORKFLOW_STATUS_GENERATED,
        version_payload,
        generated_at,
    )
    update_billing_workflow(conn, workflow_payload)
    revise_event = build_workflow_event_payload(
        new_id("wevt"),
        workflow_id,
        version_id,
        "statement_revised",
        current_workflow_status,
        WORKFLOW_STATUS_GENERATED,
        actor,
        generated_at,
        "manual",
        note or "基于当前有效版本生成修订版",
    )
    insert_billing_workflow_event(conn, revise_event)
    events.append(revise_event)
    return workflow_payload, version_payload, statement, lines, events


def insert_billing_workflow(conn, payload):
    conn.execute(
        """
        INSERT INTO billing_workflows (
            id, business_key, iacuc, month, source_type, workflow_status,
            current_version_id, current_version_no, latest_event_at, payload
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            payload["id"],
            payload.get("businessKey", billing_workflow_business_key(payload.get("scopeType", ""), payload.get("scopeKey", ""), payload.get("month", ""), payload.get("sourceType", ""))),
            payload.get("iacuc", ""),
            payload.get("month", ""),
            payload.get("sourceType", ""),
            payload.get("workflowStatus", WORKFLOW_STATUS_GENERATED),
            payload.get("currentVersionId", ""),
            as_int(payload.get("currentVersionNo")) or 0,
            payload.get("latestEventAt", ""),
            dump_json(payload),
        ),
    )


def update_billing_workflow(conn, payload):
    conn.execute(
        """
        UPDATE billing_workflows
        SET business_key = ?, iacuc = ?, month = ?, source_type = ?, workflow_status = ?,
            current_version_id = ?, current_version_no = ?, latest_event_at = ?, payload = ?
        WHERE id = ?
        """,
        (
            payload.get("businessKey", billing_workflow_business_key(payload.get("scopeType", ""), payload.get("scopeKey", ""), payload.get("month", ""), payload.get("sourceType", ""))),
            payload.get("iacuc", ""),
            payload.get("month", ""),
            payload.get("sourceType", ""),
            payload.get("workflowStatus", WORKFLOW_STATUS_GENERATED),
            payload.get("currentVersionId", ""),
            as_int(payload.get("currentVersionNo")) or 0,
            payload.get("latestEventAt", ""),
            dump_json(payload),
            payload["id"],
        ),
    )


def insert_billing_version(conn, payload):
    conn.execute(
        """
        INSERT INTO billing_statement_versions (
            id, workflow_id, version_no, version_status, workflow_status,
            generated_at, voided_at, created_by, payload
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            payload["id"],
            payload.get("workflowId", ""),
            as_int(payload.get("versionNo")) or 1,
            payload.get("versionStatus", VERSION_STATUS_ACTIVE),
            payload.get("workflowStatus", WORKFLOW_STATUS_GENERATED),
            payload.get("generatedAt", ""),
            payload.get("voidedAt", ""),
            payload.get("statement", {}).get("createdBy", ""),
            dump_json(payload),
        ),
    )


def update_billing_version(conn, payload):
    conn.execute(
        """
        UPDATE billing_statement_versions
        SET version_no = ?, version_status = ?, workflow_status = ?, generated_at = ?,
            voided_at = ?, created_by = ?, payload = ?
        WHERE id = ?
        """,
        (
            as_int(payload.get("versionNo")) or 1,
            payload.get("versionStatus", VERSION_STATUS_ACTIVE),
            payload.get("workflowStatus", WORKFLOW_STATUS_GENERATED),
            payload.get("generatedAt", ""),
            payload.get("voidedAt", ""),
            payload.get("statement", {}).get("createdBy", ""),
            dump_json(payload),
            payload["id"],
        ),
    )


def replace_version_lines(conn, version_id, lines):
    conn.execute("DELETE FROM billing_statement_version_lines WHERE version_id = ?", (version_id,))
    for index, line in enumerate(lines, start=1):
        normalized = {**line, "versionId": version_id}
        line_id = normalized.get("id") or f"{version_id}-line-{index}"
        conn.execute(
            """
            INSERT INTO billing_statement_version_lines (id, version_id, line_date, payload)
            VALUES (?, ?, ?, ?)
            """,
            (line_id, version_id, normalized.get("date", ""), dump_json(normalized)),
        )


def insert_billing_workflow_event(conn, payload):
    conn.execute(
        """
        INSERT INTO billing_workflow_events (
            id, workflow_id, version_id, event_type, from_status, to_status, at, payload
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            payload["id"],
            payload.get("workflowId", ""),
            payload.get("versionId", ""),
            payload.get("eventType", ""),
            payload.get("fromStatus", ""),
            payload.get("toStatus", ""),
            payload.get("at", ""),
            dump_json(payload),
        ),
    )


def update_workflow_status(conn, workflow_id, next_status, actor, note=""):
    workflow = get_billing_workflow(conn, workflow_id)
    if not workflow:
        raise LookupError("结算流程不存在")
    current_status = workflow.get("workflowStatus", WORKFLOW_STATUS_GENERATED)
    allowed = {
        WORKFLOW_STATUS_GENERATED: WORKFLOW_STATUS_SENT,
        WORKFLOW_STATUS_SENT: WORKFLOW_STATUS_SIGNED,
        WORKFLOW_STATUS_SIGNED: WORKFLOW_STATUS_FINANCE,
    }
    if allowed.get(current_status) != next_status:
        raise ValueError("当前流程状态不允许执行该操作")

    version = get_billing_version(conn, workflow.get("currentVersionId", ""))
    if not version:
        raise LookupError("当前有效结算单不存在")
    statement = dict(version.get("statement") or {})
    at = now_iso()
    statement["workflowStatus"] = next_status
    if next_status == WORKFLOW_STATUS_SENT:
        statement["sentAt"] = at
    elif next_status == WORKFLOW_STATUS_SIGNED:
        statement["signedReturnedAt"] = at
    elif next_status == WORKFLOW_STATUS_FINANCE:
        statement["submittedToFinanceAt"] = at
    updated_version = build_version_payload(
        statement,
        workflow_id,
        version.get("versionNo", 1),
        version.get("versionStatus", VERSION_STATUS_ACTIVE),
        next_status,
        version.get("generatedAt", at),
        version.get("voidedAt", ""),
        version.get("voidedBy", ""),
        version.get("voidReason", ""),
    )
    update_billing_version(conn, updated_version)
    updated_workflow = build_workflow_payload(
        workflow_id,
        workflow.get("iacuc", ""),
        workflow.get("month", ""),
        workflow.get("sourceType", ""),
        next_status,
        updated_version,
        at,
    )
    update_billing_workflow(conn, updated_workflow)
    event = build_workflow_event_payload(
        new_id("wevt"),
        workflow_id,
        updated_version["id"],
        {
            WORKFLOW_STATUS_SENT: "statement_sent",
            WORKFLOW_STATUS_SIGNED: "statement_signed_returned",
            WORKFLOW_STATUS_FINANCE: "submitted_to_finance",
        }[next_status],
        current_status,
        next_status,
        actor,
        at,
        "manual",
        note,
    )
    insert_billing_workflow_event(conn, event)
    return updated_workflow, updated_version, event


def parse_multipart_upload(content_type, raw):
    if "multipart/form-data" not in content_type:
        raise ValueError("请使用 multipart/form-data 上传 CSV 文件")
    boundary = multipart_boundary(content_type)
    delimiter = b"--" + boundary
    for part in raw.split(delimiter):
        part = part.strip(b"\r\n")
        if not part or part == b"--" or b"\r\n\r\n" not in part:
            continue
        header_blob, body = part.split(b"\r\n\r\n", 1)
        headers = header_blob.decode("utf-8", errors="replace")
        disposition = next((line for line in headers.split("\r\n") if line.lower().startswith("content-disposition:")), "")
        if 'name="file"' not in disposition:
            continue
        filename = multipart_filename(disposition)
        return filename, body.rstrip(b"\r\n")
    raise ValueError("没有找到上传字段 file")


def multipart_boundary(content_type):
    for segment in content_type.split(";"):
        segment = segment.strip()
        if segment.startswith("boundary="):
            value = segment.split("=", 1)[1].strip()
            if value.startswith('"') and value.endswith('"'):
                value = value[1:-1]
            return value.encode("utf-8")
    raise ValueError("上传请求缺少 multipart boundary")


def multipart_filename(disposition):
    match = re.search(r'filename="([^"]*)"', disposition)
    return match.group(1) if match else ""


class CageLedgerHandler(SimpleHTTPRequestHandler):
    server_version = "CageLedger/0.2"

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def end_headers(self):
        if not urlparse(self.path).path.startswith("/api/"):
            self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        super().end_headers()

    def do_OPTIONS(self):
        self.send_response(HTTPStatus.NO_CONTENT)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()

    def do_GET(self):
        path = urlparse(self.path).path
        if path == "/api/health":
            self.send_json({"ok": True, "database": str(DB_PATH), "system": system_info()})
            return
        if path == "/api/system/info":
            self.send_json(system_info())
            return
        if path == "/api/auth/me":
            user = self.current_user()
            if not user:
                self.send_json({"user": None}, HTTPStatus.UNAUTHORIZED)
                return
            self.send_json({"user": user})
            return
        if path == "/api/state":
            user = self.require_user()
            if not user:
                return
            payload = read_state()
            self.send_json({**payload, "state": filter_state_for_actor(payload.get("state"), user)})
            return
        if path == "/api/iacuc-index":
            if not self.require_user():
                return
            self.send_json(read_iacuc_index())
            return
        if path == "/api/iacuc-index/status":
            if not self.require_user():
                return
            payload = read_iacuc_index()
            self.send_json({key: payload[key] for key in ("count", "updatedAt", "source")})
            return
        if path == "/api/system/update-check":
            user = self.require_user()
            if not user:
                return
            if user["role"] != "admin":
                self.send_json({"error": "需要管理员权限"}, HTTPStatus.FORBIDDEN)
                return
            try:
                self.send_json(system_update_status())
            except ValueError as exc:
                self.send_json({"error": str(exc)}, HTTPStatus.BAD_GATEWAY)
            return
        if path == "/api/users":
            user = self.require_user()
            if not user:
                return
            if user["role"] != "admin":
                self.send_json({"error": "需要管理员权限"}, HTTPStatus.FORBIDDEN)
                return
            with connect_db() as conn:
                self.send_json({"users": list_users(conn)})
            return
        if path == "/api/quantity-sheets":
            if not self.require_user():
                return
            with connect_db() as conn:
                self.send_json({"items": list_quantity_sheets(conn)})
            return
        if path == "/api/principal-identities":
            user = self.require_user()
            if not user:
                return
            if user["role"] != "admin":
                self.send_json({"error": "需要管理员权限"}, HTTPStatus.FORBIDDEN)
                return
            with connect_db() as conn:
                self.send_json({"items": list_principal_identities(conn)})
            return
        if path == "/api/billing-workflows":
            user = self.require_user()
            if not user:
                return
            with connect_db() as conn:
                self.send_json({"items": list_billing_workflows(conn)})
            return
        workflow_id = self.billing_workflow_route(path)
        if workflow_id:
            user = self.require_user()
            if not user:
                return
            with connect_db() as conn:
                workflow = get_billing_workflow(conn, workflow_id)
                if not workflow:
                    self.send_json({"error": "结算流程不存在"}, HTTPStatus.NOT_FOUND)
                    return
                self.send_json(
                    {
                        "workflow": workflow,
                        "versions": list_billing_workflow_versions(conn, workflow_id),
                        "events": list_billing_workflow_events(conn, workflow_id),
                        "lines": list_billing_statement_lines_for_version(conn, workflow.get("currentVersionId", "")),
                    }
                )
            return
        if path == "/api/billing-statements":
            user = self.require_user()
            if not user:
                return
            with connect_db() as conn:
                self.send_json({"items": list_current_billing_statements(conn)})
            return
        if path in ENTITY_ENDPOINTS:
            user = self.require_user()
            if not user:
                return
            self.send_entity_list(ENTITY_ENDPOINTS[path], user)
            return
        super().do_GET()

    def do_POST(self):
        path = urlparse(self.path).path
        if path == "/api/auth/login":
            self.handle_login()
            return
        if path == "/api/auth/logout":
            self.handle_logout()
            return
        if path == "/api/iacuc-index/upload":
            self.handle_iacuc_upload()
            return
        if path == "/api/billing-statements/generate":
            self.handle_billing_statement_generate()
            return
        if path == "/api/billing-statements/generate-by-pi":
            self.handle_billing_statement_generate_by_pi()
            return
        if path == "/api/billing-workflows/advance":
            self.handle_billing_workflow_advance()
            return
        if path == "/api/infrastructure":
            self.handle_infrastructure_write()
            return
        sheet_id = self.quantity_sheet_generate_route(path)
        if sheet_id:
            self.handle_quantity_sheet_statement_generate(sheet_id)
            return
        if path == "/api/quantity-sheets":
            self.handle_quantity_sheet_save(None)
            return
        if path == "/api/users":
            user = self.require_user()
            if not user:
                return
            if user["role"] != "admin":
                self.send_json({"error": "需要管理员权限"}, HTTPStatus.FORBIDDEN)
                return
            try:
                body = self.read_json_body()
                with connect_db() as conn:
                    created = create_user(conn, body)
                self.send_json({"user": created}, HTTPStatus.CREATED)
            except sqlite3.IntegrityError:
                self.send_json({"error": "用户名已存在"}, HTTPStatus.CONFLICT)
            except ValueError as exc:
                self.send_json({"error": str(exc)}, HTTPStatus.BAD_REQUEST)
            return
        if path in WRITABLE_ENTITY_ENDPOINTS:
            self.handle_entity_write("POST", path, None)
            return
        self.send_error(HTTPStatus.NOT_FOUND)

    def do_PUT(self):
        path = urlparse(self.path).path
        if path == "/api/state":
            user = self.require_user()
            if not user:
                return

            try:
                body = self.read_json_body()
                state = body.get("state")
                if not isinstance(state, dict):
                    self.send_error(HTTPStatus.BAD_REQUEST, "Request body must contain a state object")
                    return
                self.send_json(write_state(state, user))
            except PermissionError as exc:
                self.send_json({"error": str(exc)}, HTTPStatus.FORBIDDEN)
            except ValueError as exc:
                self.send_error(HTTPStatus.BAD_REQUEST, str(exc))
            return

        user_id = self.user_route(path)
        if user_id:
            user = self.require_user()
            if not user:
                return
            if user["role"] != "admin":
                self.send_json({"error": "需要管理员权限"}, HTTPStatus.FORBIDDEN)
                return
            try:
                body = self.read_json_body()
                with connect_db() as conn:
                    updated = update_user(conn, user, user_id, body)
                self.send_json({"user": updated})
            except sqlite3.IntegrityError:
                self.send_json({"error": "用户名已存在"}, HTTPStatus.CONFLICT)
            except LookupError as exc:
                self.send_json({"error": str(exc)}, HTTPStatus.NOT_FOUND)
            except PermissionError as exc:
                self.send_json({"error": str(exc)}, HTTPStatus.FORBIDDEN)
            except ValueError as exc:
                self.send_json({"error": str(exc)}, HTTPStatus.BAD_REQUEST)
            return

        endpoint, item_id = self.entity_route(path)
        if endpoint and item_id:
            self.handle_entity_write("PUT", endpoint, item_id)
            return
        principal_name = self.principal_identity_route(path)
        if principal_name:
            self.handle_principal_identity_save(principal_name)
            return
        sheet_id = self.quantity_sheet_route(path)
        if sheet_id:
            self.handle_quantity_sheet_save(sheet_id)
            return
        self.send_error(HTTPStatus.NOT_FOUND)

    def do_DELETE(self):
        path = urlparse(self.path).path
        user_id = self.user_route(path)
        if user_id:
            user = self.require_user()
            if not user:
                return
            if user["role"] != "admin":
                self.send_json({"error": "需要管理员权限"}, HTTPStatus.FORBIDDEN)
                return
            try:
                with connect_db() as conn:
                    delete_user(conn, user, user_id)
                self.send_json({"ok": True})
            except LookupError as exc:
                self.send_json({"error": str(exc)}, HTTPStatus.NOT_FOUND)
            except PermissionError as exc:
                self.send_json({"error": str(exc)}, HTTPStatus.FORBIDDEN)
            return

        endpoint, item_id = self.entity_route(path)
        if endpoint and item_id:
            self.handle_entity_write("DELETE", endpoint, item_id)
            return
        sheet_id = self.quantity_sheet_route(path)
        if sheet_id:
            self.handle_quantity_sheet_delete(sheet_id)
            return
        workflow_id = self.billing_workflow_route(path)
        if workflow_id:
            self.handle_billing_workflow_delete(workflow_id)
            return
        self.send_error(HTTPStatus.NOT_FOUND)

    def read_json_body(self):
        length = int(self.headers.get("Content-Length", "0"))
        if length <= 0:
            raise ValueError("Missing request body")
        if length > MAX_BODY_BYTES:
            raise ValueError("Request body is too large")
        raw = self.rfile.read(length)
        try:
            return json.loads(raw.decode("utf-8"))
        except json.JSONDecodeError as exc:
            raise ValueError("Invalid JSON body") from exc

    def read_raw_body(self):
        length = int(self.headers.get("Content-Length", "0"))
        if length <= 0:
            raise ValueError("Missing request body")
        if length > MAX_BODY_BYTES:
            raise ValueError("Request body is too large")
        return self.rfile.read(length)

    def read_optional_json_body(self):
        length = int(self.headers.get("Content-Length", "0"))
        if length <= 0:
            return {}
        if length > MAX_BODY_BYTES:
            raise ValueError("Request body is too large")
        raw = self.rfile.read(length)
        try:
            return json.loads(raw.decode("utf-8"))
        except json.JSONDecodeError as exc:
            raise ValueError("Invalid JSON body") from exc

    def send_json(self, payload, status=HTTPStatus.OK):
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def handle_login(self):
        try:
            body = self.read_json_body()
        except ValueError as exc:
            self.send_json({"error": str(exc)}, HTTPStatus.BAD_REQUEST)
            return
        username = str(body.get("username", "")).strip()
        password = str(body.get("password", ""))
        with connect_db() as conn:
            user = authenticate(conn, username, password)
            if not user:
                self.send_json({"error": "用户名或密码错误"}, HTTPStatus.UNAUTHORIZED)
                return
            token, expires_at = create_session(conn, user["id"])
            now = now_iso()
            event = audit_event(
                user,
                "auth.login",
                "session",
                user["id"],
                f"{user['displayName']} 登录系统",
                [],
                now,
                None,
                {
                    "username": user["username"],
                    "role": user["role"],
                    "clientIp": self.client_address[0] if self.client_address else "",
                    "userAgent": self.headers.get("User-Agent", ""),
                },
            )
            write_audit_events(conn, [event])
            conn.commit()
        self.send_response(HTTPStatus.OK)
        body_bytes = json.dumps({"user": user}, ensure_ascii=False).encode("utf-8")
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body_bytes)))
        self.send_header("Cache-Control", "no-store")
        self.send_header(
            "Set-Cookie",
            f"{SESSION_COOKIE}={token}; Path=/; HttpOnly; SameSite=Lax; Expires={format_http_date(expires_at)}",
        )
        self.end_headers()
        self.wfile.write(body_bytes)

    def handle_logout(self):
        token = self.session_token()
        with connect_db() as conn:
            delete_session(conn, token)
        self.send_response(HTTPStatus.OK)
        body = b'{"ok": true}'
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Set-Cookie", f"{SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0")
        self.end_headers()
        self.wfile.write(body)

    def handle_iacuc_upload(self):
        user = self.require_user()
        if not user:
            return
        if user["role"] != "admin":
            self.send_json({"error": "需要管理员权限"}, HTTPStatus.FORBIDDEN)
            return

        try:
            raw = self.read_raw_body()
            filename, file_body = parse_multipart_upload(self.headers.get("Content-Type", ""), raw)
            if filename and not filename.lower().endswith(".csv"):
                raise ValueError("目前只支持上传 CSV 文件")
            parsed = parse_iacuc_csv(file_body)
            now = now_iso()
            file_items = [application_payload(item, now) for item in parsed["items"]]
            save_iacuc_index_file(file_items)
            event = audit_event(
                user,
                "iacuc_index.uploaded",
                "iacuc_index",
                "iacuc-index",
                f"{user['displayName']} 上传 IACUC 索引 {len(parsed['items'])} 条",
                [],
                now,
                None,
                {"filename": filename, **parsed["summary"]},
            )
            with connect_db() as conn:
                write_experiment_applications(conn, parsed["items"], now)
                write_audit_events(conn, [event])
                conn.commit()
            self.send_json(
                {
                    "ok": True,
                    "filename": filename,
                    "updatedAt": now,
                    **parsed["summary"],
                    "items": file_items,
                    "auditLogs": merge_audit_logs([], [event]),
                }
            )
        except ValueError as exc:
            self.send_json({"error": str(exc)}, HTTPStatus.BAD_REQUEST)

    def handle_billing_statement_generate(self):
        user = self.require_user()
        if not user:
            return
        if user["role"] != "admin":
            self.send_json({"error": "需要管理员权限"}, HTTPStatus.FORBIDDEN)
            return
        try:
            body = self.read_json_body()
            with connect_db() as conn:
                statement, lines, audit_logs = generate_billing_statement(conn, body, user)
                conn.commit()
            self.send_json({"statement": statement, "lines": lines, "auditLogs": audit_logs}, HTTPStatus.CREATED)
        except ValueError as exc:
            self.send_json({"error": str(exc)}, HTTPStatus.BAD_REQUEST)

    def handle_billing_statement_generate_by_pi(self):
        user = self.require_user()
        if not user:
            return
        if user["role"] != "admin":
            self.send_json({"error": "需要管理员权限"}, HTTPStatus.FORBIDDEN)
            return
        try:
            body = self.read_json_body()
            with connect_db() as conn:
                statement, lines, audit_logs = generate_billing_statement_by_pi(conn, body, user)
                conn.commit()
            self.send_json({"statement": statement, "lines": lines, "auditLogs": audit_logs}, HTTPStatus.CREATED)
        except ValueError as exc:
            self.send_json({"error": str(exc)}, HTTPStatus.BAD_REQUEST)

    def handle_billing_workflow_advance(self):
        user = self.require_user()
        if not user:
            return
        if user["role"] != "admin":
            self.send_json({"error": "需要管理员权限"}, HTTPStatus.FORBIDDEN)
            return
        try:
            body = self.read_json_body()
            workflow_id = clean_text(body.get("workflowId", ""))
            to_status = clean_text(body.get("toStatus", ""))
            note = clean_text(body.get("note", ""))
            with connect_db() as conn:
                workflow, version, event = update_workflow_status(conn, workflow_id, to_status, user, note)
                audit = audit_event(
                    user,
                    f"billing_workflow.{to_status}",
                    "billing_workflow",
                    workflow_id,
                    f"{user['displayName']} 更新 {workflow.get('iacuc', '')} {workflow.get('month', '')} 结算流程状态",
                    [],
                    event["at"],
                    None,
                    {"workflow": workflow, "version": version, "event": event},
                )
                write_audit_events(conn, [audit])
                conn.commit()
            self.send_json({"workflow": workflow, "event": event, "auditLogs": merge_audit_logs([], [audit])})
        except LookupError as exc:
            self.send_json({"error": str(exc)}, HTTPStatus.NOT_FOUND)
        except ValueError as exc:
            self.send_json({"error": str(exc)}, HTTPStatus.BAD_REQUEST)

    def handle_billing_workflow_delete(self, workflow_id):
        user = self.require_user()
        if not user:
            return
        if user["role"] != "admin":
            self.send_json({"error": "需要管理员权限"}, HTTPStatus.FORBIDDEN)
            return
        try:
            with connect_db() as conn:
                workflow = delete_billing_workflow(conn, workflow_id)
                at = now_iso()
                audit = audit_event(
                    user,
                    "billing_workflow.deleted",
                    "billing_workflow",
                    workflow_id,
                    f"{user['displayName']} 删除 {workflow.get('pi') or workflow.get('iacuc', '')} {workflow.get('month', '')} 结算流程",
                    [],
                    at,
                    workflow,
                    None,
                )
                write_audit_events(conn, [audit])
                conn.commit()
            self.send_json({"ok": True, "workflow": workflow, "auditLogs": merge_audit_logs([], [audit])})
        except LookupError as exc:
            self.send_json({"error": str(exc)}, HTTPStatus.NOT_FOUND)

    def current_user(self):
        with connect_db() as conn:
            return user_from_token(conn, self.session_token())

    def require_user(self):
        user = self.current_user()
        if not user:
            self.send_json({"error": "请先登录"}, HTTPStatus.UNAUTHORIZED)
            return None
        return user

    def session_token(self):
        cookie = self.headers.get("Cookie", "")
        for part in cookie.split(";"):
            if "=" not in part:
                continue
            key, value = part.strip().split("=", 1)
            if key == SESSION_COOKIE:
                return value
        return ""

    def send_entity_list(self, table, actor):
        with connect_db() as conn:
            if table == "audit_events":
                rows = conn.execute("SELECT payload FROM audit_events ORDER BY at DESC, rowid DESC LIMIT 500").fetchall()
            else:
                rows = conn.execute(f"SELECT payload FROM {table} ORDER BY {ENTITY_ORDER_BY.get(table, 'rowid')}").fetchall()
        items = [json.loads(row["payload"]) for row in rows]
        collection = {
            "rooms": "rooms",
            "racks": "racks",
            "cage_slots": "slots",
            "occupancies": "occupancies",
        }.get(table)
        if collection:
            items = filter_entity_payloads_for_actor(collection, items, actor)
        self.send_json({"items": items})

    def entity_route(self, path):
        for endpoint in WRITABLE_ENTITY_ENDPOINTS:
            prefix = endpoint + "/"
            if path.startswith(prefix):
                item_id = unquote(path[len(prefix) :])
                if "/" not in item_id and item_id:
                    return endpoint, item_id
        return None, None

    def user_route(self, path):
        prefix = "/api/users/"
        if not path.startswith(prefix):
            return None
        user_id = unquote(path[len(prefix) :])
        if "/" in user_id or not user_id:
            return None
        return user_id

    def quantity_sheet_route(self, path):
        prefix = "/api/quantity-sheets/"
        if not path.startswith(prefix):
            return None
        sheet_id = unquote(path[len(prefix) :])
        if "/" in sheet_id or not sheet_id:
            return None
        return sheet_id

    def principal_identity_route(self, path):
        prefix = "/api/principal-identities/"
        if not path.startswith(prefix):
            return None
        pi_name = unquote(path[len(prefix) :])
        if "/" in pi_name or not pi_name:
            return None
        return pi_name

    def billing_workflow_route(self, path):
        prefix = "/api/billing-workflows/"
        if not path.startswith(prefix):
            return None
        workflow_id = unquote(path[len(prefix) :])
        if "/" in workflow_id or not workflow_id:
            return None
        return workflow_id

    def quantity_sheet_generate_route(self, path):
        prefix = "/api/quantity-sheets/"
        suffix = "/generate-statement"
        if not path.startswith(prefix) or not path.endswith(suffix):
            return None
        sheet_id = unquote(path[len(prefix) : -len(suffix)])
        if "/" in sheet_id or not sheet_id:
            return None
        return sheet_id

    def handle_entity_write(self, method, endpoint, item_id):
        user = self.require_user()
        if not user:
            return
        try:
            body = self.read_optional_json_body() if method == "DELETE" else self.read_json_body()
            payload, status = write_entity_state(endpoint, method, item_id, body, user)
            self.send_json(payload, status)
        except sqlite3.IntegrityError:
            self.send_json({"error": "实体 id 已存在"}, HTTPStatus.CONFLICT)
        except LookupError as exc:
            self.send_json({"error": str(exc)}, HTTPStatus.NOT_FOUND)
        except PermissionError as exc:
            self.send_json({"error": str(exc)}, HTTPStatus.FORBIDDEN)
        except ValueError as exc:
            self.send_json({"error": str(exc)}, HTTPStatus.BAD_REQUEST)

    def handle_infrastructure_write(self):
        user = self.require_user()
        if not user:
            return
        try:
            body = self.read_json_body()
            payload = write_infrastructure_state(body, user)
            self.send_json(payload, HTTPStatus.CREATED)
        except sqlite3.IntegrityError:
            self.send_json({"error": "实体 id 已存在"}, HTTPStatus.CONFLICT)
        except LookupError as exc:
            self.send_json({"error": str(exc)}, HTTPStatus.NOT_FOUND)
        except PermissionError as exc:
            self.send_json({"error": str(exc)}, HTTPStatus.FORBIDDEN)
        except ValueError as exc:
            self.send_json({"error": str(exc)}, HTTPStatus.BAD_REQUEST)

    def handle_quantity_sheet_save(self, sheet_id):
        user = self.require_user()
        if not user:
            return
        try:
            body = self.read_json_body()
            with connect_db() as conn:
                sheet, audit_logs, status = save_quantity_sheet(conn, body, user, sheet_id)
                conn.commit()
            self.send_json({"item": sheet, "auditLogs": audit_logs}, status)
        except sqlite3.IntegrityError:
            self.send_json({"error": "数量统计表 id 已存在"}, HTTPStatus.CONFLICT)
        except PermissionError as exc:
            self.send_json({"error": str(exc)}, HTTPStatus.FORBIDDEN)
        except ValueError as exc:
            self.send_json({"error": str(exc)}, HTTPStatus.BAD_REQUEST)

    def handle_principal_identity_save(self, pi_name):
        user = self.require_user()
        if not user:
            return
        if user["role"] != "admin":
            self.send_json({"error": "需要管理员权限"}, HTTPStatus.FORBIDDEN)
            return
        try:
            body = self.read_json_body()
            with connect_db() as conn:
                item, audit_logs = save_principal_identity(conn, body, user, pi_name)
                conn.commit()
            self.send_json({"item": item, "auditLogs": audit_logs})
        except ValueError as exc:
            self.send_json({"error": str(exc)}, HTTPStatus.BAD_REQUEST)

    def handle_quantity_sheet_delete(self, sheet_id):
        user = self.require_user()
        if not user:
            return
        try:
            with connect_db() as conn:
                audit_logs = delete_quantity_sheet(conn, user, sheet_id)
                conn.commit()
            self.send_json({"ok": True, "auditLogs": audit_logs})
        except LookupError as exc:
            self.send_json({"error": str(exc)}, HTTPStatus.NOT_FOUND)
        except PermissionError as exc:
            self.send_json({"error": str(exc)}, HTTPStatus.FORBIDDEN)

    def handle_quantity_sheet_statement_generate(self, sheet_id):
        user = self.require_user()
        if not user:
            return
        try:
            body = self.read_optional_json_body()
            with connect_db() as conn:
                statement, lines, audit_logs = generate_quantity_sheet_statement(conn, sheet_id, body, user)
                conn.commit()
            self.send_json({"statement": statement, "lines": lines, "auditLogs": audit_logs}, HTTPStatus.CREATED)
        except LookupError as exc:
            self.send_json({"error": str(exc)}, HTTPStatus.NOT_FOUND)
        except PermissionError as exc:
            self.send_json({"error": str(exc)}, HTTPStatus.FORBIDDEN)
        except ValueError as exc:
            self.send_json({"error": str(exc)}, HTTPStatus.BAD_REQUEST)


def main():
    connect_db().close()
    server = ThreadingHTTPServer((HOST, PORT), CageLedgerHandler)
    print(f"CageLedger server listening on http://{HOST}:{PORT}")
    print(f"SQLite database: {DB_PATH}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
