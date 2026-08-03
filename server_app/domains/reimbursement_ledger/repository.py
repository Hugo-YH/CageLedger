import json

from server_app.shared import now_iso


def claim_row(conn, claim_id):
    row = conn.execute("SELECT * FROM reimbursement_claims WHERE id = ?", (claim_id,)).fetchone()
    if not row:
        raise LookupError("报销单不存在")
    return row


def funding_line_row(conn, line_id):
    row = conn.execute("SELECT * FROM reimbursement_claim_funding_lines WHERE id = ?", (line_id,)).fetchone()
    if not row:
        raise LookupError("经费明细不存在")
    return row


def obligation_row(conn, obligation_id):
    row = conn.execute("SELECT * FROM reimbursement_settlement_obligations WHERE id = ?", (obligation_id,)).fetchone()
    if not row:
        raise LookupError("结算应收不存在")
    return row


def allocation_row(conn, allocation_id):
    row = conn.execute("SELECT * FROM reimbursement_allocations WHERE id = ?", (allocation_id,)).fetchone()
    if not row:
        raise LookupError("核销分摊不存在")
    return row


def obligation_payload(conn, row):
    payload = load(row["payload"])
    payload.update(
        {
            "id": row["id"],
            "workflowId": row["workflow_id"],
            "statementVersionId": row["statement_version_id"],
            "statementVersionNo": row["statement_version_no"],
            "month": row["month"],
            "sourcePi": row["source_pi"],
            "iacuc": row["iacuc"],
            "payableAmount": money(row["payable_amount"]),
            "allocatedAmount": money(row["allocated_amount"]),
            "outstandingAmount": money(row["outstanding_amount"]),
            "claimCount": row["claim_count"],
            "obligationKind": row["obligation_kind"],
            "status": row["status"],
            "createdAt": row["created_at"],
            "updatedAt": row["updated_at"],
        }
    )
    return payload


def claim_payload(conn, row, include_detail):
    payload = load(row["payload"])
    row_keys = row.keys()
    payload.update(
        {
            "id": row["id"],
            "documentNumber": row["document_number"],
            "fundingOwner": row["funding_owner"],
            "status": row["status"],
            "totalAmount": money(row["total_amount"]),
            "allocatedAmount": money(row["allocated_amount"]),
            "unallocatedAmount": money(row["unallocated_amount"]),
            "attachmentCount": row["attachment_count"],
            "fundingLineCount": (
                row["funding_line_count"]
                if "funding_line_count" in row_keys
                else conn.execute(
                    "SELECT COUNT(*) FROM reimbursement_claim_funding_lines WHERE claim_id = ?", (row["id"],)
                ).fetchone()[0]
            ),
            "createdBy": row["created_by"],
            "createdByName": row["created_by_name"],
            "createdAt": row["created_at"],
            "updatedAt": row["updated_at"],
        }
    )
    if include_detail:
        lines = conn.execute(
            "SELECT * FROM reimbursement_claim_funding_lines WHERE claim_id = ? ORDER BY sort_order, rowid",
            (row["id"],),
        ).fetchall()
        payload["fundingLines"] = [funding_line_payload(conn, line, True) for line in lines]
        attachments = conn.execute(
            "SELECT * FROM reimbursement_claim_attachments WHERE claim_id = ? ORDER BY created_at", (row["id"],)
        ).fetchall()
        payload["attachments"] = [attachment_payload(item) for item in attachments]
    return payload


def funding_line_payload(conn, row, include_allocations):
    payload = load(row["payload"])
    payload.update(
        {
            "id": row["id"],
            "claimId": row["claim_id"],
            "fundBookNo": row["fund_book_no"],
            "fundingOwner": row["funding_owner"],
            "reimbursementAmount": money(row["reimbursement_amount"]),
            "allocatedAmount": money(row["allocated_amount"]),
            "unallocatedAmount": money(row["unallocated_amount"]),
            "sortOrder": row["sort_order"],
            "createdAt": row["created_at"],
            "updatedAt": row["updated_at"],
        }
    )
    if include_allocations:
        allocations = conn.execute(
            "SELECT * FROM reimbursement_allocations WHERE funding_line_id = ? ORDER BY created_at", (row["id"],)
        ).fetchall()
        payload["allocations"] = [allocation_payload(conn, allocation) for allocation in allocations]
    return payload


def allocation_payload(conn, row):
    payload = load(row["payload"])
    obligation = obligation_row(conn, row["obligation_id"])
    line = funding_line_row(conn, row["funding_line_id"])
    claim = claim_row(conn, line["claim_id"])
    payload.update(
        {
            "id": row["id"],
            "fundingLineId": row["funding_line_id"],
            "obligationId": row["obligation_id"],
            "amount": money(row["amount"]),
            "status": row["status"],
            "confirmedBy": row["confirmed_by"] or "",
            "confirmedAt": row["confirmed_at"] or "",
            "reversedBy": row["reversed_by"] or "",
            "reversedAt": row["reversed_at"] or "",
            "reversalReason": row["reversal_reason"] or "",
            "createdBy": row["created_by"],
            "createdByName": row["created_by_name"],
            "createdAt": row["created_at"],
            "updatedAt": row["updated_at"],
            "sourcePi": obligation["source_pi"],
            "iacuc": obligation["iacuc"],
            "month": obligation["month"],
            "fundingOwner": claim["funding_owner"],
            "fundBookNo": line["fund_book_no"],
            "documentNumber": claim["document_number"],
        }
    )
    return payload


def attachment_payload(row):
    payload = load(row["payload"])
    payload.update(
        {
            "id": row["id"],
            "claimId": row["claim_id"],
            "originalName": row["original_name"],
            "storedName": row["stored_name"],
            "mimeType": row["mime_type"],
            "sizeBytes": row["size_bytes"],
            "sha256": row["sha256"],
            "ocrStatus": row["ocr_status"],
            "ocrResult": row["ocr_result"],
            "ocrProvider": row["ocr_provider"],
            "ocrModelVersion": row["ocr_model_version"],
            "ocrRequestedAt": row["ocr_requested_at"] or "",
            "ocrCompletedAt": row["ocr_completed_at"] or "",
            "ocrError": row["ocr_error"],
            "createdBy": row["created_by"],
            "createdAt": row["created_at"],
        }
    )
    return payload


def upsert_obligation(conn, item):
    item = dict(item)
    item.setdefault("allocatedAmount", 0)
    item.setdefault("outstandingAmount", item["payableAmount"])
    item.setdefault("claimCount", 0)
    conn.execute(
        """INSERT INTO reimbursement_settlement_obligations
           (id, workflow_id, statement_version_id, statement_version_no, month, source_pi, iacuc, payable_amount, allocated_amount,
            outstanding_amount, claim_count, obligation_kind, status, created_at, updated_at, payload)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET statement_version_id=excluded.statement_version_id, statement_version_no=excluded.statement_version_no,
             month=excluded.month, source_pi=excluded.source_pi, iacuc=excluded.iacuc, payable_amount=excluded.payable_amount,
             allocated_amount=excluded.allocated_amount, outstanding_amount=excluded.outstanding_amount, claim_count=excluded.claim_count,
             obligation_kind=excluded.obligation_kind, status=excluded.status, updated_at=excluded.updated_at, payload=excluded.payload""",
        (
            item["id"],
            item["workflowId"],
            item["statementVersionId"],
            item["statementVersionNo"],
            item["month"],
            item["sourcePi"],
            item["iacuc"],
            item["payableAmount"],
            item["allocatedAmount"],
            item["outstandingAmount"],
            item["claimCount"],
            item["obligationKind"],
            item["status"],
            item["createdAt"],
            item["updatedAt"],
            dump(item),
        ),
    )


def upsert_claim(conn, item):
    conn.execute(
        """INSERT INTO reimbursement_claims
           (id, document_number, funding_owner, status, total_amount, allocated_amount, unallocated_amount, attachment_count,
            created_by, created_by_name, created_at, updated_at, payload)
           VALUES (?, ?, ?, ?, 0, 0, 0, 0, ?, ?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET document_number=excluded.document_number, funding_owner=excluded.funding_owner,
             status=excluded.status, updated_at=excluded.updated_at, payload=excluded.payload""",
        (
            item["id"],
            item["documentNumber"],
            item["fundingOwner"],
            item["status"],
            item["createdBy"],
            item["createdByName"],
            item["createdAt"],
            item["updatedAt"],
            dump(item),
        ),
    )


def upsert_funding_line(conn, item):
    conn.execute(
        """INSERT INTO reimbursement_claim_funding_lines
           (id, claim_id, fund_book_no, funding_owner, reimbursement_amount, allocated_amount, unallocated_amount, sort_order,
            created_at, updated_at, payload)
           VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET fund_book_no=excluded.fund_book_no, funding_owner=excluded.funding_owner,
             reimbursement_amount=excluded.reimbursement_amount, sort_order=excluded.sort_order, updated_at=excluded.updated_at,
             payload=excluded.payload""",
        (
            item["id"],
            item["claimId"],
            item["fundBookNo"],
            item["fundingOwner"],
            item["reimbursementAmount"],
            item["reimbursementAmount"],
            item["sortOrder"],
            item["createdAt"],
            item["updatedAt"],
            dump(item),
        ),
    )


def upsert_allocation(conn, item):
    conn.execute(
        """INSERT INTO reimbursement_allocations
           (id, funding_line_id, obligation_id, amount, status, confirmed_by, confirmed_at, reversed_by, reversed_at,
            reversal_reason, created_by, created_by_name, created_at, updated_at, payload)
           VALUES (?, ?, ?, ?, ?, NULL, NULL, NULL, NULL, '', ?, ?, ?, ?, ?)""",
        (
            item["id"],
            item["fundingLineId"],
            item["obligationId"],
            item["amount"],
            item["status"],
            item["createdBy"],
            item["createdByName"],
            item["createdAt"],
            item["updatedAt"],
            dump(item),
        ),
    )


def refresh_line_balance(conn, line_id):
    row = funding_line_row(conn, line_id)
    allocated = confirmed_amount_for_line(conn, line_id)
    conn.execute(
        "UPDATE reimbursement_claim_funding_lines SET allocated_amount = ?, unallocated_amount = ?, updated_at = ? WHERE id = ?",
        (allocated, round(float(row["reimbursement_amount"]) - allocated, 2), now_iso(), line_id),
    )


def refresh_obligation_balance(conn, obligation_id):
    row = obligation_row(conn, obligation_id)
    allocated = confirmed_amount_for_obligation(conn, obligation_id)
    claims = conn.execute(
        "SELECT COUNT(DISTINCT funding_line_id) FROM reimbursement_allocations WHERE obligation_id = ? AND status = 'confirmed'",
        (obligation_id,),
    ).fetchone()[0]
    outstanding = round(float(row["payable_amount"]) - allocated, 2)
    status = "settled" if abs(outstanding) < 0.00001 else "open"
    conn.execute(
        "UPDATE reimbursement_settlement_obligations SET allocated_amount = ?, outstanding_amount = ?, claim_count = ?, status = ?, updated_at = ? WHERE id = ?",
        (allocated, outstanding, claims, status, now_iso(), obligation_id),
    )


def refresh_claim_balances(conn, claim_id):
    lines = conn.execute(
        "SELECT id, reimbursement_amount FROM reimbursement_claim_funding_lines WHERE claim_id = ?", (claim_id,)
    ).fetchall()
    for line in lines:
        refresh_line_balance(conn, line["id"])
    total = round(sum(float(item["reimbursement_amount"]) for item in lines), 2)
    allocated = round(sum(confirmed_amount_for_line(conn, item["id"]) for item in lines), 2)
    attachments = conn.execute(
        "SELECT COUNT(*) FROM reimbursement_claim_attachments WHERE claim_id = ?", (claim_id,)
    ).fetchone()[0]
    conn.execute(
        "UPDATE reimbursement_claims SET total_amount = ?, allocated_amount = ?, unallocated_amount = ?, attachment_count = ?, updated_at = ? WHERE id = ?",
        (total, allocated, round(total - allocated, 2), attachments, now_iso(), claim_id),
    )


def confirmed_amount_for_line(conn, line_id):
    return money(
        conn.execute(
            "SELECT COALESCE(SUM(amount), 0) FROM reimbursement_allocations WHERE funding_line_id = ? AND status = 'confirmed'",
            (line_id,),
        ).fetchone()[0]
    )


def confirmed_amount_for_obligation(conn, obligation_id):
    return money(
        conn.execute(
            "SELECT COALESCE(SUM(amount), 0) FROM reimbursement_allocations WHERE obligation_id = ? AND status = 'confirmed'",
            (obligation_id,),
        ).fetchone()[0]
    )


def claim_has_confirmed_allocations(conn, claim_id):
    return bool(
        conn.execute(
            """SELECT 1 FROM reimbursement_allocations AS allocations
        JOIN reimbursement_claim_funding_lines AS lines ON lines.id = allocations.funding_line_id
        WHERE lines.claim_id = ? AND allocations.status = 'confirmed' LIMIT 1""",
            (claim_id,),
        ).fetchone()
    )


def money(value):
    try:
        return round(float(value or 0), 2)
    except (TypeError, ValueError):
        return 0.0


def load(value):
    try:
        return json.loads(value or "{}")
    except json.JSONDecodeError:
        return {}


def dump(value):
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"))
