import json

from server_app.cache import cache_get, cache_key, cache_set

from .payload import dump_json


REIMBURSEMENT_LIST_FIELDS = (
    "id",
    "businessKey",
    "month",
    "pi",
    "workflowId",
    "workflowStatus",
    "reimbursementStatus",
    "currentMonthAmount",
    "supportAmount",
    "payableAmount",
    "paidAmount",
    "unpaidAmount",
    "accumulatedPayable",
    "accumulatedPaid",
    "accumulatedUnpaid",
    "fundBookNo",
    "reimbursementFormNo",
    "approvedBudget",
    "source",
    "latestEventAt",
    "generatedAt",
    "updatedAt",
    "iacucs",
)


def reimbursement_record_list_item(payload):
    return {key: payload.get(key, [] if key == "iacucs" else "") for key in REIMBURSEMENT_LIST_FIELDS}


def list_reimbursement_records_page(conn, filters, clean_text):
    clauses = []
    params = []
    month = clean_text(filters.get("month", ""))
    if month:
        clauses.append("month = ?")
        params.append(month)
    status = clean_text(filters.get("status", ""))
    if status and status != "all":
        clauses.append("reimbursement_status = ?")
        params.append(status)
    pi = clean_text(filters.get("pi", ""))
    if pi:
        clauses.append("pi LIKE ?")
        params.append(f"%{pi}%")
    if clean_text(filters.get("onlyUnpaid", "")) in ("1", "true", "yes", "on"):
        clauses.append("accumulated_unpaid > 0")
    where = " AND ".join(clauses)
    key = cache_key(
        "reimbursement_records",
        limit=filters["limit"],
        offset=filters["offset"],
        month=month,
        status=status,
        pi=pi,
        only_unpaid=clean_text(filters.get("onlyUnpaid", "")),
    )
    cached = cache_get(key)
    if cached is not None:
        return cached
    where_clause = f" WHERE {where}" if where else ""
    total = conn.execute(f"SELECT COUNT(*) AS total FROM reimbursement_records{where_clause}", tuple(params)).fetchone()["total"]
    rows = conn.execute(
        f"""
        SELECT
            id,
            business_key,
            month,
            pi,
            workflow_id,
            workflow_status,
            reimbursement_status,
            current_month_amount,
            support_amount,
            payable_amount,
            paid_amount,
            unpaid_amount,
            accumulated_payable,
            accumulated_paid,
            accumulated_unpaid,
            source,
            latest_event_at,
            updated_at,
            json_extract(payload, '$.fundBookNo') AS fund_book_no,
            json_extract(payload, '$.reimbursementFormNo') AS reimbursement_form_no,
            json_extract(payload, '$.approvedBudget') AS approved_budget,
            json_extract(payload, '$.generatedAt') AS generated_at,
            json_extract(payload, '$.iacucs') AS iacucs_json
        FROM reimbursement_records{where_clause}
        ORDER BY month DESC, latest_event_at DESC, rowid DESC
        LIMIT ? OFFSET ?
        """,
        (*params, filters["limit"], filters["offset"]),
    ).fetchall()
    payload = {
        "items": [reimbursement_record_list_row(row) for row in rows],
        "page": {
            "limit": filters["limit"],
            "offset": filters["offset"],
            "total": total,
            "hasMore": filters["offset"] + filters["limit"] < total,
        },
    }
    return cache_set(key, payload)


def reimbursement_record_list_row(row):
    return {
        "id": row["id"] or "",
        "businessKey": row["business_key"] or "",
        "month": row["month"] or "",
        "pi": row["pi"] or "",
        "workflowId": row["workflow_id"] or "",
        "workflowStatus": row["workflow_status"] or "",
        "reimbursementStatus": row["reimbursement_status"] or "",
        "currentMonthAmount": row["current_month_amount"] or 0,
        "supportAmount": row["support_amount"] or 0,
        "payableAmount": row["payable_amount"] or 0,
        "paidAmount": row["paid_amount"] or 0,
        "unpaidAmount": row["unpaid_amount"] or 0,
        "accumulatedPayable": row["accumulated_payable"] or 0,
        "accumulatedPaid": row["accumulated_paid"] or 0,
        "accumulatedUnpaid": row["accumulated_unpaid"] or 0,
        "fundBookNo": row["fund_book_no"] or "",
        "reimbursementFormNo": row["reimbursement_form_no"] or "",
        "approvedBudget": row["approved_budget"] or "",
        "source": row["source"] or "",
        "latestEventAt": row["latest_event_at"] or "",
        "generatedAt": row["generated_at"] or "",
        "updatedAt": row["updated_at"] or "",
        "iacucs": _load_json_array(row["iacucs_json"]),
    }


def get_reimbursement_record(conn, record_id):
    row = conn.execute("SELECT payload FROM reimbursement_records WHERE id = ?", (record_id,)).fetchone()
    return json.loads(row["payload"]) if row else None


def get_reimbursement_record_by_key(conn, business_key):
    row = conn.execute("SELECT payload FROM reimbursement_records WHERE business_key = ?", (business_key,)).fetchone()
    return json.loads(row["payload"]) if row else None


def get_reimbursement_record_by_workflow_id(conn, workflow_id):
    row = conn.execute("SELECT payload FROM reimbursement_records WHERE workflow_id = ?", (workflow_id,)).fetchone()
    return json.loads(row["payload"]) if row else None


def list_reimbursement_records_for_pi(conn, pi_name):
    rows = conn.execute(
        "SELECT payload FROM reimbursement_records WHERE pi = ? ORDER BY month DESC, latest_event_at DESC, rowid DESC",
        (pi_name,),
    ).fetchall()
    return [json.loads(row["payload"]) for row in rows]


def list_reimbursement_record_summaries_for_pi(conn, pi_name):
    normalized_pi = str(pi_name or "").strip()
    key = cache_key("reimbursement_records::history", pi=normalized_pi)
    cached = cache_get(key)
    if cached is not None:
        return cached
    rows = conn.execute(
        """
        SELECT
            id,
            business_key,
            month,
            pi,
            workflow_id,
            workflow_status,
            reimbursement_status,
            current_month_amount,
            support_amount,
            payable_amount,
            paid_amount,
            unpaid_amount,
            accumulated_payable,
            accumulated_paid,
            accumulated_unpaid,
            source,
            latest_event_at,
            updated_at,
            json_extract(payload, '$.fundBookNo') AS fund_book_no,
            json_extract(payload, '$.reimbursementFormNo') AS reimbursement_form_no,
            json_extract(payload, '$.approvedBudget') AS approved_budget,
            json_extract(payload, '$.generatedAt') AS generated_at,
            json_extract(payload, '$.iacucs') AS iacucs_json
        FROM reimbursement_records
        WHERE pi = ?
        ORDER BY month DESC, latest_event_at DESC, rowid DESC
        """,
        (normalized_pi,),
    ).fetchall()
    return cache_set(key, [reimbursement_record_list_row(row) for row in rows])


def upsert_reimbursement_record(conn, payload):
    conn.execute(
        """
        INSERT INTO reimbursement_records (
            id, business_key, month, pi, workflow_id, workflow_status, reimbursement_status,
            current_month_amount, support_amount, payable_amount, paid_amount, unpaid_amount,
            accumulated_payable, accumulated_paid, accumulated_unpaid, source, latest_event_at, updated_at, payload
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(business_key) DO UPDATE SET
            month = excluded.month,
            pi = excluded.pi,
            workflow_id = excluded.workflow_id,
            workflow_status = excluded.workflow_status,
            reimbursement_status = excluded.reimbursement_status,
            current_month_amount = excluded.current_month_amount,
            support_amount = excluded.support_amount,
            payable_amount = excluded.payable_amount,
            paid_amount = excluded.paid_amount,
            unpaid_amount = excluded.unpaid_amount,
            accumulated_payable = excluded.accumulated_payable,
            accumulated_paid = excluded.accumulated_paid,
            accumulated_unpaid = excluded.accumulated_unpaid,
            source = excluded.source,
            latest_event_at = excluded.latest_event_at,
            updated_at = excluded.updated_at,
            payload = excluded.payload
        """,
        (
            payload["id"],
            payload["businessKey"],
            payload.get("month", ""),
            payload.get("pi", ""),
            payload.get("workflowId", ""),
            payload.get("workflowStatus", ""),
            payload.get("reimbursementStatus", ""),
            payload.get("currentMonthAmount", 0),
            payload.get("supportAmount", 0),
            payload.get("payableAmount", 0),
            payload.get("paidAmount", 0),
            payload.get("unpaidAmount", 0),
            payload.get("accumulatedPayable", 0),
            payload.get("accumulatedPaid", 0),
            payload.get("accumulatedUnpaid", 0),
            payload.get("source", ""),
            payload.get("latestEventAt", ""),
            payload.get("updatedAt", ""),
            dump_json(payload),
        ),
    )


def delete_reimbursement_record(conn, record_id):
    conn.execute("DELETE FROM reimbursement_records WHERE id = ?", (record_id,))


def _load_json_array(value):
    if not value:
        return []
    try:
        parsed = json.loads(value)
    except (TypeError, json.JSONDecodeError):
        return []
    return parsed if isinstance(parsed, list) else []
