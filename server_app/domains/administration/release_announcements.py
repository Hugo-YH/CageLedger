from server_app.repositories.release_announcements import (
    has_release_announcement_acknowledgement,
    insert_release_announcement_acknowledgement,
)
from server_app.shared import now_iso


def release_announcement_status(conn, user_id, version):
    return {
        "version": version,
        "acknowledged": has_release_announcement_acknowledgement(conn, user_id, version),
    }


def acknowledge_release_announcement(conn, user_id, version):
    insert_release_announcement_acknowledgement(conn, user_id, version, now_iso())
    conn.commit()
    return {"version": version, "acknowledged": True}
