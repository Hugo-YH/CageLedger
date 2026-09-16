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
    projection = "t.payload, b.payload" + (", r.payload" if reports else "")
    rows = conn.execute(
        f"SELECT {projection} FROM {source} WHERE {clause} ORDER BY {order} LIMIT ? OFFSET ?",
        [*args, limit, offset],
    )
    items = []
    for row in rows:
        test, batch = json.loads(row[0]), json.loads(row[1])
        item = {
            "id": test["id"],
            "testId": test["id"],
            "batchId": batch["id"],
            "batchName": batch["name"],
            "method": test["method"],
            "testDate": test.get("testDate", ""),
            "samplingDate": test.get("samplingDate", ""),
            "state": test["state"],
            "sampleCount": len(test.get("samples", [])),
            "projectCount": len(test.get("projects", [])),
            "abnormalCount": sum(
                v in {"positive", "suspect"} for p in test.get("projects", []) for v in p.get("results", {}).values()
            ),
            "suppliers": sorted({s.get("supplier", "") for s in batch.get("sources", []) if s.get("supplier")}),
            "updatedAt": test["updatedAt"],
            "retestOf": test.get("retestOf", ""),
            "correctionOf": test.get("correctionOf", ""),
        }
        if reports:
            report = json.loads(row[2])
            item.update(
                {
                    key: report.get(key)
                    for key in ("id", "number", "version", "issuedBy", "templateVersion", "updatedAt")
                }
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
