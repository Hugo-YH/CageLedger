import json


def ensure_schema(conn):
    for table, extra in (
        ("batches", ""),
        ("tests", ", batch_id TEXT NOT NULL REFERENCES quarantine_batches(id)"),
        ("attachments", ", test_id TEXT NOT NULL REFERENCES quarantine_tests(id)"),
        (
            "reports",
            ", test_id TEXT NOT NULL REFERENCES quarantine_tests(id), version INTEGER NOT NULL, UNIQUE(test_id, version)",
        ),
    ):
        conn.execute(
            f"CREATE TABLE IF NOT EXISTS quarantine_{table} (id TEXT PRIMARY KEY, payload TEXT NOT NULL, updated_at TEXT NOT NULL {extra})"
        )
    for table, field in (("tests", "batch_id"), ("attachments", "test_id"), ("reports", "test_id")):
        conn.execute(f"CREATE INDEX IF NOT EXISTS idx_quarantine_{table}_{field} ON quarantine_{table}({field})")


def get(conn, table, entity_id):
    row = conn.execute(f"SELECT payload FROM quarantine_{table} WHERE id=?", (entity_id,)).fetchone()
    if not row:
        raise LookupError("检疫记录不存在")
    return json.loads(row[0])


def all_items(conn, table, parent=None):
    field = "batch_id" if table == "tests" else "test_id"
    where, args = (f"WHERE {field}=?", (parent,)) if parent else ("", ())
    if table == "attachments":
        where += (" AND " if where else "WHERE ") + "COALESCE(json_extract(payload, '$.removed'), 0) = 0"
    return [
        json.loads(row[0])
        for row in conn.execute(f"SELECT payload FROM quarantine_{table} {where} ORDER BY updated_at DESC, id", args)
    ]


def save(conn, table, item, *, create=False):
    payload = json.dumps(item, ensure_ascii=False)
    if not create:
        conn.execute(
            f"UPDATE quarantine_{table} SET payload=?, updated_at=? WHERE id=?",
            (payload, item["updatedAt"], item["id"]),
        )
        return
    fields, values = ["id", "payload", "updated_at"], [item["id"], payload, item["updatedAt"]]
    if table == "tests":
        fields.append("batch_id")
        values.append(item["batchId"])
    if table in {"reports", "attachments"}:
        fields.append("test_id")
        values.append(item["testId"])
    if table == "reports":
        fields.append("version")
        values.append(item["version"])
    conn.execute(
        f"INSERT INTO quarantine_{table} ({','.join(fields)}) VALUES ({','.join('?' for _ in fields)})", values
    )


def intake(conn, entity_id):
    row = conn.execute("SELECT payload FROM intake_batches WHERE id=?", (entity_id,)).fetchone()
    if not row:
        raise ValueError("选择的到货批次不存在")
    return json.loads(row[0])


def supplier_options(conn):
    from server_app.domains.intake.strain_standard import abbreviate_supplier

    names = {
        abbreviate_supplier(str(row[0] or ""))
        for row in conn.execute("SELECT DISTINCT json_extract(payload, '$.supplier') FROM intake_batches")
    }
    names.update(s["supplier"] for b in all_items(conn, "batches") for s in b["sources"])
    return sorted(name for name in names if name)


def list_page(conn, table, params):
    limit = min(200, max(1, int(params.get("limit", 30))))
    offset = max(0, int(params.get("offset", 0)))
    if table == "batches":
        source, order = "quarantine_batches", "updated_at DESC, id"
        where = "instr(lower(json_extract(payload, '$.name')), lower(?)) > 0"
        args = [params.get("search", "")]
    else:
        source, order = "intake_batches", "intake_date DESC, id"
        where = "json_extract(payload, '$.status') = 'received' AND (? = '' OR intake_date >= ?) AND (? = '' OR intake_date <= ?)"
        start, end = params.get("dateFrom", ""), params.get("dateTo", "")
        args = [start, start, end, end]
        state = params.get("state", "pending")
        if state == "pending":
            where += " AND NOT EXISTS (SELECT 1 FROM quarantine_batches q, json_each(q.payload, '$.sources') s WHERE json_extract(s.value, '$.intakeId') = intake_batches.id)"
    total = conn.execute(f"SELECT COUNT(*) FROM {source} WHERE {where}", args).fetchone()[0]
    items = [
        json.loads(row[0])
        for row in conn.execute(
            f"SELECT payload FROM {source} WHERE {where} ORDER BY {order} LIMIT ? OFFSET ?", [*args, limit, offset]
        )
    ]
    if table != "batches":
        from .workflow import decorate_intakes

        decorate_intakes(conn, items)
    return {
        "items": items,
        "page": {"limit": limit, "offset": offset, "total": total, "hasMore": offset + limit < total},
    }
