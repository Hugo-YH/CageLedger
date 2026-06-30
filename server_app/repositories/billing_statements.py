import json

from server_app.cache import cache_get, cache_key, cache_set

from .payload import dump_json


def list_billing_statement_lines_for_version(conn, version_id):
    rows = conn.execute(
        "SELECT payload FROM billing_statement_version_lines WHERE version_id = ? ORDER BY line_date, rowid",
        (version_id,),
    ).fetchall()
    return [json.loads(row["payload"]) for row in rows]


def list_billing_statement_line_summaries_for_version(conn, version_id):
    key = cache_key("billing_workflows::lines", version_id=version_id)
    cached = cache_get(key)
    if cached is not None:
        return cached
    rows = conn.execute(
        """
        SELECT
            line_date,
            json_extract(payload, '$.cageCount') AS cage_count,
            json_extract(payload, '$.animalCount') AS animal_count,
            json_extract(payload, '$.freeCages') AS free_cages,
            json_extract(payload, '$.billableCages') AS billable_cages,
            json_extract(payload, '$.billableCount') AS billable_count,
            json_extract(payload, '$.amount') AS amount,
            json_extract(payload, '$.cumulative') AS cumulative
        FROM billing_statement_version_lines
        WHERE version_id = ?
        ORDER BY line_date, rowid
        """,
        (version_id,),
    ).fetchall()
    return cache_set(key, [billing_statement_line_summary_row(row) for row in rows])


def billing_statement_line_summary_row(row):
    return {
        "date": row["line_date"] or "",
        "cageCount": row["cage_count"] or 0,
        "animalCount": row["animal_count"] or 0,
        "freeCages": row["free_cages"] or 0,
        "billableCages": row["billable_cages"] if row["billable_cages"] is not None else (row["billable_count"] or 0),
        "amount": row["amount"] or 0,
        "cumulative": row["cumulative"] or 0,
    }


def billing_statement_list_item(statement):
    return {
        "id": statement.get("id", ""),
        "workflowId": statement.get("workflowId", ""),
        "versionId": statement.get("versionId", ""),
        "versionNo": statement.get("versionNo", ""),
        "versionStatus": statement.get("versionStatus", ""),
        "workflowStatus": statement.get("workflowStatus", ""),
        "documentNumber": statement.get("documentNumber", ""),
        "iacuc": statement.get("iacuc", ""),
        "iacucs": statement.get("iacucs", []),
        "month": statement.get("month", ""),
        "sourceType": statement.get("sourceType", ""),
        "pi": statement.get("pi", ""),
        "project": statement.get("project", ""),
        "owner": statement.get("owner", ""),
        "funding": statement.get("funding", ""),
        "totalAmount": statement.get("totalAmount", 0),
        "totalCageDays": statement.get("totalCageDays", 0),
        "totalAnimalDays": statement.get("totalAnimalDays", 0),
        "billingUnit": statement.get("billingUnit", ""),
        "generatedAt": statement.get("generatedAt", ""),
    }


def list_current_billing_statements(conn):
    key = "billing_statements::current"
    cached = cache_get(key)
    if cached is not None:
        return cached
    rows = conn.execute(
        """
        SELECT versions.payload
        FROM billing_workflows AS workflows
        JOIN billing_statement_versions AS versions
          ON versions.id = workflows.current_version_id
        ORDER BY workflows.month DESC, workflows.rowid DESC
        """
    ).fetchall()
    statements = []
    for row in rows:
        version = json.loads(row["payload"])
        statement = dict(version.get("statement") or {})
        if statement:
            statements.append(billing_statement_list_item(statement))
    return cache_set(key, statements)


def get_current_billing_statement(conn, statement_id):
    key = cache_key("billing_statements::current_item", id=statement_id)
    cached = cache_get(key)
    if cached is not None:
        return cached
    row = conn.execute(
        """
        SELECT versions.payload
        FROM billing_statement_versions AS versions
        JOIN billing_workflows AS workflows
          ON workflows.current_version_id = versions.id
        WHERE versions.id = ?
        """,
        (statement_id,),
    ).fetchone()
    if not row:
        return cache_set(key, None)
    version = json.loads(row["payload"])
    statement = dict(version.get("statement") or {})
    if not statement:
        return cache_set(key, None)
    return cache_set(key, billing_statement_list_item(statement))


def replace_billing_statement_version_lines(conn, version_id, lines):
    conn.execute("DELETE FROM billing_statement_version_lines WHERE version_id = ?", (version_id,))
    for index, line in enumerate(lines, start=1):
        normalized = {**line, "versionId": version_id}
        line_id = normalized.get("id") or f"{version_id}-line-{index}"
        conn.execute(
            """
            INSERT INTO billing_statement_version_lines (id, version_id, line_date, payload)
            VALUES (?, ?, ?, ?)
            """,
            (line_id, version_id, normalized.get("date", ""), dump_json(normalized)),
        )
