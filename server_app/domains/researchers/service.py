"""Preview/confirm contact updates with exact versions, replay protection and atomic audit."""

import hashlib
import json
import secrets

from server_app.domains.administration import audit_event, write_audit_events
from server_app.shared import new_id, now_iso
from server_app.shared.concurrency import StaleWriteError, begin_write, require_exact_version

from . import excel
from . import repository as repo
from .fields import LABELS, empty_fields, normalize_fields


def authorize(actor, *, write=False):
    if not actor:
        raise PermissionError("请先登录")
    if write and actor.get("role") != "admin":
        raise PermissionError("只有系统管理员可以维护实验人员信息")


def prepare(body):
    filename, content, digest = excel.decode_file(body)
    return filename, digest, excel.parse(content)


def plan(conn, prepared):
    filename, digest, rows = prepared
    existing = repo.by_account(conn)
    counts = dict.fromkeys(("created", "updated", "unchanged", "invalid"), 0)
    decisions, versions = [], []
    for row in rows:
        old = existing.get(row["account"].casefold())
        changes = [
            {"field": key, "label": LABELS[key], "before": (old or empty_fields()).get(key, ""), "after": value}
            for key, value in row["values"].items()
            if old is None or old.get(key) != value
        ]
        action = "invalid" if row["errors"] else "create" if old is None else "update" if changes else "unchanged"
        counts[{"create": "created", "update": "updated", "unchanged": "unchanged", "invalid": "invalid"}[action]] += 1
        decisions.append(
            {key: value for key, value in row.items() if key != "values"} | {"action": action, "changes": changes}
        )
        versions.append([row["account"].casefold(), old["id"] if old else None, old["updatedAt"] if old else None])
    token = hashlib.sha256(
        json.dumps([digest, versions], ensure_ascii=False, separators=(",", ":")).encode()
    ).hexdigest()
    return {
        "fileName": filename,
        "total": len(rows),
        "counts": counts,
        "rows": decisions,
        "confirmationToken": token,
        "canImport": not counts["invalid"],
    }, existing


def preview(conn, actor, prepared):
    authorize(actor, write=True)
    return plan(conn, prepared)[0]


def confirm(conn, actor, body, prepared):
    authorize(actor, write=True)
    request_id, token = body.get("requestId"), body.get("confirmationToken")
    if not isinstance(request_id, str) or not 1 <= len(request_id) <= 128 or not isinstance(token, str):
        raise ValueError("请先预览通讯录并确认导入")
    signature = hashlib.sha256(json.dumps([prepared[1], token], separators=(",", ":")).encode()).hexdigest()
    begin_write(conn)
    replay = repo.import_result(conn, actor["id"], request_id)
    if replay:
        if replay[0] != signature:
            raise StaleWriteError("本次导入编号已用于其他内容，请重新预览")
        return {**replay[1], "replayed": True}
    proposed, existing = plan(conn, prepared)
    if not secrets.compare_digest(token, proposed["confirmationToken"]):
        raise StaleWriteError("人员资料已更新，请重新预览后确认导入")
    if not proposed["canImport"]:
        raise ValueError("通讯录存在异常行，请修正后重新上传；本次未写入任何人员")
    at = now_iso()
    events = []
    for source, decision in zip(prepared[2], proposed["rows"], strict=True):
        if decision["action"] == "unchanged":
            continue
        old = existing.get(source["account"].casefold())
        item = {
            **(old or {**empty_fields(), "id": new_id("researcher"), "account": source["account"], "createdAt": at}),
            **source["values"],
            "updatedAt": at,
        }
        repo.put(conn, item)
        events.append(
            audit_event(
                actor,
                "researcher.created" if old is None else "researcher.updated",
                "researcher",
                item["id"],
                f"{actor['displayName']} 导入实验人员 {item['name']}",
                [],
                at,
                old,
                item,
            )
        )
    result = {"total": proposed["total"], "counts": proposed["counts"], "updatedAt": at, "replayed": False}
    events.append(
        audit_event(
            actor,
            "researcher_directory.imported",
            "researcher_import",
            request_id,
            f"{actor['displayName']} 导入实验人员通讯录",
            [],
            at,
            None,
            {"filename": prepared[0], "sha256": prepared[1], "counts": proposed["counts"]},
        )
    )
    write_audit_events(conn, events)
    repo.record_import(conn, actor["id"], request_id, signature, result, at)
    conn.commit()
    return result


def update(conn, actor, researcher_id, body):
    authorize(actor, write=True)
    if not isinstance(body, dict):
        raise ValueError("实验人员资料格式无效")
    fields = normalize_fields(body.get("item"))
    begin_write(conn)
    old = repo.get(conn, researcher_id)
    require_exact_version(old["updatedAt"], body.get("expectedUpdatedAt"), "人员资料已更新，请重新加载并核对后保存")
    if not fields or all(old.get(key) == value for key, value in fields.items()):
        return {"item": old}
    item = {**old, **fields, "updatedAt": now_iso()}
    repo.put(conn, item)
    write_audit_events(
        conn,
        [
            audit_event(
                actor,
                "researcher.updated",
                "researcher",
                item["id"],
                f"{actor['displayName']} 更新实验人员 {item['name']}",
                [],
                item["updatedAt"],
                old,
                item,
            )
        ],
    )
    conn.commit()
    return {"item": item}
