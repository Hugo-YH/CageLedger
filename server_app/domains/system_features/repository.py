"""Read and replace one display configuration without touching business tables."""

import json


def read(conn):
    return conn.execute("SELECT enabled_json,updated_at FROM system_feature_settings WHERE id='default'").fetchone()


def put(conn, enabled, updated_at):
    conn.execute(
        """INSERT INTO system_feature_settings(id,enabled_json,updated_at) VALUES('default',?,?)
           ON CONFLICT(id) DO UPDATE SET enabled_json=excluded.enabled_json,updated_at=excluded.updated_at""",
        (json.dumps(enabled, ensure_ascii=False, separators=(",", ":")), updated_at),
    )
