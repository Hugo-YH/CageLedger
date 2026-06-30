import hashlib
import hmac
import secrets
from datetime import UTC, datetime, timedelta


def list_users(conn, sanitize_user):
    rows = conn.execute("SELECT * FROM users ORDER BY role, username").fetchall()
    return [sanitize_user(row) for row in rows]


def get_user_by_id(conn, user_id):
    return conn.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()


def get_active_user_by_username(conn, username):
    return conn.execute("SELECT * FROM users WHERE username = ? AND active = 1", (username,)).fetchone()


def has_any_user(conn):
    return conn.execute("SELECT 1 FROM users LIMIT 1").fetchone() is not None


def insert_user(conn, user):
    conn.execute(
        """
        INSERT INTO users (id, username, display_name, password_hash, role, room_ids, active, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            user["id"],
            user["username"],
            user["display_name"],
            user["password_hash"],
            user["role"],
            user["room_ids"],
            user["active"],
            user["created_at"],
            user["updated_at"],
        ),
    )


def update_user_with_password(conn, user_id, username, display_name, password_hash, role, room_ids, updated_at):
    conn.execute(
        """
        UPDATE users
        SET username = ?, display_name = ?, password_hash = ?, role = ?, room_ids = ?, updated_at = ?
        WHERE id = ?
        """,
        (username, display_name, password_hash, role, room_ids, updated_at, user_id),
    )


def update_user_without_password(conn, user_id, username, display_name, role, room_ids, updated_at):
    conn.execute(
        """
        UPDATE users
        SET username = ?, display_name = ?, role = ?, room_ids = ?, updated_at = ?
        WHERE id = ?
        """,
        (username, display_name, role, room_ids, updated_at, user_id),
    )


def delete_user_by_id(conn, user_id):
    conn.execute("DELETE FROM users WHERE id = ?", (user_id,))


def delete_sessions_by_user_id(conn, user_id):
    conn.execute("DELETE FROM sessions WHERE user_id = ?", (user_id,))


def insert_session(conn, token_hash, user_id, created_at, expires_at):
    conn.execute(
        """
        INSERT INTO sessions (token_hash, user_id, created_at, expires_at)
        VALUES (?, ?, ?, ?)
        """,
        (token_hash, user_id, created_at, expires_at),
    )


def delete_session_by_token_hash(conn, token_hash):
    conn.execute("DELETE FROM sessions WHERE token_hash = ?", (token_hash,))


def get_user_by_session_token_hash(conn, token_hash, now_iso, sanitize_user):
    row = conn.execute(
        """
        SELECT users.*
        FROM sessions
        JOIN users ON users.id = sessions.user_id
        WHERE sessions.token_hash = ? AND sessions.expires_at > ? AND users.active = 1
        """,
        (token_hash, now_iso),
    ).fetchone()
    return sanitize_user(row) if row else None


def hash_password(password):
    salt = secrets.token_bytes(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, 200_000)
    return "pbkdf2_sha256$200000$" + salt.hex() + "$" + digest.hex()


def verify_password(password, password_hash):
    try:
        algorithm, iterations, salt_hex, digest_hex = password_hash.split("$", 3)
        if algorithm != "pbkdf2_sha256":
            return False
        salt = bytes.fromhex(salt_hex)
        expected = bytes.fromhex(digest_hex)
        actual = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, int(iterations))
        return hmac.compare_digest(actual, expected)
    except Exception:
        return False


def hash_token(token):
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def create_session(conn, user_id, session_ttl_days):
    token = secrets.token_urlsafe(32)
    token_hash = hash_token(token)
    now = datetime.now(UTC)
    expires_at = now + timedelta(days=session_ttl_days)
    insert_session(conn, token_hash, user_id, now.isoformat(), expires_at.isoformat())
    conn.commit()
    return token, expires_at
