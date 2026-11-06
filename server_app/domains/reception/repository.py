from server_app.config import IACUC_INDEX_PATH, LEGACY_IACUC_INDEX_PATH
from server_app.repositories.iacuc import read_iacuc_index
from server_app.repositories.intake_identifiers import member_filter, members_available
from server_app.repositories.person_names import person_options
from server_app.runtime_logging import log_stage

from .application_projection import PROJECT_FIELDS, encode_items, encode_rows
from .dates import sql_valid_date

FIELDS = {
    "batchNo": "b.batch_no",
    "purchaseOrderNo": "b.purchase_order_no",
    "orderNo": "b.order_no",
    "iacuc": "b.iacuc",
    "supplier": "b.supplier",
    "roomName": "b.room_name",
    "sex": "json_extract(b.payload,'$.sex')",
    "quantity": "b.quantity",
    "pi": "json_extract(a.application,'$.pi')",
    "owner": "json_extract(a.application,'$.owner')",
    "projectMatched": "CASE WHEN a.matches=1 THEN 'true' ELSE 'false' END",
}
APPLICATIONS_BASE = """
WITH application_rows AS (
 SELECT upper(trim(json_extract(value,'$.iacuc'))) code, value FROM json_each(?)
), applications AS (
 SELECT code, count(*) matches, CASE WHEN count(*)=1 THEN max(value) END application
 FROM application_rows WHERE code IS NOT NULL AND code!='' GROUP BY code
)
"""
BASE = (
    APPLICATIONS_BASE
    + """, batch_actual_dates AS MATERIALIZED (
 SELECT b.id,
 (SELECT json_group_array(value) FROM (
   SELECT DISTINCT trim(json_extract(r.value,'$.actualReceiptDate')) value
   FROM json_each(b.payload,'$.receipts') r WHERE ACTUAL_DATE_VALID ORDER BY value
 )) actual_dates
 FROM intake_batches b WHERE b.status='received'
), reception_dates AS MATERIALIZED (
 SELECT b.id,
 CASE WHEN json_array_length(d.actual_dates)>0 THEN d.actual_dates
      WHEN ORIGINAL_DATE_VALID THEN json_array(trim(b.intake_date)) ELSE '[]' END dates,
 CASE WHEN json_array_length(d.actual_dates)>0 THEN 'actual'
      WHEN ORIGINAL_DATE_VALID THEN 'original' ELSE 'missing' END source
 FROM intake_batches b JOIN batch_actual_dates d ON d.id=b.id
)
"""
)
BASE = BASE.replace("ACTUAL_DATE_VALID", sql_valid_date("trim(json_extract(r.value,'$.actualReceiptDate'))"))
BASE = BASE.replace("ORIGINAL_DATE_VALID", sql_valid_date("trim(b.intake_date)"))
APPLICATION_JOIN = " LEFT JOIN applications a ON a.code=upper(trim(b.iacuc))"
JOIN = " FROM intake_batches b" + APPLICATION_JOIN + " JOIN reception_dates d ON d.id=b.id"


def query_source(*, dates, projects=True):
    base = BASE if dates else APPLICATIONS_BASE
    join = " FROM intake_batches b" + (APPLICATION_JOIN if projects else "")
    if dates:
        join += " JOIN reception_dates d ON d.id=b.id"
    return base, join


def project_filters(filters):
    return any(filters.get(key) for key in ("pi", "owner", "projectMatched"))


def context(conn):
    # Keep the same import order/version, without decoding the full application
    # objects on each snapshot read. Legacy file-backed indexes retain their path.
    projection = ",".join(f"'$.{key}'" for key in PROJECT_FIELDS)
    rows = conn.execute(
        f"SELECT json_extract(payload,{projection}) fields,imported_at FROM experiment_applications ORDER BY rowid"
    ).fetchall()
    if rows:
        content, version = encode_rows(tuple(row["fields"] for row in rows))
        index = {"updatedAt": max(row["imported_at"] for row in rows), "source": "database"}
    else:
        index = read_iacuc_index(conn, IACUC_INDEX_PATH, LEGACY_IACUC_INDEX_PATH)
        content, version = encode_items(index.get("items", []))
    return {"json": content, "version": version, "updatedAt": index.get("updatedAt"), "source": index.get("source")}


def clause(filters, *, exclude="", conn=None):
    parts, values = ["b.status='received'"], []
    for key, selected in filters.items():
        if key == exclude or not selected:
            continue
        if key == "receiptDate":
            dates = [value for value in selected if value]
            conditions = []
            if dates:
                conditions.append(
                    "EXISTS (SELECT 1 FROM json_each(d.dates) r "
                    "WHERE r.value IN (" + ",".join("?" for _ in dates) + "))"
                )
            if "" in selected:
                conditions.append("json_array_length(d.dates)=0")
            parts.append("(" + " OR ".join(conditions) + ")")
            values.extend(dates)
            continue
        elif key in ("pi", "owner"):
            parts.append(
                f"EXISTS (SELECT 1 FROM json_each(a.application,'$._{key}People') p "
                f"WHERE p.value IN ({','.join('?' for _ in selected)}))"
            )
        elif key in ("purchaseOrderNo", "orderNo", "batchNo") and conn is not None and members_available(conn):
            member_clause, member_values = member_filter(key, selected, alias="b")
            parts.append(
                f"(CAST(coalesce({FIELDS[key]},'') AS TEXT) IN ({','.join('?' for _ in selected)}) OR {member_clause})"
            )
            values.extend(selected)
            values.extend(member_values)
            continue
        else:
            parts.append(f"CAST(coalesce({FIELDS[key]},'') AS TEXT) IN ({','.join('?' for _ in selected)})")
        values.extend(selected)
    return " AND ".join(parts), values


def page(conn, source, params):
    filters = params["columnFilters"]
    where, values = clause(filters, conn=conn)
    base, join = query_source(dates=bool(filters.get("receiptDate")), projects=project_filters(filters))
    with log_stage("reception_read", "count", component="reception"):
        count = conn.execute(base + "SELECT count(*)" + join + " WHERE " + where, [source["json"], *values]).fetchone()[
            0
        ]
    order = FIELDS.get(params["sortKey"], "b.intake_date")
    if params["sortKey"] == "receiptDate":
        order = "(SELECT max(value) FROM json_each(d.dates))"
    direction = "ASC" if params["sortDir"] == "asc" else "DESC"
    projection = ",".join(f"'{key}',{expr}" for key, expr in FIELDS.items())
    extra = ",".join(
        f"'{key}',json_extract(b.payload,'$.{key}')"
        for key in ("strainRaw", "strainStandard", "specification", "receipts", "species", "intakeDate")
    )
    base, join = query_source(dates=params["sortKey"] == "receiptDate" or bool(filters.get("receiptDate")))
    sql = base + f"SELECT b.id,b.updated_at,a.application,json_object({projection},{extra}) summary" + join
    with log_stage("reception_read", "page", component="reception"):
        rows = conn.execute(
            sql + f" WHERE {where} ORDER BY {order} {direction}, b.id ASC LIMIT ? OFFSET ?",
            [source["json"], *values, params["limit"], params["offset"]],
        ).fetchall()
    return rows, count


def filter_options(conn, source, column, filters):
    where, values = clause(filters, exclude=column, conn=conn)
    base, join = query_source(
        dates=column == "receiptDate" or bool(filters.get("receiptDate")),
        projects=column in ("pi", "owner", "projectMatched") or project_filters(filters),
    )
    if column == "receiptDate":
        sql = base + "SELECT r.value value,count(DISTINCT b.id) count" + join
        sql += " LEFT JOIN json_each(d.dates) r"
        sql += f" WHERE {where} GROUP BY value ORDER BY value"
    elif column in ("purchaseOrderNo", "orderNo", "batchNo") and members_available(conn):
        sql = base + "SELECT coalesce(im.value,'') value,count(DISTINCT b.id) count" + join
        sql += " LEFT JOIN intake_identifier_members im ON im.batch_id=b.id AND im.kind=?"
        sql += f" WHERE {where} GROUP BY value ORDER BY value"
        values = [column, *values]
    else:
        sql = base + f"SELECT coalesce({FIELDS[column]},'') value,count(*) count" + join
        sql += f" WHERE {where} GROUP BY value ORDER BY value"
    items = [
        {"value": str(row["value"] or ""), "label": str(row["value"] or "未填写"), "count": row["count"]}
        for row in conn.execute(sql, [source["json"], *values])
    ]
    return person_options({"personFilterMode": "individual"}, column, items)


def selected(conn, source, ids):
    base, join = query_source(dates=False)
    sql = base + "SELECT b.id,b.updated_at,b.payload,a.application" + join
    sql += " WHERE b.status='received' AND b.id IN (" + ",".join("?" for _ in ids) + ")"
    return conn.execute(sql, [source["json"], *ids]).fetchall()
