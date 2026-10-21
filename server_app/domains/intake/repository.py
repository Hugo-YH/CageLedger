import json

from server_app.repositories.entities import list_intake_batch_filter_options as intake_batch_filter_options
from server_app.repositories.entities import list_intake_batches_page

__all__ = ["intake_batch_filter_options", "list_intake_batches_page", "list_summary_batches"]


def find_duplicate_identifiers(conn, purchase_order_key, batch_no_key, exclude_id=""):
    """Return all matching identities so confirmation also covers off-page matches."""
    clauses, params = [], []
    if purchase_order_key:
        clauses.append("purchase_order_key = ?")
        params.append(purchase_order_key)
    if batch_no_key:
        clauses.append("batch_no_key = ?")
        params.append(batch_no_key)
    if not clauses:
        return []
    rows = conn.execute(
        f"""SELECT id, purchase_order_no, batch_no, purchase_order_key, batch_no_key,
                   intake_date, pi, owner, status, updated_at
            FROM intake_batches
            WHERE ({" OR ".join(clauses)}) AND id <> ?
            ORDER BY intake_date DESC, id""",
        (*params, exclude_id),
    ).fetchall()
    return [dict(row) for row in rows]


def list_summary_batches(conn, start_date, end_date):
    """Read every scheduled batch in the inclusive interval, independent of pagination."""
    rows = conn.execute(
        """
        SELECT payload FROM intake_batches
        WHERE intake_date >= ? AND intake_date <= ?
        ORDER BY intake_date, room_name, batch_no, id
        """,
        (start_date, end_date),
    ).fetchall()
    return [json.loads(row["payload"]) for row in rows]
