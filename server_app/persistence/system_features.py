"""Independent display preferences, preserved by legacy full-state writes."""


def ensure_schema(conn):
    conn.execute("""CREATE TABLE IF NOT EXISTS system_feature_settings (
        id TEXT PRIMARY KEY CHECK(id = 'default'),
        enabled_json TEXT NOT NULL,
        updated_at TEXT NOT NULL
    )""")
