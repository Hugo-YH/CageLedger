import json

from server_app.repositories.payload import dump_json
from server_app.repositories.users import (
    delete_sessions_by_user_id,
    delete_user_by_id,
    get_user_by_id,
    insert_user,
    update_user_with_password,
    update_user_without_password,
)
from server_app.shared import new_id, now_iso

from .auth import hash_password, sanitize_user


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
    insert_user(
        conn,
        {
            "id": user_id,
            "username": username,
            "display_name": display_name,
            "password_hash": hash_password(password),
            "role": role,
            "room_ids": dump_json(room_ids),
            "active": 1,
            "created_at": now,
            "updated_at": now,
        },
    )
    conn.commit()
    row = get_user_by_id(conn, user_id)
    return sanitize_user(row)


def update_user(conn, actor, user_id, payload):
    if user_id == actor["id"]:
        raise PermissionError("不能在账号管理中修改当前登录账号")

    row = get_user_by_id(conn, user_id)
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
        update_user_with_password(
            conn, user_id, username, display_name, hash_password(password), role, dump_json(room_ids), now
        )
    else:
        update_user_without_password(conn, user_id, username, display_name, role, dump_json(room_ids), now)
    delete_sessions_by_user_id(conn, user_id)
    conn.commit()
    row = get_user_by_id(conn, user_id)
    return sanitize_user(row)


def delete_user(conn, actor, user_id):
    if user_id == actor["id"]:
        raise PermissionError("不能删除当前登录账号")

    row = get_user_by_id(conn, user_id)
    if not row:
        raise LookupError("账号不存在")

    delete_sessions_by_user_id(conn, user_id)
    delete_user_by_id(conn, user_id)
    conn.commit()
