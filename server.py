#!/usr/bin/env python3
import base64
import hashlib
import hmac
import json
import os
import secrets
import sqlite3
from datetime import datetime, timedelta, timezone
from email.utils import format_datetime
from http import HTTPStatus
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse


ROOT = Path(__file__).resolve().parent
DB_PATH = Path(os.environ.get("CAGELEDGER_DB", ROOT / "data" / "cageledger.sqlite"))
HOST = os.environ.get("CAGELEDGER_HOST", "0.0.0.0")
PORT = int(os.environ.get("CAGELEDGER_PORT", "5173"))
MAX_BODY_BYTES = 10 * 1024 * 1024
SESSION_COOKIE = "cageledger_session"
SESSION_TTL_DAYS = 14
DEFAULT_ADMIN_USERNAME = os.environ.get("CAGELEDGER_ADMIN_USERNAME", "admin")
DEFAULT_ADMIN_PASSWORD = os.environ.get("CAGELEDGER_ADMIN_PASSWORD", "admin123")
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
    "/api/audit-events": "audit_events",
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
    conn.commit()
    ensure_default_admin(conn)


def read_state():
    with connect_db() as conn:
        migrate_legacy_state(conn)
        state = assemble_state(conn)
        updated_at = read_updated_at(conn)
    if not state:
        return {"state": None, "updatedAt": None}
    return {"state": state, "updatedAt": updated_at}


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


def validate_state_write_permission(conn, actor, old_state, new_state):
    if actor["role"] == "admin":
        return

    allowed_rooms = set(actor.get("roomIds", []))
    if not allowed_rooms:
        raise PermissionError("当前账号没有可编辑的饲养间")

    if comparable_items(old_state.get("rooms", [])) != comparable_items(new_state.get("rooms", [])):
        raise PermissionError("房间管理员不能修改饲养间配置")
    if comparable_items(old_state.get("racks", [])) != comparable_items(new_state.get("racks", [])):
        raise PermissionError("房间管理员不能修改笼架配置")
    if comparable_items(old_state.get("billingRules", [])) != comparable_items(new_state.get("billingRules", [])):
        raise PermissionError("房间管理员不能修改计费规则")
    if old_state.get("baseRate") != new_state.get("baseRate"):
        raise PermissionError("房间管理员不能修改基础费率")
    if comparable_items(old_state.get("adjustments", [])) != comparable_items(new_state.get("adjustments", [])):
        raise PermissionError("房间管理员不能修改减免规则")

    old_slots = {item.get("id"): item for item in old_state.get("slots", [])}
    new_slots = {item.get("id"): item for item in new_state.get("slots", [])}
    slot_rooms = slot_room_map(new_state)
    if set(old_slots) != set(new_slots):
        raise PermissionError("房间管理员不能新增或删除笼位")
    for slot_id, new_slot in new_slots.items():
        old_slot = dict(old_slots.get(slot_id, {}))
        comparable_old = {k: v for k, v in old_slot.items() if k != "status"}
        comparable_new = {k: v for k, v in new_slot.items() if k != "status"}
        if comparable_old != comparable_new:
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
        labels[slot.get("id")] = f"{room.get('name', '')}-{rack.get('index', '')}-{slot.get('code', '')}".strip("-")
    return labels


def new_id(prefix):
    return f"{prefix}-{secrets.token_hex(8)}"


def now_iso():
    return datetime.now(timezone.utc).isoformat()


def format_http_date(value):
    return format_datetime(value, usegmt=True)


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
        self.send_header("Access-Control-Allow-Methods", "GET, POST, PUT, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()

    def do_GET(self):
        path = urlparse(self.path).path
        if path == "/api/health":
            self.send_json({"ok": True, "database": str(DB_PATH)})
            return
        if path == "/api/auth/me":
            user = self.current_user()
            if not user:
                self.send_json({"user": None}, HTTPStatus.UNAUTHORIZED)
                return
            self.send_json({"user": user})
            return
        if path == "/api/state":
            if not self.require_user():
                return
            self.send_json(read_state())
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
        if path in ENTITY_ENDPOINTS:
            if not self.require_user():
                return
            self.send_entity_list(ENTITY_ENDPOINTS[path])
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
        self.send_error(HTTPStatus.NOT_FOUND)

    def do_PUT(self):
        path = urlparse(self.path).path
        if path != "/api/state":
            self.send_error(HTTPStatus.NOT_FOUND)
            return
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

    def send_entity_list(self, table):
        with connect_db() as conn:
            if table == "audit_events":
                rows = conn.execute("SELECT payload FROM audit_events ORDER BY at DESC, rowid DESC LIMIT 500").fetchall()
            else:
                rows = conn.execute(f"SELECT payload FROM {table} ORDER BY rowid").fetchall()
        self.send_json({"items": [json.loads(row["payload"]) for row in rows]})


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
