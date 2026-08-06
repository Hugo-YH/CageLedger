"""Draft and publish state machine for the animal inspection catalog."""

import json
from datetime import datetime

from server_app.domains.administration import audit_event, write_audit_events
from server_app.shared import clean_text, now_iso
from server_app.shared.concurrency import require_current_version

from .catalog import active_version, version_nodes
from .catalog_schema import validate_catalog

DRAFT_VERSION = "draft"
DRAFT_SOURCE = "CageLedger 巡检标准草稿"


def get_draft(conn, image_root=None):
    """Return the editable draft, cloning the active catalog when none exists."""
    row = _draft_row(conn)
    if row:
        return _draft_payload(conn, row)
    active = active_version(conn)
    if not active:
        raise RuntimeError("巡检标准目录未初始化")
    now = now_iso()
    _clone_version(conn, active["version"], now)
    return _draft_payload(conn, _draft_row(conn))


def save_draft(conn, actor, body, image_root=None):
    """Validate and persist the full draft payload with an optimistic lock."""
    modules = body.get("modules")
    nodes = body.get("nodes")
    validate_catalog(modules, nodes, image_root=image_root)
    row = _draft_row(conn)
    if row:
        require_current_version({"updatedAt": row["imported_at"]}, body.get("expectedUpdatedAt"), "巡检标准草稿")
    now = now_iso()
    if row:
        conn.execute("DELETE FROM inspection_catalog_nodes WHERE version = ?", (DRAFT_VERSION,))
        conn.execute(
            "UPDATE inspection_catalog_versions SET payload = ?, imported_at = ? WHERE version = ?",
            (json.dumps({"modules": modules}, ensure_ascii=False), now, DRAFT_VERSION),
        )
    else:
        conn.execute(
            "INSERT INTO inspection_catalog_versions (version, source, status, imported_at, payload) VALUES (?, ?, 'draft', ?, ?)",
            (DRAFT_VERSION, DRAFT_SOURCE, now, json.dumps({"modules": modules}, ensure_ascii=False)),
        )
    _insert_nodes(conn, DRAFT_VERSION, nodes)
    conn.commit()
    return _draft_payload(conn, _draft_row(conn))


def publish_draft(conn, actor, image_root=None):
    """Publish the draft as a new active version and move the old active to history."""
    row = _draft_row(conn)
    if not row:
        raise LookupError("当前没有巡检标准草稿")
    payload = _draft_payload(conn, row)
    validate_catalog(payload["modules"], payload["nodes"], image_root=image_root)
    active = active_version(conn)
    if not active:
        raise RuntimeError("巡检标准目录未初始化")
    nodes = [
        dict(item)
        for item in conn.execute(
            "SELECT code, module_code, parent_id, node_type, input_type, name, sort_order, config_json, payload "
            "FROM inspection_catalog_nodes WHERE version = ?",
            (DRAFT_VERSION,),
        ).fetchall()
    ]
    now = now_iso()
    version = _next_manual_version(conn, now)
    source = f"用户发布：{clean_text(actor.get('displayName'))}"
    with conn:
        conn.execute(
            "UPDATE inspection_catalog_versions SET status = 'history' WHERE status = 'active' AND version != ?",
            (version,),
        )
        conn.execute(
            "INSERT INTO inspection_catalog_versions (version, source, status, imported_at, payload) VALUES (?, ?, 'active', ?, ?)",
            (version, source, now, json.dumps({"modules": payload["modules"]}, ensure_ascii=False)),
        )
        for node in nodes:
            conn.execute(
                """
                INSERT INTO inspection_catalog_nodes
                  (version, code, module_code, parent_id, node_type, input_type, name, sort_order, config_json, payload)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    version,
                    node["code"],
                    node["module_code"],
                    node["parent_id"],
                    node["node_type"],
                    node["input_type"],
                    node["name"],
                    node["sort_order"],
                    node["config_json"],
                    node["payload"],
                ),
            )
        conn.execute("DELETE FROM inspection_catalog_versions WHERE version = ?", (DRAFT_VERSION,))
        audit = audit_event(
            actor,
            "inspection_catalog.published",
            "inspection_catalog",
            version,
            f"{clean_text(actor.get('displayName'))} 发布巡检标准目录 {version}",
            [],
            now,
            {"version": active["version"]},
            {"version": version, "nodeCount": len(nodes)},
        )
        write_audit_events(conn, [audit])
        conn.commit()
    return _active_catalog_payload(conn, version)


def _draft_row(conn):
    return conn.execute(
        "SELECT version, source, status, imported_at FROM inspection_catalog_versions WHERE version = ?",
        (DRAFT_VERSION,),
    ).fetchone()


def _draft_payload(conn, row):
    modules = json.loads(
        conn.execute("SELECT payload FROM inspection_catalog_versions WHERE version = ?", (row["version"],)).fetchone()[
            "payload"
        ]
    ).get("modules", [])
    return {
        "version": {**dict(row), "updatedAt": row["imported_at"]},
        "modules": modules,
        "nodes": version_nodes(conn, row["version"]),
        "hasDraft": _has_draft_changes(conn, modules, row["version"]),
        "active": _active_baseline(conn),
    }


def _active_baseline(conn):
    active = active_version(conn)
    if not active:
        return {"version": None, "modules": [], "nodes": []}
    payload = conn.execute(
        "SELECT payload FROM inspection_catalog_versions WHERE version = ?", (active["version"],)
    ).fetchone()
    modules = json.loads(payload["payload"]).get("modules", []) if payload else []
    return {"version": dict(active), "modules": modules, "nodes": version_nodes(conn, active["version"])}


def _has_draft_changes(conn, draft_modules, draft_version):
    active = active_version(conn)
    if not active:
        return True
    active_payload = conn.execute(
        "SELECT payload FROM inspection_catalog_versions WHERE version = ?", (active["version"],)
    ).fetchone()
    active_modules = json.loads(active_payload["payload"]).get("modules", []) if active_payload else []
    return json.dumps(active_modules, sort_keys=True) != json.dumps(draft_modules, sort_keys=True) or json.dumps(
        version_nodes(conn, active["version"]), sort_keys=True
    ) != json.dumps(version_nodes(conn, draft_version), sort_keys=True)


def _clone_version(conn, source_version, now):
    source = conn.execute(
        "SELECT payload FROM inspection_catalog_versions WHERE version = ?", (source_version,)
    ).fetchone()
    conn.execute(
        "INSERT INTO inspection_catalog_versions (version, source, status, imported_at, payload) VALUES (?, ?, 'draft', ?, ?)",
        (DRAFT_VERSION, DRAFT_SOURCE, now, source["payload"]),
    )
    rows = conn.execute(
        "SELECT code, module_code, parent_id, node_type, input_type, name, sort_order, config_json, payload "
        "FROM inspection_catalog_nodes WHERE version = ?",
        (source_version,),
    ).fetchall()
    for row in rows:
        conn.execute(
            """
            INSERT INTO inspection_catalog_nodes
              (version, code, module_code, parent_id, node_type, input_type, name, sort_order, config_json, payload)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                DRAFT_VERSION,
                row["code"],
                row["module_code"],
                row["parent_id"],
                row["node_type"],
                row["input_type"],
                row["name"],
                row["sort_order"],
                row["config_json"],
                row["payload"],
            ),
        )
    conn.commit()


def _insert_nodes(conn, version, nodes):
    for node in nodes:
        config = json.dumps(node.get("config") or {}, ensure_ascii=False)
        conn.execute(
            """
            INSERT INTO inspection_catalog_nodes
              (version, code, module_code, parent_id, node_type, input_type, name, sort_order, config_json, payload)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                version,
                clean_text(node.get("code")),
                clean_text(node.get("moduleCode")),
                clean_text(node.get("parentId") or ""),
                clean_text(node.get("nodeType")),
                clean_text(node.get("inputType") or ""),
                clean_text(node.get("name")),
                int(node.get("sortOrder") or 0),
                config,
                json.dumps(node, ensure_ascii=False),
            ),
        )


def _next_manual_version(conn, now):
    base = datetime.now().strftime("%Y%m%d-%H%M")
    version = f"manual-{base}"
    if not conn.execute("SELECT 1 FROM inspection_catalog_versions WHERE version = ?", (version,)).fetchone():
        return version
    seconds = datetime.now().strftime("%Y%m%d-%H%M%S")
    candidate = f"manual-{seconds}"
    suffix = 2
    while conn.execute("SELECT 1 FROM inspection_catalog_versions WHERE version = ?", (candidate,)).fetchone():
        candidate = f"manual-{seconds}-{suffix}"
        suffix += 1
    return candidate


def _active_catalog_payload(conn, version):
    row = conn.execute(
        "SELECT version, source, status, imported_at FROM inspection_catalog_versions WHERE version = ?", (version,)
    ).fetchone()
    modules = json.loads(
        conn.execute("SELECT payload FROM inspection_catalog_versions WHERE version = ?", (version,)).fetchone()[
            "payload"
        ]
    ).get("modules", [])
    return {
        "version": dict(row),
        "modules": modules,
        "nodes": version_nodes(conn, version),
    }


def list_catalog_versions(conn):
    """Return all catalog versions with metadata, newest first."""
    effective_active = active_version(conn)
    effective_version = effective_active["version"] if effective_active else None
    rows = conn.execute(
        """
        SELECT v.version, v.source, v.status, v.imported_at,
               (SELECT COUNT(*) FROM inspection_catalog_nodes n WHERE n.version = v.version) AS node_count
        FROM inspection_catalog_versions v
        WHERE v.version != ?
        ORDER BY v.imported_at DESC, v.version DESC
        """,
        (DRAFT_VERSION,),
    ).fetchall()
    return {
        "items": [
            {
                "version": row["version"],
                "source": row["source"],
                "status": row["status"],
                "importedAt": row["imported_at"],
                "nodeCount": row["node_count"],
                "isActive": row["version"] == effective_version,
            }
            for row in rows
        ]
    }


def get_catalog_version(conn, version):
    """Return one version's full payload for review (admin-only callers)."""
    row = conn.execute(
        "SELECT version, source, status, imported_at FROM inspection_catalog_versions WHERE version = ?",
        (version,),
    ).fetchone()
    if not row:
        raise LookupError("目录版本不存在")
    payload = conn.execute("SELECT payload FROM inspection_catalog_versions WHERE version = ?", (version,)).fetchone()
    modules = json.loads(payload["payload"]).get("modules", []) if payload else []
    return {"version": dict(row), "modules": modules, "nodes": version_nodes(conn, version)}


def restore_catalog_version(conn, actor, source_version, image_root=None):
    """Publish a historical version's content as a new active version."""
    source = conn.execute(
        "SELECT version, source, imported_at, payload FROM inspection_catalog_versions WHERE version = ?",
        (source_version,),
    ).fetchone()
    if not source:
        raise LookupError("目录版本不存在")
    active = active_version(conn)
    if active and active["version"] == source_version:
        raise ValueError("该版本已是当前生效版本")
    modules = json.loads(source["payload"]).get("modules", [])
    nodes = version_nodes(conn, source_version)
    validate_catalog(modules, nodes, image_root=image_root)
    now = now_iso()
    version = _next_manual_version(conn, now)
    actor_name = clean_text(actor.get("displayName"))
    with conn:
        conn.execute(
            "UPDATE inspection_catalog_versions SET status = 'history' WHERE status = 'active' AND version != ?",
            (version,),
        )
        conn.execute(
            "INSERT INTO inspection_catalog_versions (version, source, status, imported_at, payload) VALUES (?, ?, 'active', ?, ?)",
            (
                version,
                f"回滚自 {source['version']}：{actor_name}",
                now,
                json.dumps({"modules": modules}, ensure_ascii=False),
            ),
        )
        _insert_nodes(conn, version, nodes)
        audit = audit_event(
            actor,
            "inspection_catalog.restored",
            "inspection_catalog",
            version,
            f"{actor_name} 将目录回滚到 {source['version']} 并发布为 {version}",
            [],
            now,
            {"source": source["version"], "previousActive": active["version"] if active else None},
            {"version": version, "nodeCount": len(nodes)},
        )
        write_audit_events(conn, [audit])
        conn.commit()
    return _active_catalog_payload(conn, version)
