"""Versioned internal inspection catalog sourced from the approved reference export."""

import json
from pathlib import Path

from server_app.config import ANIMAL_INSPECTION_CATALOG_PATH
from server_app.shared import clean_text, now_iso

CATALOG_VERSION = "cageledger-v1-20260805"
CATALOG_SOURCE = "CageLedger 内部维护 2026-08-05"


def load_catalog(path: Path = ANIMAL_INSPECTION_CATALOG_PATH):
    modules_payload = json.loads((path / "assessment-modules.json").read_text(encoding="utf-8"))
    modules = list(modules_payload.get("modules") or [])
    nodes = json.loads((path / "assessment-nodes.json").read_text(encoding="utf-8"))
    return {"version": CATALOG_VERSION, "source": CATALOG_SOURCE, "modules": modules, "nodes": nodes}


def ensure_catalog_rows(conn):
    exists = conn.execute("SELECT 1 FROM inspection_catalog_versions WHERE version = ?", (CATALOG_VERSION,)).fetchone()
    if exists:
        return CATALOG_VERSION
    catalog = load_catalog()
    imported_at = now_iso()
    conn.execute(
        "INSERT INTO inspection_catalog_versions (version, source, status, imported_at, payload) VALUES (?, ?, 'active', ?, ?)",
        (CATALOG_VERSION, CATALOG_SOURCE, imported_at, json.dumps({"modules": catalog["modules"]}, ensure_ascii=False)),
    )
    module_by_id = {str(item.get("id")): clean_text(item.get("code")) for item in catalog["modules"]}
    for node in catalog["nodes"]:
        code = clean_text(node.get("code"))
        if not code:
            continue
        config = dict(node.get("config") or {})
        conn.execute(
            """
            INSERT INTO inspection_catalog_nodes
              (version, code, module_code, parent_id, node_type, input_type, name, sort_order, config_json, payload)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                CATALOG_VERSION,
                code,
                module_by_id.get(str(node.get("moduleId")), ""),
                str(node.get("parentId") or ""),
                clean_text(node.get("nodeType")),
                clean_text(node.get("inputType")),
                clean_text(node.get("name")),
                int(node.get("sortOrder") or 0),
                json.dumps(config, ensure_ascii=False),
                json.dumps(node, ensure_ascii=False),
            ),
        )
    return CATALOG_VERSION


def catalog_payload(conn):
    ensure_catalog_rows(conn)
    version = active_version(conn)
    if not version:
        raise RuntimeError("巡检标准目录未初始化")
    version_payload = conn.execute(
        "SELECT payload FROM inspection_catalog_versions WHERE version = ?", (version["version"],)
    ).fetchone()
    modules = json.loads(version_payload["payload"]).get("modules", []) if version_payload else []
    return {
        "version": dict(version),
        "modules": modules,
        "nodes": version_nodes(conn, version["version"]),
    }


def active_version(conn):
    return conn.execute(
        "SELECT version, source, status, imported_at FROM inspection_catalog_versions WHERE status = 'active' ORDER BY imported_at DESC LIMIT 1"
    ).fetchone()


def version_nodes(conn, version):
    rows = conn.execute(
        """SELECT code, module_code, parent_id, node_type, input_type, name, sort_order, config_json, payload
           FROM inspection_catalog_nodes WHERE version = ? ORDER BY module_code, sort_order, code""",
        (version,),
    ).fetchall()
    return [
        {
            **json.loads(row["payload"]),
            "code": row["code"],
            "moduleCode": row["module_code"],
            "parentId": row["parent_id"],
            "nodeType": row["node_type"],
            "inputType": row["input_type"],
            "name": row["name"],
            "sortOrder": row["sort_order"],
            "config": json.loads(row["config_json"]),
        }
        for row in rows
    ]
