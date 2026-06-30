import base64
import hashlib
import hmac
import json
import secrets
from datetime import UTC, datetime, timedelta

from server_app.config import DEFAULT_ADMIN_PASSWORD, DEFAULT_ADMIN_USERNAME, SESSION_TTL_DAYS
from server_app.repositories.users import (
    delete_session_by_token_hash,
    get_active_user_by_username,
    get_user_by_session_token_hash,
    has_any_user,
    insert_session,
    insert_user,
)
from server_app.repositories.users import list_users as list_users_repository
from server_app.shared import new_id, now_iso


def ensure_default_admin(conn):
    if has_any_user(conn):
        return
    now = now_iso()
    insert_user(
        conn,
        {
            "id": new_id("user"),
            "username": DEFAULT_ADMIN_USERNAME,
            "display_name": "系统管理员",
            "password_hash": hash_password(DEFAULT_ADMIN_PASSWORD),
            "role": "admin",
            "room_ids": "[]",
            "active": 1,
            "created_at": now,
            "updated_at": now,
        },
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
    now = datetime.now(UTC)
    expires_at = now + timedelta(days=SESSION_TTL_DAYS)
    insert_session(conn, token_hash, user_id, now.isoformat(), expires_at.isoformat())
    conn.commit()
    return token, expires_at


def delete_session(conn, token):
    if not token:
        return
    delete_session_by_token_hash(conn, hash_token(token))
    conn.commit()


def hash_token(token):
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def user_from_token(conn, token):
    if not token:
        return None
    return get_user_by_session_token_hash(conn, hash_token(token), now_iso(), sanitize_user)


def authenticate(conn, username, password):
    row = get_active_user_by_username(conn, username)
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
    return list_users_repository(conn, sanitize_user)
