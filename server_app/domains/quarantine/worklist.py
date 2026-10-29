"""Read-only, paginated projections for the quarantine workspace."""

import json
from datetime import date

METHODS = {"parasite", "pcr", "elisa", "elisa_mouse", "elisa_rat"}


def filters(params):
    method, state = params.get("method", ""), params.get("state", "")
    if method and method not in METHODS:
        raise ValueError("检测类型无效")
    if state not in {"", "draft", "issued"}:
        raise ValueError("检测状态无效")
    start, end = params.get("dateFrom", ""), params.get("dateTo", "")
    for value in (start, end):
        if value and date.fromisoformat(value).isoformat() != value:
            raise ValueError("日期格式无效")
    if start and end and start > end:
        raise ValueError("开始日期不能晚于结束日期")
    return method, state, start, end


def list_records(conn, params, *, reports=False):
    method, state, start, end = filters(params)
    limit = min(100, max(1, int(params.get("limit", 30))))
    offset = max(0, int(params.get("offset", 0)))
    source = "quarantine_tests t JOIN quarantine_batches b ON b.id=t.batch_id"
    if reports:
        source += " JOIN quarantine_reports r ON r.test_id=t.id"
    where, args = ["1=1"], []
    if method:
        methods = ["elisa_mouse", "elisa_rat"] if method == "elisa" else [method]
        where.append("json_extract(t.payload, '$.method') IN (" + ",".join("?" for _ in methods) + ")")
        args.extend(methods)
    if state:
        where.append("json_extract(t.payload, '$.state')=?")
        args.append(state)
    for operator, value in ((">=", start), ("<=", end)):
        if value:
            where.append(f"json_extract(t.payload, '$.testDate'){operator}?")
            args.append(value)
    search = str(params.get("search", "")).strip()
    if search:
        haystack = "coalesce(json_extract(b.payload, '$.name'), '') || ' ' || coalesce(json_extract(b.payload, '$.sources'), '')"
        if reports:
            haystack += " || ' ' || coalesce(json_extract(r.payload, '$.number'), '')"
        where.append(f"instr(lower({haystack}),lower(?))>0")
        args.append(search)
    clause = " AND ".join(where)
    counts = conn.execute(
        f"""SELECT COUNT(*), COALESCE(SUM(json_extract(t.payload, '$.state')='draft'),0),
            COALESCE(SUM(json_extract(t.payload, '$.state')='issued'),0)
            FROM {source} WHERE {clause}""",
        args,
    ).fetchone()
    order = "r.updated_at DESC, r.id" if reports else "t.updated_at DESC, t.id"
    # Keep the page boundary in SQL, then extract only list fields. Large project,
    # report snapshot and batch payloads never cross the SQLite/Python boundary.
    projection = """json_extract(t.payload, '$.id'), json_extract(b.payload, '$.id'),
        json_extract(b.payload, '$.name'), json_extract(t.payload, '$.method'),
        CASE WHEN json_type(t.payload, '$.testDate') IS NULL THEN '' ELSE json_extract(t.payload, '$.testDate') END,
        CASE WHEN json_type(t.payload, '$.samplingDate') IS NULL THEN '' ELSE json_extract(t.payload, '$.samplingDate') END,
        json_extract(t.payload, '$.state'), COALESCE(json_array_length(t.payload, '$.samples'), 0),
        COALESCE(json_array_length(t.payload, '$.projects'), 0),
        (SELECT COUNT(*) FROM json_each(t.payload, '$.projects') p, json_each(p.value, '$.results') v
         WHERE v.value IN ('positive', 'suspect')),
        json_extract(b.payload, '$.sources'), json_extract(t.payload, '$.updatedAt'),
        CASE WHEN json_type(t.payload, '$.retestOf') IS NULL THEN '' ELSE json_extract(t.payload, '$.retestOf') END,
        CASE WHEN json_type(t.payload, '$.correctionOf') IS NULL THEN '' ELSE json_extract(t.payload, '$.correctionOf') END"""
    if reports:
        projection += ", " + ", ".join(
            f"json_extract(r.payload, '$.{key}')"
            for key in ("id", "number", "version", "issuedBy", "templateVersion", "updatedAt")
        )
    page_ids = "t.id AS test_id" + (", r.id AS report_id" if reports else "")
    page_source = "page JOIN quarantine_tests t ON t.id=page.test_id JOIN quarantine_batches b ON b.id=t.batch_id"
    if reports:
        page_source += " JOIN quarantine_reports r ON r.id=page.report_id"
    rows = conn.execute(
        f"""WITH page AS (
            SELECT {page_ids} FROM {source} WHERE {clause} ORDER BY {order} LIMIT ? OFFSET ?
        ) SELECT {projection} FROM {page_source} ORDER BY {order}""",
        [*args, limit, offset],
    )
    items = []
    for row in rows:
        sources = json.loads(row[10]) if row[10] else []
        item = {
            "id": row[0],
            "testId": row[0],
            "batchId": row[1],
            "batchName": row[2],
            "method": row[3],
            "testDate": row[4],
            "samplingDate": row[5],
            "state": row[6],
            "sampleCount": row[7],
            "projectCount": row[8],
            "abnormalCount": row[9],
            "suppliers": sorted({s.get("supplier", "") for s in sources if s.get("supplier")}),
            "updatedAt": row[11],
            "retestOf": row[12],
            "correctionOf": row[13],
        }
        if reports:
            item.update(
                dict(
                    zip(("id", "number", "version", "issuedBy", "templateVersion", "updatedAt"), row[14:], strict=True)
                )
            )
        items.append(item)
    return {
        "items": items,
        "page": {"limit": limit, "offset": offset, "total": counts[0], "hasMore": offset + limit < counts[0]},
        "summary": {"total": counts[0], "draft": counts[1], "issued": counts[2]},
    }


def activity(conn, batch_id, params):
    # Deliberately omit before/after payloads and unrelated audit entries.
    limit = min(100, max(1, int(params.get("limit", 30))))
    offset = max(0, int(params.get("offset", 0)))
    if not conn.execute("SELECT 1 FROM quarantine_batches WHERE id=?", (batch_id,)).fetchone():
        raise LookupError("检疫批次不存在")
    clause = """entity_type='quarantine' AND (entity_id=?
        OR entity_id IN (SELECT id FROM quarantine_tests WHERE batch_id=?)
        OR entity_id IN (SELECT a.id FROM quarantine_attachments a JOIN quarantine_tests t ON a.test_id=t.id WHERE t.batch_id=?)
        OR entity_id IN (SELECT r.id FROM quarantine_reports r JOIN quarantine_tests t ON r.test_id=t.id WHERE t.batch_id=?))"""
    args = [batch_id] * 4
    total = conn.execute(f"SELECT COUNT(*) FROM audit_events WHERE {clause}", args).fetchone()[0]
    rows = conn.execute(
        f"SELECT id, action, actor_display_name, actor_username, at FROM audit_events WHERE {clause} ORDER BY at DESC,id LIMIT ? OFFSET ?",
        [*args, limit, offset],
    )
    return {
        "items": [{"id": r[0], "action": r[1], "actor": r[2] or r[3], "at": r[4]} for r in rows],
        "page": {"limit": limit, "offset": offset, "total": total, "hasMore": offset + limit < total},
    }
