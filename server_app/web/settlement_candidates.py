"""Read-only shared settlement list HTTP boundary."""

from urllib.parse import parse_qs, urlparse

from server_app.db import connect_db
from server_app.domains.billing.candidate_calculation import CandidateCalculation
from server_app.domains.billing.unified_candidates import COLUMNS, filter_options, list_candidates
from server_app.domains.technical_services.listing import columns
from server_app.web.ports import app_ports


def handle(handler, method, path):
    if method != "GET" or path not in ("/api/settlement-candidates", "/api/settlement-candidates/filter-options"):
        return False
    actor = handler.require_user()
    if not actor:
        return True
    try:
        filters = handler.list_filters(default_limit=10, max_limit=100)
        query = parse_qs(urlparse(handler.path).query)
        raw = query.get("columnFilters", [""])[0]
        if raw:
            filters["columnFilters"] = columns({"columnFilters": raw}, COLUMNS)
        with connect_db() as conn:

            def calculate(month, pi):
                return app_ports().generate_billing_statement_by_pi(
                    conn, {"month": month, "pi": pi, "sourceType": "quantity_sheet"}, actor
                )[0]

            calculation = CandidateCalculation(conn, calculate)
            if path.endswith("filter-options"):
                column = parse_qs(urlparse(handler.path).query).get("column", [""])[0]
                result = filter_options(
                    conn, actor, filters, column, calculation, prepare_calculations=calculation.prepare
                )
            else:
                result = list_candidates(conn, actor, filters, calculation, prepare_calculations=calculation.prepare)
        handler.send_json(result)
    except (ValueError, TypeError) as exc:
        handler.send_json({"error": str(exc)}, 400)
    except PermissionError as exc:
        handler.send_json({"error": str(exc)}, 403)
    return True
