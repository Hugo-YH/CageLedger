import re

from server_app.repositories.release_announcements import (
    has_release_announcement_acknowledgement,
    insert_release_announcement_acknowledgement,
    insert_release_announcement_acknowledgements,
    list_release_announcement_acknowledgements,
)
from server_app.shared import now_iso

RELEASE_VERSION_PATTERN = re.compile(r"[A-Za-z0-9][A-Za-z0-9._-]{0,63}")


def release_announcement_status(conn, user_id, version):
    return {
        "version": version,
        "acknowledged": has_release_announcement_acknowledgement(conn, user_id, version),
    }


def acknowledge_release_announcement(conn, user_id, version):
    insert_release_announcement_acknowledgement(conn, user_id, version, now_iso())
    conn.commit()
    return {"version": version, "acknowledged": True}


def release_announcement_acknowledgements(conn, user_id):
    return {"acknowledgedVersions": list_release_announcement_acknowledgements(conn, user_id)}


def acknowledge_release_announcements(conn, user_id, versions):
    if not isinstance(versions, list) or not versions:
        raise ValueError("versions 必须是非空数组")
    if len(versions) > 500:
        raise ValueError("versions 最多包含 500 个版本")
    if any(not isinstance(version, str) or not RELEASE_VERSION_PATTERN.fullmatch(version) for version in versions):
        raise ValueError("versions 包含格式不正确的版本")

    insert_release_announcement_acknowledgements(conn, user_id, dict.fromkeys(versions), now_iso())
    conn.commit()
    return release_announcement_acknowledgements(conn, user_id)
