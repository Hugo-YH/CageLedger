"""Read persisted attachment references without importing or mutating the app."""

import json
from urllib.parse import quote, unquote, urlsplit

from scripts.database_review.storage import quote as sql_quote

from .files import relative_path


def references(conn):
    tables = {row[0] for row in conn.execute("SELECT name FROM sqlite_master WHERE type='table'")}
    result, remote = [], []

    def rows(table):
        return conn.execute(f"SELECT * FROM {sql_quote(table)}") if table in tables else []

    def add(kind, identity, parts, endpoint=None, *, size=None, sha=None, conversion=False):
        # Each stored component is a single name, never an absolute path.
        for part in parts:
            if "/" in str(part):
                raise ValueError("数据库附件名称不能包含目录")
            relative_path(part)
        path = "/".join(str(part) for part in parts)
        result.append(
            {
                "kind": kind,
                "id": identity,
                "path": path,
                "endpoint": endpoint,
                "size": size,
                "sha256": sha,
                "conversion": conversion,
            }
        )

    for table, kind, folder, owner, endpoint in (
        (
            "reimbursement_claim_attachments",
            "reimbursement",
            ["reimbursements", "attachments"],
            "claim_id",
            "/api/reimbursement-ledger/attachments/",
        ),
        (
            "billing_workflow_attachments",
            "workflow",
            ["reimbursements", "attachments", "workflows"],
            "workflow_id",
            "/api/billing-workflows/attachments/",
        ),
        (
            "animal_inspection_attachments",
            "inspection",
            ["animal-inspections", "attachments"],
            "inspection_id",
            "/api/animal-inspection-attachments/",
        ),
    ):
        for row in rows(table):
            add(
                kind,
                row["id"],
                [*folder, row[owner], row["stored_name"]],
                endpoint + quote(row["id"], safe=""),
                size=row["size_bytes"],
                sha=row["sha256"] if "sha256" in row.keys() else None,
            )

    for row in rows("feedback_attachments"):
        if row["source"] == "gitea":
            remote.append({"kind": "feedback", "id": row["id"], "reason": "远端附件需原Gitea服务；离线演练不请求远端"})
        if row["storage_name"]:
            endpoint = None
            if row["source"] != "gitea" and row["visible"]:
                parent = conn.execute("SELECT status FROM feedback WHERE id=?", (row["feedback_id"],)).fetchone()
                comment = conn.execute(
                    "SELECT visible FROM feedback_comments WHERE id=?", (row["comment_id"],)
                ).fetchone()
                if parent and parent[0] != "deleted" and (not row["comment_id"] or comment and comment[0]):
                    endpoint = "/api/feedback/attachments/" + quote(row["id"], safe="")
            add("feedback", row["id"], ["feedback", row["storage_name"]], endpoint, size=row["size"])
        elif row["source"] != "gitea":
            raise ValueError("本地反馈附件缺少存储名称")

    for table in ("quarantine_attachments", "quarantine_reports"):
        for row in rows(table):
            item = json.loads(row["payload"])
            category = "reports" if table.endswith("reports") else "attachments"
            endpoint = None if item.get("removed") else f"/api/quarantine/{category}/" + quote(row["id"], safe="")
            add(
                "quarantine-" + category,
                row["id"],
                ["quarantine", item["storageName"]],
                endpoint,
                size=item.get("size"),
                sha=item.get("sha256"),
                conversion=category == "reports" and item["storageName"].lower().endswith(".docx"),
            )
            if item.get("previewStorageName"):
                add(
                    "quarantine-preview",
                    row["id"],
                    ["quarantine", item["previewStorageName"]],
                    endpoint + "?preview=1" if endpoint else None,
                )

    seen_images = set()

    def images(config):
        for item in config.get("referenceImages", []):
            # The real protected-image endpoint resolves all versions by filename.
            name = unquote(urlsplit(item["url"]).path.rsplit("/", 1)[-1])
            if name not in seen_images:
                add(
                    "catalog-image",
                    name,
                    ["animal-inspections", "reference-images", name],
                    "/api/animal-inspection-reference/" + quote(name, safe=""),
                )
                seen_images.add(name)

    for row in rows("inspection_catalog_nodes"):
        images(json.loads(row["config_json"]))
    for row in rows("inspection_catalog_versions"):
        for node in json.loads(row["payload"]).get("nodes", []):
            images(node.get("config") or {})
    return {"local": result, "remote": remote}


def validate_references(refs, manifest):
    issues = []
    for item in refs["local"]:
        fact = manifest["files"].get(item["path"])
        reason = None
        if fact is None:
            reason = "missing_file"
        elif item["size"] is not None and fact["bytes"] != item["size"]:
            reason = "size_mismatch"
        elif item["sha256"] and fact["sha256"] != item["sha256"]:
            reason = "sha256_mismatch"
        if reason:
            issues.append({"kind": item["kind"], "id": item["id"], "path": item["path"], "reason": reason})
    return issues
