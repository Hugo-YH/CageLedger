"""Indexed members of one reservation's identifier group; no inferred pairings."""

from server_app.shared.intake_identifiers import intake_identifier_key, intake_identifier_members


def members_available(conn):
    return (
        conn.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name='intake_identifier_members'").fetchone()
        is not None
    )


def member_rows(batch):
    return [
        (batch["id"], kind, value, intake_identifier_key(value, batch=kind == "batchNo"))
        for kind, values in intake_identifier_members(batch).items()
        for value in values
    ]


def sync_members(conn, batch):
    if not members_available(conn):
        return
    desired = set(member_rows(batch))
    current = {
        tuple(row)
        for row in conn.execute(
            "SELECT batch_id,kind,value,value_key FROM intake_identifier_members WHERE batch_id=?", (batch["id"],)
        )
    }
    if desired == current:
        return
    conn.execute("DELETE FROM intake_identifier_members WHERE batch_id=?", (batch["id"],))
    conn.executemany(
        "INSERT INTO intake_identifier_members(batch_id,kind,value,value_key) VALUES(?,?,?,?)", sorted(desired)
    )


def member_filter(kind, values, *, alias="intake_batches"):
    keys = [intake_identifier_key(value, batch=kind == "batchNo") for value in values]
    return (
        f"EXISTS (SELECT 1 FROM intake_identifier_members im WHERE im.batch_id={alias}.id "
        f"AND im.kind=? AND im.value_key IN ({','.join('?' for _ in keys)}))",
        [kind, *keys],
    )
