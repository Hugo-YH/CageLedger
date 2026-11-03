import json

from server_app.repositories.entities import list_intake_batch_filter_options as intake_batch_filter_options
from server_app.repositories.entities import list_intake_batches_page
from server_app.repositories.intake_identifiers import members_available
from server_app.shared.intake_identifiers import intake_identifier_member_keys

__all__ = ["intake_batch_filter_options", "list_intake_batches_page", "list_summary_batches"]


def get_batch_payload(conn, batch_id):
    row = conn.execute("SELECT payload FROM intake_batches WHERE id=?", (batch_id,)).fetchone()
    return json.loads(row["payload"]) if row else None


def find_duplicate_identifiers(
    conn, purchase_order_key, batch_no_key, exclude_id="", *, order_no_key="", member_keys=None
):
    """Return all matching identities so confirmation also covers off-page matches."""
    clauses, params = [], []
    if purchase_order_key:
        clauses.append("purchase_order_key = ?")
        params.append(purchase_order_key)
    if order_no_key:
        clauses.append("order_key = ?")
        params.append(order_no_key)
    if batch_no_key:
        clauses.append("batch_no_key = ?")
        params.append(batch_no_key)
    keys = member_keys or {
        "purchaseOrderNo": [purchase_order_key] if purchase_order_key else [],
        "orderNo": [order_no_key] if order_no_key else [],
        "batchNo": [batch_no_key] if batch_no_key else [],
    }
    if members_available(conn):
        member_clauses, member_params = [], []
        for kind, values in keys.items():
            if values:
                member_clauses.append(f"(kind=? AND value_key IN ({','.join('?' for _ in values)}))")
                member_params.extend([kind, *values])
        if member_clauses:
            clauses.append(
                f"id IN (SELECT batch_id FROM intake_identifier_members WHERE {' OR '.join(member_clauses)})"
            )
            params.extend(member_params)
    if not clauses:
        return []
    rows = conn.execute(
        f"""SELECT id, purchase_order_no, order_no, batch_no, purchase_order_key, order_key, batch_no_key,
                   intake_date, pi, owner, status, updated_at
            FROM intake_batches
            WHERE ({" OR ".join(clauses)}) AND id <> ?
            ORDER BY intake_date DESC, id""",
        (*params, exclude_id),
    ).fetchall()
    result = [dict(row) for row in rows]
    # One bounded member query for the full result, never one query per record.
    matched = {}
    if result and members_available(conn):
        for kind, values in keys.items():
            if not values:
                continue
            for row in conn.execute(
                f"SELECT batch_id FROM intake_identifier_members WHERE kind=? AND value_key IN ({','.join('?' for _ in values)})",
                [kind, *values],
            ):
                matched.setdefault(row["batch_id"], set()).add(kind)
    for row in result:
        old = intake_identifier_member_keys(
            {"purchaseOrderNo": row["purchase_order_no"], "orderNo": row["order_no"], "batchNo": row["batch_no"]}
        )
        fields = matched.get(row["id"], set()) | {kind for kind, values in keys.items() if set(values) & set(old[kind])}
        row["matchedFields"] = [kind for kind in keys if kind in fields]
    return result


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
