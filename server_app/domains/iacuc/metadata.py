"""Read index metadata without decoding database application payloads."""

from server_app.cache import cache_get
from server_app.config import IACUC_INDEX_PATH, LEGACY_IACUC_INDEX_PATH
from server_app.repositories.iacuc import read_iacuc_index


def read_index_status(conn, index_path=IACUC_INDEX_PATH, legacy_path=LEGACY_IACUC_INDEX_PATH):
    cached = cache_get("iacuc_index")
    if cached is not None:
        return {key: cached[key] for key in ("count", "updatedAt", "source")}
    row = conn.execute(
        "SELECT COUNT(*) AS count,MAX(imported_at) AS updated_at FROM experiment_applications"
    ).fetchone()
    if row["count"]:
        return {"count": row["count"], "updatedAt": row["updated_at"], "source": "database"}
    # Legacy file-only installations retain their existing fallback and cache.
    payload = read_iacuc_index(conn, index_path, legacy_path)
    return {key: payload[key] for key in ("count", "updatedAt", "source")}
