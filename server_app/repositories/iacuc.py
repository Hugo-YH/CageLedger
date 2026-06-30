import json
from datetime import UTC, datetime

from server_app.cache import cache_get, cache_set, invalidate_data_cache, invalidate_data_cache_prefixes

from .payload import dump_json


def read_iacuc_index(conn, iacuc_index_path, legacy_iacuc_index_path):
    cached = cache_get("iacuc_index")
    if cached is not None:
        return cached

    rows = conn.execute("SELECT payload, imported_at FROM experiment_applications ORDER BY rowid").fetchall()
    if rows:
        items = [json.loads(row["payload"]) for row in rows]
        updated_at = max(row["imported_at"] for row in rows)
        return cache_set(
            "iacuc_index",
            {
                "items": items,
                "count": len(items),
                "updatedAt": updated_at,
                "source": "database",
            },
        )

    path = iacuc_index_path if iacuc_index_path.exists() else legacy_iacuc_index_path
    if not path.exists():
        return cache_set("iacuc_index", {"items": [], "count": 0, "updatedAt": None, "source": None})

    items = json.loads(path.read_text(encoding="utf-8"))
    stat = path.stat()
    return cache_set(
        "iacuc_index",
        {
            "items": items,
            "count": len(items),
            "updatedAt": datetime.fromtimestamp(stat.st_mtime, UTC).isoformat(),
            "source": "data" if path == iacuc_index_path else "legacy",
        },
    )


def replace_experiment_applications(conn, items, imported_at, application_payload):
    conn.execute("DELETE FROM experiment_applications")
    for index, item in enumerate(items, start=1):
        normalized = application_payload(item, imported_at)
        conn.execute(
            """
            INSERT INTO experiment_applications (
                id, iacuc, raw_iacuc, project, pi, owner, funding, imported_at, payload
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                normalized.get("id") or f"app-{index:06d}",
                normalized["iacuc"],
                normalized.get("rawIacuc", ""),
                normalized.get("project", ""),
                normalized.get("pi", ""),
                normalized.get("owner", ""),
                normalized.get("funding", ""),
                imported_at,
                dump_json(normalized),
            ),
        )
    invalidate_data_cache("iacuc_index", "principal_identities")
    invalidate_data_cache_prefixes("quantity_sheets::", "billing_workflows::")


def save_iacuc_index_file(iacuc_index_path, items):
    iacuc_index_path.parent.mkdir(parents=True, exist_ok=True)
    iacuc_index_path.write_text(json.dumps(items, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
