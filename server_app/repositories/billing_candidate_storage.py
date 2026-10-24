"""Candidate snapshot registry, writes and invalidation."""

import json

from .billing_candidate_groups import list_quantity_settlement_groups
from .billing_candidate_queries import list_billing_candidate_snapshot_keys


def sync_billing_candidate_snapshot_registry(conn, source_type, now):
    groups = list_quantity_settlement_groups(conn) if source_type == "quantity_sheet" else []
    current_by_key = {
        (item["month"], item["pi"]): item
        for item in list_billing_candidate_snapshot_keys(conn, source_type=source_type)
    }
    live_keys = set()
    for group in groups:
        month = group["month"]
        pi = group["pi"]
        live_keys.add((month, pi))
        snapshot = current_by_key.get((month, pi))
        if snapshot is None:
            upsert_billing_candidate_snapshot(
                conn,
                {
                    "month": month,
                    "pi": pi,
                    "sourceType": source_type,
                    "iacucs": group.get("iacucs", []),
                    "totalAmount": None,
                    "error": "",
                    "stale": True,
                    "updatedAt": now,
                    "sourceFingerprint": group.get("sourceFingerprint", ""),
                },
            )
            continue
        current_iacucs = list(snapshot.get("iacucs") or [])
        next_iacucs = list(group.get("iacucs") or [])
        next_fingerprint = group.get("sourceFingerprint", "")
        if current_iacucs != next_iacucs or snapshot.get("sourceFingerprint", "") != next_fingerprint:
            upsert_billing_candidate_snapshot(
                conn,
                {
                    "month": month,
                    "pi": pi,
                    "sourceType": source_type,
                    "iacucs": next_iacucs,
                    "totalAmount": None,
                    "error": "",
                    "stale": True,
                    "updatedAt": now,
                    "sourceFingerprint": next_fingerprint,
                },
            )
    delete_orphaned_billing_candidate_snapshots(conn, source_type, live_keys)


def candidate_snapshot_values(snapshot):
    iacucs = sorted({str(item).strip() for item in snapshot.get("iacucs", []) if str(item).strip()})
    return (
        snapshot["sourceType"],
        snapshot["month"],
        snapshot["pi"],
        json.dumps(iacucs, ensure_ascii=False),
        "、".join(iacucs),
        snapshot.get("totalAmount"),
        snapshot.get("error", ""),
        1 if snapshot.get("stale") else 0,
        snapshot["updatedAt"],
        snapshot.get("sourceFingerprint", ""),
    ), iacucs


def candidate_snapshot_upsert_sql(count=1):
    values = ",".join("(?, ?, ?, ?, ?, ?, ?, ?, ?, ?)" for _ in range(count))
    return f"""
        INSERT INTO billing_candidate_snapshots (
            source_type,
            month,
            pi,
            iacucs_json,
            iacucs_text,
            total_amount,
            error_message,
            is_stale,
            updated_at,
            source_fingerprint
        )
        VALUES {values}
        ON CONFLICT(source_type, month, pi) DO UPDATE SET
            iacucs_json = excluded.iacucs_json,
            iacucs_text = excluded.iacucs_text,
            total_amount = excluded.total_amount,
            error_message = excluded.error_message,
            is_stale = excluded.is_stale,
            updated_at = excluded.updated_at,
            source_fingerprint = excluded.source_fingerprint
        """


def upsert_billing_candidate_snapshot(conn, snapshot):
    values, iacucs = candidate_snapshot_values(snapshot)
    conn.execute(candidate_snapshot_upsert_sql(), values)
    conn.execute(
        "DELETE FROM billing_candidate_snapshot_iacucs WHERE source_type = ? AND month = ? AND pi = ?",
        (snapshot["sourceType"], snapshot["month"], snapshot["pi"]),
    )
    conn.executemany(
        """
        INSERT INTO billing_candidate_snapshot_iacucs (source_type, month, pi, iacuc)
        VALUES (?, ?, ?, ?)
        """,
        [(snapshot["sourceType"], snapshot["month"], snapshot["pi"], iacuc) for iacuc in iacucs],
    )


def delete_billing_candidate_snapshot(conn, month, pi, source_type):
    conn.execute(
        "DELETE FROM billing_candidate_snapshot_iacucs WHERE source_type = ? AND month = ? AND pi = ?",
        (source_type, month, pi),
    )
    conn.execute(
        "DELETE FROM billing_candidate_snapshots WHERE month = ? AND pi = ? AND source_type = ?",
        (month, pi, source_type),
    )


def billing_candidate_snapshot_registry_needs_sync(conn, source_type, fingerprint_fragment=""):
    row = conn.execute(
        "SELECT source_fingerprint FROM billing_candidate_snapshots WHERE source_type = ? LIMIT 1",
        (source_type,),
    ).fetchone()
    if row is None:
        return True
    if not fingerprint_fragment:
        return False
    return (
        conn.execute(
            """
            SELECT 1
            FROM billing_candidate_snapshots
            WHERE source_type = ? AND source_fingerprint NOT LIKE ?
            LIMIT 1
            """,
            (source_type, f"%{fingerprint_fragment}%"),
        ).fetchone()
        is not None
    )


def mark_billing_candidate_snapshots_stale(conn, source_type, keys, now):
    cleaned = sorted({(month, pi) for month, pi in keys if month and pi})
    if not cleaned:
        return
    placeholders = ", ".join("(?, ?)" for _ in cleaned)
    conn.execute(
        f"""
        UPDATE billing_candidate_snapshots
        SET total_amount = NULL,
            error_message = '',
            is_stale = 1,
            updated_at = ?
        WHERE source_type = ?
          AND (month, pi) IN ({placeholders})
        """,
        (now, source_type, *[value for pair in cleaned for value in pair]),
    )


def mark_billing_candidate_snapshots_stale_by_pi(conn, source_type, pi_name, now):
    if not pi_name:
        return
    conn.execute(
        """
        UPDATE billing_candidate_snapshots
        SET total_amount = NULL,
            error_message = '',
            is_stale = 1,
            updated_at = ?
        WHERE source_type = ? AND pi = ?
        """,
        (now, source_type, pi_name),
    )


def mark_all_billing_candidate_snapshots_stale(conn, source_type, now):
    conn.execute(
        """
        UPDATE billing_candidate_snapshots
        SET total_amount = NULL,
            error_message = '',
            is_stale = 1,
            updated_at = ?
        WHERE source_type = ?
        """,
        (now, source_type),
    )


def delete_orphaned_billing_candidate_snapshots(conn, source_type, live_keys):
    live_keys = sorted(live_keys)
    if not live_keys:
        conn.execute("DELETE FROM billing_candidate_snapshots WHERE source_type = ?", (source_type,))
        return
    placeholders = ", ".join("(?, ?)" for _ in live_keys)
    conn.execute(
        f"""
        DELETE FROM billing_candidate_snapshots
        WHERE source_type = ?
          AND (month, pi) NOT IN ({placeholders})
        """,
        (source_type, *[value for pair in live_keys for value in pair]),
    )
