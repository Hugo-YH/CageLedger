import json

from server_app.repositories.entities import list_intake_batch_filter_options as intake_batch_filter_options
from server_app.repositories.entities import list_intake_batches_page

__all__ = ["intake_batch_filter_options", "list_intake_batches_page", "list_summary_batches"]


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
