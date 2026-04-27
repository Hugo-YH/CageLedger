#!/usr/bin/env python3
import json
import os
import sqlite3
from datetime import datetime, timezone
from http import HTTPStatus
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse


ROOT = Path(__file__).resolve().parent
DB_PATH = Path(os.environ.get("CAGELEDGER_DB", ROOT / "data" / "cageledger.sqlite"))
HOST = os.environ.get("CAGELEDGER_HOST", "0.0.0.0")
PORT = int(os.environ.get("CAGELEDGER_PORT", "5173"))
MAX_BODY_BYTES = 10 * 1024 * 1024
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
            slot_id TEXT NOT NULL,
            cage_code TEXT,
            status TEXT NOT NULL,
            iacuc TEXT,
            project TEXT,
            pi TEXT,
            owner TEXT,
            start_date TEXT,
            end_date TEXT,
            end_reason TEXT,
            notes TEXT,
            updated_at TEXT,
            payload TEXT NOT NULL,
            FOREIGN KEY(slot_id) REFERENCES cage_slots(id) ON DELETE CASCADE
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
        CREATE TABLE IF NOT EXISTS audit_logs (
            id TEXT PRIMARY KEY,
            message TEXT,
            at TEXT,
            payload TEXT NOT NULL
        )
        """
    )
    conn.commit()


def read_state():
    with connect_db() as conn:
        migrate_legacy_state(conn)
        state = assemble_state(conn)
        updated_at = read_updated_at(conn)
    if not state:
        return {"state": None, "updatedAt": None}
    return {"state": state, "updatedAt": updated_at}


def write_state(state):
    updated_at = datetime.now(timezone.utc).isoformat()
    with connect_db() as conn:
        write_normalized_state(conn, state, updated_at)
        conn.commit()
    return {"ok": True, "updatedAt": updated_at}


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

    for occupancy in state.get("occupancies", []):
        conn.execute(
            """
            INSERT INTO occupancies (
                id, slot_id, cage_code, status, iacuc, project, pi, owner,
                start_date, end_date, end_reason, notes, updated_at, payload
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
    if not table_has_rows(conn, "rooms"):
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


class CageLedgerHandler(SimpleHTTPRequestHandler):
    server_version = "CageLedger/0.2"

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def end_headers(self):
        self.send_header("X-Content-Type-Options", "nosniff")
        super().end_headers()

    def do_OPTIONS(self):
        self.send_response(HTTPStatus.NO_CONTENT)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, PUT, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()

    def do_GET(self):
        path = urlparse(self.path).path
        if path == "/api/health":
            self.send_json({"ok": True, "database": str(DB_PATH)})
            return
        if path == "/api/state":
            self.send_json(read_state())
            return
        super().do_GET()

    def do_PUT(self):
        path = urlparse(self.path).path
        if path != "/api/state":
            self.send_error(HTTPStatus.NOT_FOUND)
            return

        try:
            body = self.read_json_body()
            state = body.get("state")
            if not isinstance(state, dict):
                self.send_error(HTTPStatus.BAD_REQUEST, "Request body must contain a state object")
                return
            self.send_json(write_state(state))
        except ValueError as exc:
            self.send_error(HTTPStatus.BAD_REQUEST, str(exc))

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

    def send_json(self, payload, status=HTTPStatus.OK):
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)


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
