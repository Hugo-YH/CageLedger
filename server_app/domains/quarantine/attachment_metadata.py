"""Versioned image associations; file bytes and original upload provenance are retained."""

import copy
import json

from . import repository as repo
from .service import audit, authorize, check_version, now, text


def project_ids(item):
    return item.get("projectIds", [item["projectId"]] if item.get("projectId") else [])


def validate(test, raw, mime):
    ids = raw.get("projectIds", [raw["projectId"]] if raw.get("projectId") else [])
    if isinstance(ids, str):
        try:
            ids = json.loads(ids)
        except json.JSONDecodeError as exc:
            raise ValueError("图片项目关联格式无效") from exc
    if not isinstance(ids, list) or any(not isinstance(i, str) for i in ids):
        raise ValueError("图片项目关联格式无效")
    if set(ids) - {p["id"] for p in test["projects"]}:
        raise ValueError("附件关联项目不存在")
    sample = raw.get("sampleId", "")
    if sample and sample not in {s["id"] for s in test["samples"]}:
        raise ValueError("附件关联样本不存在")
    category = raw.get("category", "原始记录")
    if category not in {"体内", "体外", "原始记录"}:
        raise ValueError("附件分类无效")
    if test["method"] == "parasite" and mime.startswith("image/") and (not sample or category not in {"体内", "体外"}):
        raise ValueError("寄生虫图片请选择样本及体内或体外分类")
    position = raw.get("position", 0)
    if type(position) is not int or not 0 <= position <= 100000:
        raise ValueError("图片顺序无效")
    return {
        "projectIds": list(dict.fromkeys(ids)),
        "projectId": ids[0] if ids else "",
        "sampleId": sample,
        "category": category,
        "caption": text(raw.get("caption", "")),
        "position": position,
    }


def update(conn, user, entity_id, body):
    authorize(user)
    conn.execute("BEGIN IMMEDIATE")
    item = repo.get(conn, "attachments", entity_id)
    test = repo.get(conn, "tests", item["testId"])
    check_version(test, body)
    if test["state"] != "draft":
        raise ValueError("已出具附件不能修改，请创建更正草稿")
    before = copy.deepcopy(item)
    raw = {**item, **body.get("item", {})}
    if "projectIds" not in raw:
        raw["projectIds"] = project_ids(item)
    item.update(validate(test, raw, item["mime"]))
    item["removed"] = bool(body.get("item", {}).get("removed", item.get("removed", False)))
    item["uploadedAt"] = item.get("uploadedAt", item["updatedAt"])
    item.update(updatedAt=now(), updatedBy={"id": user["id"], "name": user["displayName"]})
    repo.save(conn, "attachments", item)
    test["updatedAt"] = now()
    repo.save(conn, "tests", test)
    audit(conn, user, "attachment_removed" if item["removed"] else "attachment_updated", before, item)
    return {"item": item, "test": test}
