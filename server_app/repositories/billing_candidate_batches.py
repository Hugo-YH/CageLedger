"""Bounded candidate I/O using the same rows and serialization as single-key reads."""

from .billing_candidates import (
    candidate_snapshot_upsert_sql,
    candidate_snapshot_values,
    quantity_settlement_group_from_rows,
)


def quantity_settlement_groups_many(conn, keys):
    keys = list(dict.fromkeys(keys))
    result = {}
    for offset in range(0, len(keys), 200):
        batch = keys[offset : offset + 200]
        marks = ",".join("(?,?)" for _ in batch)
        rows_by_key = {}
        for row in conn.execute(
            f"""WITH requested(month,pi) AS (VALUES {marks})
                SELECT q.month,q.pi,q.iacuc,q.id,q.updated_at FROM requested
                JOIN quantity_sheets q ON q.month=requested.month AND q.pi=requested.pi
                ORDER BY q.month,q.pi,q.iacuc COLLATE NOCASE,q.id COLLATE NOCASE""",
            [value for key in batch for value in key],
        ):
            rows_by_key.setdefault((row["month"], row["pi"]), []).append(row)
        result.update({key: quantity_settlement_group_from_rows(*key, rows) for key, rows in rows_by_key.items()})
    return result


def upsert_candidate_snapshots_many(conn, snapshots):
    # Last value wins as with sequential upserts; stay below old SQLite's 999 parameters.
    snapshots = list({(s["sourceType"], s["month"], s["pi"]): s for s in snapshots}.values())
    for offset in range(0, len(snapshots), 50):
        batch = snapshots[offset : offset + 50]
        rows = [candidate_snapshot_values(snapshot) for snapshot in batch]
        conn.execute(candidate_snapshot_upsert_sql(len(batch)), [value for values, _ in rows for value in values])
        keys = [(s["sourceType"], s["month"], s["pi"]) for s in batch]
        marks = ",".join("(?,?,?)" for _ in keys)
        conn.execute(
            f"DELETE FROM billing_candidate_snapshot_iacucs WHERE (source_type,month,pi) IN ({marks})",
            [value for key in keys for value in key],
        )
        relations = [(*key, iacuc) for key, (_, iacucs) in zip(keys, rows, strict=True) for iacuc in iacucs]
        for index in range(0, len(relations), 200):
            part = relations[index : index + 200]
            conn.execute(
                "INSERT INTO billing_candidate_snapshot_iacucs (source_type,month,pi,iacuc) VALUES "
                + ",".join("(?,?,?,?)" for _ in part),
                [value for row in part for value in row],
            )
