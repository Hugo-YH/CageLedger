def has_release_announcement_acknowledgement(conn, user_id, version):
    return (
        conn.execute(
            """
            SELECT 1
            FROM release_announcement_acknowledgements
            WHERE user_id = ? AND version = ?
            """,
            (user_id, version),
        ).fetchone()
        is not None
    )


def insert_release_announcement_acknowledgement(conn, user_id, version, acknowledged_at):
    conn.execute(
        """
        INSERT OR IGNORE INTO release_announcement_acknowledgements (user_id, version, acknowledged_at)
        VALUES (?, ?, ?)
        """,
        (user_id, version, acknowledged_at),
    )
