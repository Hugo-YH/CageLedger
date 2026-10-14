"""Server-side column filters, facets and ordering for service business lists."""

import json

from server_app.domains.workflow.constants import FROZEN_WORKFLOW_STATUSES

SHEET_COLUMNS = {
    "month": "month",
    "iacuc": "iacuc",
    "pi": "pi",
    "facility": "facility",
    "serviceName": "json_extract(payload,'$.serviceName')",
    "serviceDayCount": "json_extract(payload,'$.serviceDayCount')",
    "quantity": "json_extract(payload,'$.totalQuantity')",
    "amount": "total_cents / 100.0",
    "status": "protected",
}
CANDIDATE_COLUMNS = {key: key for key in ("month", "pi", "iacuc", "amount", "workflow")}


def columns(params, allowed):
    raw = params.get("columnFilters") or {}
    if isinstance(raw, str):
        try:
            raw = json.loads(raw)
        except json.JSONDecodeError as exc:
            raise ValueError("列筛选格式无效") from exc
    if not isinstance(raw, dict) or len(raw) > len(allowed):
        raise ValueError("列筛选格式无效")
    for key, values in raw.items():
        if key not in allowed or not isinstance(values, list) or len(values) > 100:
            raise ValueError("列筛选字段或选项无效")
        if any(not isinstance(v, str) or len(v) > 1000 for v in values):
            raise ValueError("列筛选选项无效")
    return raw


def conditions(params, allowed, *, exclude=""):
    clauses, values = [], []
    for key, selected in columns(params, allowed).items():
        if key == exclude or not selected:
            continue
        marks = ",".join("?" for _ in selected)
        if key == "iacuc" and allowed is CANDIDATE_COLUMNS:
            clauses.append(f"EXISTS (SELECT 1 FROM json_each(iacuc_json) WHERE value IN ({marks}))")
        else:
            clauses.append(f"CAST({allowed[key]} AS TEXT) IN ({marks})")
        values.extend(selected)
    return clauses, values


def order(params, allowed, default):
    key = params.get("sortKey")
    if not key:
        return default
    direction = params.get("sortDir", "asc")
    if key not in allowed or direction not in ("asc", "desc"):
        raise ValueError("排序字段或方向无效")
    return f"{allowed[key]} {direction}"


def pagination(params):
    offset = max(int(params.get("offset", 0)), 0)
    limit = min(max(int(params.get("limit", 30)), 1), 100)
    return limit, offset


def page(total, limit, offset):
    return {"total": total, "limit": limit, "offset": offset, "hasMore": offset + limit < total}


def sheet_base(protected):
    marks = ",".join("?" for _ in protected) or "NULL"
    return (
        f"SELECT *, CASE WHEN id IN ({marks}) THEN 'protected' ELSE 'editable' END AS protected FROM technical_service_sheets WHERE deleted=0",
        list(protected),
    )


def sheet_where(params, *, exclude=""):
    clauses, values = conditions(params, SHEET_COLUMNS, exclude=exclude)
    for key, column in (("month", "month"), ("pi", "pi"), ("facility", "facility"), ("serviceId", "service_id")):
        if params.get(key):
            clauses.append(f"{column}=?")
            values.append(params[key])
    if params.get("keyword"):
        clauses.append("(iacuc LIKE ? OR pi LIKE ? OR json_extract(payload,'$.project') LIKE ?)")
        values.extend([f"%{params['keyword']}%"] * 3)
    return " AND ".join(clauses) or "1", values


def candidate_base(source_type):
    statuses = sorted(FROZEN_WORKFLOW_STATUSES)
    marks = ",".join("?" for _ in statuses)
    return (
        f"""SELECT s.month, s.pi, GROUP_CONCAT(DISTINCT s.iacuc) AS iacuc,
        json_group_array(DISTINCT s.iacuc) AS iacuc_json,
        GROUP_CONCAT(DISTINCT json_extract(s.payload,'$.manager')) AS manager,
        json_group_array(DISTINCT json_extract(s.payload,'$.manager')) AS manager_json,
        w.id AS workflow_id, w.workflow_status AS workflow_status,
        CASE WHEN w.workflow_status IN ({marks}) THEN json_extract(v.payload,'$.statement.totalAmount')
             ELSE SUM(s.total_cents) / 100.0 END AS amount,
        CASE WHEN w.workflow_status IN ('statement_sent','statement_archived','statement_locked')
             THEN w.workflow_status ELSE 'statement_generated' END AS workflow
        FROM technical_service_sheets s
        LEFT JOIN billing_workflows w ON w.month=s.month AND json_extract(w.payload,'$.pi')=s.pi AND w.source_type=?
        LEFT JOIN billing_statement_versions v ON v.id=w.current_version_id
        WHERE s.deleted=0 GROUP BY s.month, s.pi""",
        [*statuses, source_type],
    )


def candidate_where(params, *, exclude=""):
    clauses, values = conditions(params, CANDIDATE_COLUMNS, exclude=exclude)
    if params.get("month"):
        clauses.append("month=?")
        values.append(params["month"])
    if params.get("keyword"):
        clauses.append("(pi LIKE ? OR iacuc LIKE ?)")
        values.extend([f"%{params['keyword']}%"] * 2)
    return " AND ".join(clauses) or "1", values


def filter_options(conn, params, *, base, base_values, allowed, where):
    column = params.get("column", "")
    if column not in allowed:
        raise ValueError("筛选字段无效")
    condition, values = where(params, exclude=column)
    if column == "iacuc" and allowed is CANDIDATE_COLUMNS:
        sql = f"SELECT value, COUNT(*) FROM ({base}) q, json_each(q.iacuc_json) WHERE {condition} GROUP BY value ORDER BY value"
    else:
        expression = allowed[column]
        sql = f"SELECT CAST({expression} AS TEXT) value, COUNT(*) FROM ({base}) WHERE {condition} GROUP BY {expression} ORDER BY {expression}"
    labels = {
        "zhujiang": "珠江新城",
        "bioisland": "生物岛",
        "protected": "已发起结算",
        "editable": "可编辑",
        "statement_generated": "待发起",
        "statement_sent": "已发起",
        "statement_archived": "已登记",
        "statement_locked": "已归档",
    }
    return {
        "items": [
            {
                "value": r[0],
                "label": labels.get(r[0], r[0])
                if column in ("facility", "status", "workflow")
                else (f"{float(r[0]):.2f}" if column == "amount" else r[0]),
                "count": r[1],
            }
            for r in conn.execute(sql, [*base_values, *values])
            if r[0] is not None
        ]
    }
