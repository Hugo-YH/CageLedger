"""Add non-unique lookup columns without modifying legacy payloads or versions."""

import json

from server_app.shared.concurrency import begin_write
from server_app.shared.intake_identifiers import intake_identifier_values


def ensure_intake_identifier_schema(conn):
    # DDL must roll back with the backfill; SQLite otherwise commits ALTER TABLE
    # before the first UPDATE starts an implicit transaction. Caller owns commit.
    begin_write(conn)
    columns = {row[1] for row in conn.execute("PRAGMA table_info(intake_batches)")}
    changed = False
    for name in ("purchase_order_no", "purchase_order_key", "batch_no_key"):
        if name not in columns:
            conn.execute(f"ALTER TABLE intake_batches ADD COLUMN {name} TEXT NOT NULL DEFAULT ''")
            changed = True
    if changed:
        for row in conn.execute("SELECT id, batch_no, payload FROM intake_batches").fetchall():
            batch = json.loads(row["payload"])
            values = intake_identifier_values({**batch, "batchNo": row["batch_no"]})
            conn.execute(
                "UPDATE intake_batches SET purchase_order_no=?, purchase_order_key=?, batch_no_key=? WHERE id=?",
                (*values, row["id"]),
            )
    conn.execute("CREATE INDEX IF NOT EXISTS idx_intake_purchase_order_key ON intake_batches(purchase_order_key)")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_intake_batch_no_key ON intake_batches(batch_no_key)")
