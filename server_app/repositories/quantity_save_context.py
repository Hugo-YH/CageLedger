"""Small transaction-local projections for quantity validation and transfer setup."""

import json

from server_app.domains.iacuc.rules import normalize_iacuc_number
from server_app.shared import clean_text


def read_validation_sheets(conn, month, pi):
    rows = conn.execute(
        """SELECT json_extract(payload,'$.id') AS id,
            json_extract(payload,'$.iacuc') AS iacuc,
            json_extract(payload,'$.preferredFreeCages') AS preferredFreeCages,
            json_extract(payload,'$.tierCagePriority') AS tierCagePriority
            FROM quantity_sheets WHERE month=? AND pi=?""",
        (month, pi),
    )
    return [dict(row) for row in rows]


def read_principal_types(conn, pi):
    # Preserve the legacy cleaned-name mapping's last-row-wins behavior.
    rows = conn.execute(
        "SELECT pi,principal_type FROM principal_identities WHERE TRIM(COALESCE(pi,''))!='' ORDER BY rowid"
    )
    return {clean_text(row[0]): row[1] for row in rows if clean_text(row[0]) == pi}


def read_transfer_applications(conn, iacucs):
    """Decode only missing targets, preserving the first normalized payload match.

    Legacy scalar numbers can differ from the payload. Read their small number
    projection in insertion order rather than silently changing that precedence.
    """
    wanted = {normalize_iacuc_number(code) for code in iacucs} - {""}
    result = {}
    if wanted:
        for row in conn.execute(
            "SELECT id,json_extract(payload,'$.iacuc') FROM experiment_applications ORDER BY rowid"
        ):
            code = normalize_iacuc_number(row[1])
            if code in wanted and code not in result:
                payload = conn.execute("SELECT payload FROM experiment_applications WHERE id=?", (row[0],)).fetchone()
                result[code] = json.loads(payload[0])
                if result.keys() >= wanted:
                    break
    return result
