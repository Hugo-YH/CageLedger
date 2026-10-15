"""Create audit payload storage without rewriting historical records."""


def ensure_schema(conn):
    conn.execute("""CREATE TABLE IF NOT EXISTS audit_event_payload_blocks (
        event_id TEXT PRIMARY KEY, codec TEXT NOT NULL, raw_bytes INTEGER NOT NULL,
        raw_sha256 TEXT NOT NULL, payload BLOB NOT NULL,
        FOREIGN KEY(event_id) REFERENCES audit_events(id) ON DELETE CASCADE)""")
    # Keep derived blocks in sync for older yuan/JSON writers and FK-off tools.
    conn.execute("""CREATE TRIGGER IF NOT EXISTS audit_payload_deleted AFTER DELETE ON audit_events
        BEGIN DELETE FROM audit_event_payload_blocks WHERE event_id=OLD.id; END""")
    conn.execute("""CREATE TRIGGER IF NOT EXISTS audit_payload_replaced AFTER UPDATE OF payload ON audit_events
        BEGIN DELETE FROM audit_event_payload_blocks WHERE event_id=OLD.id; END""")
