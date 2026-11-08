"""Request-local application selection, without publishing transaction-local data."""

from server_app.domains.iacuc.rules import normalize_iacuc_number
from server_app.repositories.payload_projection import payloads_by_rowids, projected_rows


def applications_for_iacucs(conn, iacucs):
    wanted = {normalize_iacuc_number(value) for value in iacucs}
    wanted.discard("")
    if not wanted:
        return {}
    selected = {}
    for rowid, item in projected_rows(conn, "experiment_applications", ("iacuc",)):
        code = normalize_iacuc_number(item.get("iacuc", ""))
        if code in wanted and code not in selected:
            selected[code] = rowid
            if selected.keys() >= wanted:
                break
    rows = payloads_by_rowids(conn, "experiment_applications", list(selected.values()))
    return {normalize_iacuc_number(item.get("iacuc", "")): item for item in rows}
