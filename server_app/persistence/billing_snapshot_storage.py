"""Additive storage for lossless, version-scoped bill detail blocks."""


def ensure_schema(conn):
    conn.execute("""CREATE TABLE IF NOT EXISTS billing_statement_line_blocks (
        version_id TEXT PRIMARY KEY REFERENCES billing_statement_versions(id) ON DELETE CASCADE,
        codec TEXT NOT NULL,
        raw_bytes INTEGER NOT NULL CHECK(raw_bytes >= 0),
        raw_sha256 TEXT NOT NULL,
        line_count INTEGER NOT NULL CHECK(line_count >= 0),
        payload BLOB NOT NULL
    )""")
