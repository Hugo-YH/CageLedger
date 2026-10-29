"""Bounded, authorized intake detail reads shared by edit and batch-print clients."""

import json

from server_app.domains.intake.repository import get_batch_payload
from server_app.shared.concurrency import StaleWriteError


def read_batch(conn, actor, identity):
    if not actor or not actor.get("id"):
        raise PermissionError("请先登录")
    # Intake read access is shared by signed-in roles, like the legacy state projection.
    item = get_batch_payload(conn, identity)
    if not item:
        raise LookupError("记录不存在")
    return item


def print_data(conn, actor, body):
    if not actor or not actor.get("id"):
        raise PermissionError("请先登录")
    ids = body.get("ids") if isinstance(body, dict) else None
    if (
        not isinstance(ids, list)
        or not ids
        or len(ids) > 200
        or any(not isinstance(i, str) or not i or len(i) > 200 for i in ids)
        or len(set(ids)) != len(ids)
    ):
        raise ValueError("请提供1至200个不重复的批次编号")
    rows = conn.execute(
        f"SELECT id,payload FROM intake_batches WHERE id IN ({','.join('?' for _ in ids)})", ids
    ).fetchall()
    items = {row["id"]: json.loads(row["payload"]) for row in rows}
    if len(items) != len(ids):
        raise LookupError("部分批次已不存在，请刷新列表后重试")
    versions = body.get("expectedVersions")
    if versions is not None:
        if (
            not isinstance(versions, dict)
            or set(versions) != set(ids)
            or any(not isinstance(v, str) for v in versions.values())
        ):
            raise ValueError("请提供所选批次的版本")
        if any(str(items[i].get("updatedAt") or "") != versions[i] for i in ids):
            raise StaleWriteError("所选批次已更新，请刷新列表后重新核对打印内容")
    return {"items": [items[i] for i in ids]}
