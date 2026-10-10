"""Authenticated read-only reception-note download."""

from urllib.parse import parse_qs, urlparse

from server_app.db import connect_db
from server_app.domains.intake import summary


def handle(handler, path):
    if path != "/api/intake-batches/summary.docx":
        return False
    # Same read access as the intake list; exporting never advances receipt/print status.
    if not handler.require_user():
        return True
    params = parse_qs(urlparse(handler.path).query)
    start_date, end_date = params.get("startDate", [""])[0], params.get("endDate", [""])[0]
    try:
        summary.validate_interval(start_date, end_date)
        with connect_db() as conn:
            document = summary.snapshot(conn, start_date, end_date)
        handler.send_download(summary.generate(document), f"接收汇总_{start_date}_{end_date}.docx", summary.DOCX_MIME)
    except ValueError as exc:
        handler.send_json({"error": str(exc)}, 400)
    return True
