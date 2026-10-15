"""Administrator-only views of historical reference checks; no scan or repair."""

import json
from collections import Counter

from . import read_repository as repo

CODE_LABELS = {
    "occupancy_missing_slot": "占用笼位关联缺失",
    "placement_missing_batch": "进驻批次关联缺失",
    "placement_missing_receipt": "进驻接收明细关联缺失",
    "duplicate_legacy_qr_alias": "旧二维码别名重复",
    "orphan_settlement_obligation": "历史应收来源缺失",
}
STATUS_LABELS = {"needs_review": "待核对", "retained_history": "保留历史"}
ENTITY_LABELS = {
    "occupancies": "占用记录",
    "placement_tasks": "进驻任务",
    "legacy_qr_alias": "旧二维码别名",
    "reimbursement_settlement_obligations": "结算应收",
}
FIELDS = ("id", "code", "entityType", "entityId", "referenceId", "summary", "reviewStatus")


def authorize(actor):
    if not actor or actor.get("role") != "admin":
        raise PermissionError("仅系统管理员可查看数据核查留档")


def pagination(params, total):
    try:
        limit, offset = int(params.get("limit", 10)), int(params.get("offset", 0))
        if limit < 1 or limit > 100 or offset < 0:
            raise ValueError
    except (ValueError, TypeError) as exc:
        raise ValueError("分页参数无效") from exc
    return {"limit": limit, "offset": offset, "total": total, "hasMore": offset + limit < total}


def metadata(report):
    counts = Counter(item["reviewStatus"] for item in report["findings"])
    by_code = Counter(item["code"] for item in report["findings"])
    return {
        "id": report["scanId"],
        "scannedAt": report["scannedAt"],
        "detectorVersion": report["detectorVersion"],
        "latestBusinessAt": report.get("latestBusinessAt", ""),
        "scope": report.get("scope", ""),
        "trigger": report.get("trigger", "manual"),
        "actorName": (report.get("actor") or {}).get("displayName", "未记录"),
        "sourceSha256": report.get("sourceSha256", ""),
        "sourceSnapshot": report.get("sourceSnapshot"),
        "findingCount": len(report["findings"]),
        "needsReview": counts["needs_review"],
        "retainedHistory": counts["retained_history"],
        "categories": [
            {"value": code, "label": CODE_LABELS.get(code, code), "count": count}
            for code, count in sorted(by_code.items())
        ],
    }


def finding(item):
    return {
        **{key: item[key] for key in FIELDS},
        "codeLabel": CODE_LABELS.get(item["code"], item["code"]),
        "reviewStatusLabel": STATUS_LABELS[item["reviewStatus"]],
        "entityTypeLabel": ENTITY_LABELS.get(item["entityType"], item["entityType"]),
    }


def list_scans(conn, actor, params):
    authorize(actor)
    page = pagination(params, 0)
    rows, total = repo.scan_rows(conn, page["limit"], page["offset"])
    return {
        "items": [metadata(repo.manifest(row)) for row in rows],
        "page": {**page, "total": total, "hasMore": page["offset"] + page["limit"] < total},
    }


def filters(params):
    try:
        value = params.get("columnFilters") or {}
        value = json.loads(value) if isinstance(value, str) else value
        if not isinstance(value, dict) or any(key not in ("code", "reviewStatus") for key in value):
            raise ValueError
        for key, values in value.items():
            if (
                not isinstance(values, list)
                or len(values) > 100
                or any(not isinstance(v, str) or len(v) > 200 for v in values)
            ):
                raise ValueError
            if key == "reviewStatus" and any(v not in STATUS_LABELS for v in values):
                raise ValueError
        return value
    except (ValueError, TypeError) as exc:
        raise ValueError("列筛选参数无效") from exc


def list_issues(conn, actor, scan_id, params):
    authorize(actor)
    report = repo.scan(conn, scan_id)
    selected = filters(params)

    def matches(item, exclude=""):
        return all(key == exclude or not values or item[key] in values for key, values in selected.items())

    items = [item for item in report["findings"] if matches(item)]
    items.sort(key=lambda item: (item["reviewStatus"] != "needs_review", item["code"], item["id"]))
    sort_key, direction = params.get("sortKey"), params.get("sortDir", "asc")
    if sort_key and sort_key not in ("code", "reviewStatus") or direction not in ("asc", "desc"):
        raise ValueError("排序参数无效")
    if sort_key:
        items.sort(key=lambda item: item[sort_key], reverse=direction == "desc")
    page = pagination(params, len(items))
    options = {}
    for key, labels in (("code", CODE_LABELS), ("reviewStatus", STATUS_LABELS)):
        counts = Counter(item[key] for item in report["findings"] if matches(item, key))
        options[key] = [
            {"value": value, "label": labels.get(value, value), "count": count}
            for value, count in sorted(counts.items())
        ]
    return {
        "scan": metadata(report),
        "items": [finding(item) for item in items[page["offset"] : page["offset"] + page["limit"]]],
        "page": page,
        "filterOptions": options,
    }


def get_issue(conn, actor, scan_id, issue_id):
    authorize(actor)
    report = repo.scan(conn, scan_id)
    item = next((item for item in report["findings"] if item["id"] == issue_id), None)
    if not item:
        raise LookupError("该核查留档中不存在此问题")
    value, checksum = repo.evidence(conn, scan_id, issue_id)
    return {"scan": metadata(report), "item": finding(item), "evidence": value, "evidenceSha256": checksum}
