"""Read-only interpretation of demand numbers; never generates or rewrites identifiers."""

import re
from datetime import date

from server_app.shared.intake_identifiers import intake_identifier_key

PATTERN = re.compile(r"[（(]\s*([A-Z]{1,6}\d{4,})\s*[)）]\s*(\d{4})(\d{2})(\d{2})(\d+)", re.IGNORECASE)


def parse_intake_batch_number(value):
    text = str(value or "").strip()
    result = {"status": "unparseable" if text else "missing", "iacuc": None, "approvalDate": None, "sequence": None}
    match = PATTERN.fullmatch(text)
    if not match:
        return result
    try:
        approval_date = date(int(match[2]), int(match[3]), int(match[4])).isoformat()
    except ValueError:
        return result
    return {"status": "parsed", "iacuc": match[1].upper(), "approvalDate": approval_date, "sequence": match[5]}


def sequence_key(value):
    text = str(value or "").strip()
    return text.lstrip("0") or "0" if re.fullmatch(r"[0-9]+", text) else None


def register_intake_number_functions(conn):
    # Connection-local pure functions: no DDL, backfill, writes or global business cache.
    def part(value, field):
        result = parse_intake_batch_number(value)
        return sequence_key(result["sequence"]) if field == "sequence" else result.get(field)

    conn.create_function("intake_number_part", 2, part, deterministic=True)
    conn.create_function(
        "intake_number_search", 1, lambda value: intake_identifier_key(value, batch=True), deterministic=True
    )


def intake_number_predicate(key, values):
    if key == "batchNumberSearch":
        return "(" + " OR ".join("instr(intake_number_search(batch_no), ?) > 0" for _ in values) + ")", [
            intake_identifier_key(value, batch=True) for value in values
        ]
    fields = {"batchNumberIacuc": "iacuc", "batchApprovalDate": "approvalDate", "batchSequence": "sequence"}
    field = fields.get(key)
    if field is None:
        return None
    normalized = [
        sequence_key(value) if field == "sequence" else value.upper() if field == "iacuc" else value for value in values
    ]
    return f"intake_number_part(batch_no, '{field}') IN ({','.join('?' for _ in values)})", normalized
