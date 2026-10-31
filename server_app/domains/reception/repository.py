import hashlib
import json

from server_app.config import IACUC_INDEX_PATH, LEGACY_IACUC_INDEX_PATH
from server_app.repositories.iacuc import read_iacuc_index
from server_app.repositories.person_names import person_options, split_person_names

FIELDS = {
    "batchNo": "b.batch_no",
    "purchaseOrderNo": "json_extract(b.payload,'$.purchaseOrderNo')",
    "iacuc": "b.iacuc",
    "supplier": "b.supplier",
    "roomName": "b.room_name",
    "sex": "json_extract(b.payload,'$.sex')",
    "quantity": "b.quantity",
    "pi": "json_extract(a.application,'$.pi')",
    "owner": "json_extract(a.application,'$.owner')",
    "projectMatched": "CASE WHEN a.matches=1 THEN 'true' ELSE 'false' END",
}
PROJECT_FIELDS = ("iacuc", "project", "pi", "owner", "funding", "fundCode", "projectEndDate")
BASE = """
WITH application_rows AS (
 SELECT upper(trim(json_extract(value,'$.iacuc'))) code, value FROM json_each(?)
), applications AS (
 SELECT code, count(*) matches, CASE WHEN count(*)=1 THEN max(value) END application
 FROM application_rows WHERE code IS NOT NULL AND code!='' GROUP BY code
)
"""
JOIN = " FROM intake_batches b LEFT JOIN applications a ON a.code=upper(trim(b.iacuc))"


def context(conn):
    index = read_iacuc_index(conn, IACUC_INDEX_PATH, LEGACY_IACUC_INDEX_PATH)
    items = [{key: item.get(key) for key in PROJECT_FIELDS} for item in index.get("items", [])]
    for item in items:
        for key in ("pi", "owner"):
            item[f"_{key}People"] = list(split_person_names(item.get(key)))
    content = json.dumps(items, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    version = hashlib.sha256(content.encode()).hexdigest()
    return {"json": content, "version": version, "updatedAt": index.get("updatedAt"), "source": index.get("source")}


def clause(filters, *, exclude=""):
    parts, values = ["b.status='received'"], []
    for key, selected in filters.items():
        if key == exclude or not selected:
            continue
        if key == "receiptDate":
            dates = [value for value in selected if value]
            conditions = []
            if dates:
                conditions.append(
                    "EXISTS (SELECT 1 FROM json_each(b.payload,'$.receipts') r "
                    "WHERE json_extract(r.value,'$.actualReceiptDate') IN (" + ",".join("?" for _ in dates) + "))"
                )
            if "" in selected:
                conditions.append(
                    "NOT EXISTS (SELECT 1 FROM json_each(b.payload,'$.receipts') r "
                    "WHERE coalesce(json_extract(r.value,'$.actualReceiptDate'),'')!='')"
                )
            parts.append("(" + " OR ".join(conditions) + ")")
            values.extend(dates)
            continue
        elif key in ("pi", "owner"):
            parts.append(
                f"EXISTS (SELECT 1 FROM json_each(a.application,'$._{key}People') p "
                f"WHERE p.value IN ({','.join('?' for _ in selected)}))"
            )
        else:
            parts.append(f"CAST(coalesce({FIELDS[key]},'') AS TEXT) IN ({','.join('?' for _ in selected)})")
        values.extend(selected)
    return " AND ".join(parts), values


def page(conn, source, params):
    where, values = clause(params["columnFilters"])
    count = conn.execute(BASE + "SELECT count(*)" + JOIN + " WHERE " + where, [source["json"], *values]).fetchone()[0]
    order = FIELDS.get(params["sortKey"], "b.intake_date")
    if params["sortKey"] == "receiptDate":
        order = "(SELECT max(json_extract(value,'$.actualReceiptDate')) FROM json_each(b.payload,'$.receipts'))"
    direction = "ASC" if params["sortDir"] == "asc" else "DESC"
    projection = ",".join(f"'{key}',{expr}" for key, expr in FIELDS.items())
    extra = ",".join(
        f"'{key}',json_extract(b.payload,'$.{key}')"
        for key in ("strainRaw", "strainStandard", "specification", "receipts")
    )
    sql = BASE + f"SELECT b.id,b.updated_at,a.application,json_object({projection},{extra}) summary" + JOIN
    rows = conn.execute(
        sql + f" WHERE {where} ORDER BY {order} {direction}, b.id ASC LIMIT ? OFFSET ?",
        [source["json"], *values, params["limit"], params["offset"]],
    ).fetchall()
    return rows, count


def filter_options(conn, source, column, filters):
    where, values = clause(filters, exclude=column)
    if column == "receiptDate":
        sql = BASE + "SELECT json_extract(r.value,'$.actualReceiptDate') value,count(DISTINCT b.id) count" + JOIN
        sql += " LEFT JOIN json_each(b.payload,'$.receipts') r"
        sql += f" WHERE {where} GROUP BY value ORDER BY value"
    else:
        sql = BASE + f"SELECT coalesce({FIELDS[column]},'') value,count(*) count" + JOIN
        sql += f" WHERE {where} GROUP BY value ORDER BY value"
    items = [
        {"value": str(row["value"] or ""), "label": str(row["value"] or "未填写"), "count": row["count"]}
        for row in conn.execute(sql, [source["json"], *values])
    ]
    return person_options({"personFilterMode": "individual"}, column, items)


def selected(conn, source, ids):
    sql = BASE + "SELECT b.id,b.updated_at,b.payload,a.application" + JOIN
    sql += " WHERE b.status='received' AND b.id IN (" + ",".join("?" for _ in ids) + ")"
    return conn.execute(sql, [source["json"], *ids]).fetchall()
