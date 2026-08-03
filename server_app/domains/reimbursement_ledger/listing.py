"""List-time sorting and column filtering for the reimbursement ledger lists.

Column whitelists keep user-supplied sort keys and filter values mapped to
fixed SQL expressions; unknown keys fall back to the default ordering so the
API can never drive arbitrary SQL.
"""

from server_app.shared import clean_text

OBLIGATION_LIST_COLUMNS = {
    "month": {"expr": "month", "order": "month"},
    "sourcePi": {"expr": "source_pi", "order": "source_pi"},
    "iacuc": {"expr": "iacuc", "order": "iacuc"},
    "payableAmount": {"expr": "payable_amount", "order": "payable_amount"},
    "allocatedAmount": {"expr": "allocated_amount", "order": "allocated_amount"},
    "outstandingAmount": {"expr": "outstanding_amount", "order": "outstanding_amount"},
    "claimCount": {"expr": "claim_count", "order": "claim_count"},
    "status": {"expr": "status", "order": "status"},
}

CLAIM_LIST_COLUMNS = {
    "documentNumber": {"expr": "document_number", "order": "document_number"},
    "fundingOwner": {"expr": "funding_owner", "order": "funding_owner"},
    "fundingLineCount": {
        "expr": (
            "(SELECT COUNT(*) FROM reimbursement_claim_funding_lines fl WHERE fl.claim_id = reimbursement_claims.id)"
        ),
        "order": (
            "(SELECT COUNT(*) FROM reimbursement_claim_funding_lines fl WHERE fl.claim_id = reimbursement_claims.id)"
        ),
    },
    "totalAmount": {"expr": "total_amount", "order": "total_amount"},
    "allocatedAmount": {"expr": "allocated_amount", "order": "allocated_amount"},
    "unallocatedAmount": {"expr": "unallocated_amount", "order": "unallocated_amount"},
    "attachmentCount": {"expr": "attachment_count", "order": "attachment_count"},
    "status": {"expr": "status", "order": "status"},
}

LEGACY_LIST_COLUMNS = {
    "month": {"expr": "json_extract(payload, '$.month')", "order": "json_extract(payload, '$.month')"},
    "pi": {"expr": "json_extract(payload, '$.pi')", "order": "json_extract(payload, '$.pi')"},
    "reimbursementFormNo": {
        "expr": "json_extract(payload, '$.reimbursementFormNo')",
        "order": "json_extract(payload, '$.reimbursementFormNo')",
    },
    "fundBookNo": {"expr": "json_extract(payload, '$.fundBookNo')", "order": "json_extract(payload, '$.fundBookNo')"},
    "payableAmount": {
        "expr": "json_extract(payload, '$.payableAmount')",
        "order": "CAST(json_extract(payload, '$.payableAmount') AS REAL)",
    },
    "paidAmount": {
        "expr": "json_extract(payload, '$.paidAmount')",
        "order": "CAST(json_extract(payload, '$.paidAmount') AS REAL)",
    },
}


def list_sort_order(filters, columns, default):
    key = clean_text(filters.get("sortKey", ""))
    direction = "ASC" if clean_text(filters.get("sortDir", "")).lower() == "asc" else "DESC"
    spec = columns.get(key)
    if not spec:
        return default
    return f"{spec['order']} {direction}, rowid DESC"


def list_column_where(filters, columns, exclude_column=""):
    clauses, params = [], []
    for key, values in (filters.get("columnFilters") or {}).items():
        if key == exclude_column:
            continue
        spec = columns.get(key)
        cleaned = [clean_text(value) for value in values if clean_text(value)]
        if not spec or not cleaned:
            continue
        placeholders = ", ".join("?" for _ in cleaned)
        clauses.append(f"COALESCE({spec['expr']}, '') IN ({placeholders})")
        params.extend(cleaned)
    return clauses, params


def list_column_options(conn, table, columns, filters, column):
    spec = columns.get(column)
    if not spec:
        return {"items": []}
    clauses, params = list_column_where(filters, columns, exclude_column=column)
    where = f" WHERE {' AND '.join(clauses)}" if clauses else ""
    rows = conn.execute(
        f"""
        SELECT COALESCE({spec["expr"]}, '') AS value, COUNT(*) AS count
        FROM {table}{where}
        GROUP BY value
        ORDER BY value COLLATE NOCASE
        LIMIT 500
        """,
        params,
    ).fetchall()
    return {
        "items": [
            {"value": row["value"] or "", "label": row["value"] or "空白", "count": row["count"]}
            for row in rows
            if row["value"]
        ]
    }
