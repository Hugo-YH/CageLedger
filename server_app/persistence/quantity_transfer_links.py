"""Add a rebuildable transfer index; do not alter historical sheets."""


def ensure_schema(conn):
    if not conn.in_transaction:
        conn.execute("BEGIN IMMEDIATE")
    existed = conn.execute(
        "SELECT 1 FROM sqlite_master WHERE type='table' AND name='quantity_sheet_transfer_links'"
    ).fetchone()
    conn.execute("""CREATE TABLE IF NOT EXISTS quantity_sheet_transfer_links (
        target_sheet_id TEXT NOT NULL, target_row_id TEXT NOT NULL, link_key TEXT NOT NULL,
        source_sheet_id TEXT NOT NULL, source_row_id TEXT NOT NULL, direction TEXT NOT NULL, quantity INTEGER NOT NULL,
        PRIMARY KEY(target_sheet_id,target_row_id,link_key),
        FOREIGN KEY(target_sheet_id) REFERENCES quantity_sheets(id) ON DELETE CASCADE)""")
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_quantity_transfer_source ON quantity_sheet_transfer_links(source_sheet_id,target_sheet_id)"
    )
    conn.execute("""CREATE TABLE IF NOT EXISTS quantity_sheet_transfer_dirty (
        sheet_id TEXT PRIMARY KEY, FOREIGN KEY(sheet_id) REFERENCES quantity_sheets(id) ON DELETE CASCADE)""")
    for kind, event in (("insert", "INSERT"), ("update", "UPDATE OF payload")):
        conn.execute(f"""CREATE TRIGGER IF NOT EXISTS quantity_transfer_{kind} AFTER {event} ON quantity_sheets
            BEGIN INSERT OR IGNORE INTO quantity_sheet_transfer_dirty(sheet_id) VALUES (NEW.id); END""")
    conn.execute("""CREATE TRIGGER IF NOT EXISTS quantity_transfer_delete AFTER DELETE ON quantity_sheets
        BEGIN DELETE FROM quantity_sheet_transfer_links WHERE target_sheet_id=OLD.id;
        DELETE FROM quantity_sheet_transfer_dirty WHERE sheet_id=OLD.id; END""")
    if not existed:
        conn.execute("INSERT OR IGNORE INTO quantity_sheet_transfer_dirty(sheet_id) SELECT id FROM quantity_sheets")
