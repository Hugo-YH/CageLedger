"""Read persisted workflow documents and their quantity-sheet membership."""

import json


def frozen_workflow_version(conn, month, pi, source_type, statuses, *, source_id="", iacuc=""):
    placeholders = ",".join("?" for _ in statuses)
    scope = "COALESCE(json_extract(w.payload, '$.pi'), '')=?"
    scope_params = [pi]
    iacuc_scope = """(w.iacuc=? OR EXISTS (
        SELECT 1 FROM json_each(w.payload, '$.iacucs') i WHERE i.value=?))"""
    if source_id:
        scope = f"""(
            EXISTS (SELECT 1 FROM json_each(v.payload, '$.statement.sourceIds') s WHERE s.value=?)
            OR json_extract(v.payload, '$.statement.sourceId')=?
            OR (
                COALESCE(json_array_length(v.payload, '$.statement.sourceIds'), 0)=0
                AND COALESCE(json_extract(v.payload, '$.statement.sourceId'), '')=''
                AND {scope} AND {iacuc_scope}
            ))"""
        scope_params = [source_id, source_id, pi, iacuc, iacuc]
    elif iacuc:
        scope = f"{scope} AND {iacuc_scope}" if pi else iacuc_scope
        scope_params = [pi, iacuc, iacuc] if pi else [iacuc, iacuc]
    row = conn.execute(
        f"""SELECT v.payload, v.version_status
            FROM billing_workflows w
            LEFT JOIN billing_statement_versions v ON v.id=w.current_version_id AND v.workflow_id=w.id
            WHERE w.month=? AND w.source_type=?
              AND {scope}
              AND w.workflow_status IN ({placeholders})
            ORDER BY w.latest_event_at DESC, w.id LIMIT 1""",
        [month, source_type, *scope_params, *statuses],
    ).fetchone()
    if row is None:
        return None
    if not row["payload"] or row["version_status"] != "active":
        raise ValueError("已发起流程的结算版本缺失，请核查历史记录")
    return json.loads(row["payload"])


def protected_quantity_sheet_ids(conn, statuses):
    placeholders = ",".join("?" for _ in statuses)
    rows = conn.execute(
        f"""SELECT DISTINCT q.id
            FROM quantity_sheets q
            JOIN billing_workflows w ON w.month=q.month
            LEFT JOIN billing_statement_versions v ON v.id=w.current_version_id AND v.workflow_id=w.id
            WHERE w.source_type IN ('quantity_sheet', 'pi_merged_quantity_sheet')
              AND w.workflow_status IN ({placeholders})
              AND (
                EXISTS (SELECT 1 FROM json_each(v.payload, '$.statement.sourceIds') s WHERE s.value=q.id)
                OR json_extract(v.payload, '$.statement.sourceId')=q.id
                OR (
                  COALESCE(json_array_length(v.payload, '$.statement.sourceIds'), 0)=0
                  AND COALESCE(json_extract(v.payload, '$.statement.sourceId'), '')=''
                  AND q.pi=json_extract(w.payload, '$.pi')
                  AND (
                    COALESCE(json_array_length(w.payload, '$.iacucs'), 0)=0
                    OR EXISTS (SELECT 1 FROM json_each(w.payload, '$.iacucs') i WHERE i.value=q.iacuc)
                  )
                )
              )""",
        list(statuses),
    ).fetchall()
    return {row["id"] for row in rows}
