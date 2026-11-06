"""Small, read-only projections for inspection screens and reports."""

import json
from collections import Counter

from .catalog import active_version, ensure_catalog_rows

REVIEW_NOTICE = "巡检标准、图例和建议处置为内部参考资料；医疗与安乐死建议需经兽医和伦理流程确认。"
BODY_REGIONS = {"overall", "fur-skin", "head-neck", "thorax-abdomen", "limbs", "tail", "reproduction-perianal"}


def catalog_header(conn):
    ensure_catalog_rows(conn)
    version = active_version(conn)
    if not version:
        raise RuntimeError("巡检标准目录未初始化")
    row = conn.execute(
        "SELECT payload FROM inspection_catalog_versions WHERE version = ?", (version["version"],)
    ).fetchone()
    return {
        "version": dict(version),
        "modules": json.loads(row["payload"]).get("modules", []),
        "reviewNotice": REVIEW_NOTICE,
    }


def catalog_summary(conn):
    payload = catalog_header(conn)
    # Only presentation ancestry is needed to reproduce the form's item counts.
    nodes = [
        dict(row)
        for row in conn.execute(
            """SELECT code, module_code, parent_id, node_type,
                  json_extract(payload, '$.id') AS id,
                  json_extract(config_json, '$.presentation.region') AS region
           FROM inspection_catalog_nodes WHERE version = ?""",
            (payload["version"]["version"],),
        )
    ]
    by_id = {str(node["id"]): node for node in nodes}
    counts = Counter()
    for node in nodes:
        if node["node_type"] != "ITEM":
            continue
        module = node["module_code"]
        if module == "abnormalAnimalAssessment":
            lineage, seen = [], set()
            parent = by_id.get(str(node["parent_id"]))
            while parent and str(parent["id"]) not in seen:
                seen.add(str(parent["id"]))
                lineage.append(parent)
                parent = by_id.get(str(parent["parent_id"]))
            group = next((item for item in lineage if item["node_type"] == "SUBCATEGORY"), None)
            group = group or next((item for item in lineage if item["node_type"] == "CATEGORY"), None)
            if not group or group["region"] not in BODY_REGIONS:
                continue
        counts[module] += 1
    payload["moduleItemCounts"] = {module["code"]: counts[module["code"]] for module in payload["modules"]}
    return payload


def display_catalog(conn):
    payload = catalog_header(conn)
    payload["nodes"] = [
        {"moduleCode": row["module_code"], "code": row["code"], "name": row["name"]}
        for row in conn.execute(
            """SELECT module_code, code, name FROM inspection_catalog_nodes
               WHERE version = ? ORDER BY module_code, sort_order, code""",
            (payload["version"]["version"],),
        )
    ]
    return payload


def inspection_answers(conn, inspection_id):
    return [
        dict(row) | {"payload": json.loads(row["payload"])}
        for row in conn.execute(
            "SELECT * FROM animal_inspection_answers WHERE inspection_id = ? ORDER BY module_code, node_code",
            (inspection_id,),
        )
    ]


def display_findings(conn, inspection_id):
    return [
        {
            "id": row["id"],
            "nodeCode": row["node_code"],
            "status": row["status"],
            "actionNote": row["action_note"] or "",
            "locationHint": row["location_hint"] or "",
            "recheckDueAt": row["recheck_due_at"] or "",
            "attachmentCount": row["attachment_count"],
        }
        for row in conn.execute(
            """SELECT f.id, f.node_code, f.status, f.action_note, f.location_hint, f.recheck_due_at,
                      (SELECT COUNT(*) FROM animal_inspection_attachments a WHERE a.finding_id = f.id) AS attachment_count
               FROM animal_inspection_findings f WHERE f.inspection_id = ? ORDER BY f.updated_at DESC, f.id""",
            (inspection_id,),
        )
    ]
