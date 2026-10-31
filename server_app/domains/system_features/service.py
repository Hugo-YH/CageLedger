"""Versioned administrator changes and their audit, limited to display preferences."""

import json

from server_app.domains.administration.audit import audit_event, write_audit_events
from server_app.shared.concurrency import StaleWriteError, begin_write
from server_app.shared.time import now_iso

from . import repository as repo

MODULES = {
    "intake": "笼卡管理",
    "reception": "接收管理",
    "quarantine": "检疫管理",
    "cages": "笼位管理",
    "animal": "动物管理",
    "billing": "饲养费管理",
    "technical-services": "技术服务费管理",
    "settlement": "结算管理",
}


def authorize(actor, *, write=False):
    if not actor or not actor.get("id"):
        raise PermissionError("请先登录")
    if write and actor.get("role") != "admin":
        raise PermissionError("仅系统管理员可修改系统功能")


def enabled_values(value, *, reception_default=True):
    if (
        not isinstance(value, dict)
        or set(value) not in (set(MODULES), set(MODULES) - {"reception"})
        or any(type(v) is not bool for v in value.values())
    ):
        raise ValueError("请完整提供系统功能的布尔开关")
    return {key: value.get(key, reception_default) for key in MODULES}


def read(conn, actor):
    authorize(actor)
    row = repo.read(conn)
    if not row:
        return {"enabled": dict.fromkeys(MODULES, True), "updatedAt": None}
    return {"enabled": enabled_values(json.loads(row["enabled_json"])), "updatedAt": row["updated_at"]}


def save(conn, actor, body):
    authorize(actor, write=True)
    if not isinstance(body, dict):
        raise ValueError("系统功能配置格式无效")
    enabled_values(body.get("enabled"))
    begin_write(conn)
    before = read(conn, actor)
    enabled = enabled_values(body.get("enabled"), reception_default=before["enabled"]["reception"])
    if "expectedUpdatedAt" not in body or body["expectedUpdatedAt"] != before["updatedAt"]:
        raise StaleWriteError("系统功能已被其他管理员更新，请刷新后重新设置")
    if before["enabled"] == enabled:
        return before
    after = {"enabled": enabled, "updatedAt": now_iso()}
    repo.put(conn, enabled, after["updatedAt"])
    changes = [
        f"{'开启' if enabled[key] else '隐藏'}{label}"
        for key, label in MODULES.items()
        if before["enabled"][key] != enabled[key]
    ]
    write_audit_events(
        conn,
        [
            audit_event(
                actor,
                "system_features.updated",
                "system_features",
                "default",
                f"{actor['displayName']} 更新系统功能入口：{'；'.join(changes)}",
                [],
                after["updatedAt"],
                before,
                after,
            )
        ],
    )
    return after
