import json
from datetime import date

from server_app.domains.intake.strain_standard import standardize_strain, supplier_full_name
from server_app.shared.concurrency import StaleWriteError
from server_app.shared.intake_identifiers import intake_identifier_key

from . import repository


def text(value):
    return str(value).strip() if value is not None else ""


def valid_date(value):
    try:
        return date.fromisoformat(text(value)).isoformat()
    except ValueError:
        return ""


def authorize(actor):
    if not actor or not actor.get("id"):
        raise PermissionError("请先登录")


def parameters(query):
    try:
        limit, offset = int(query.get("limit", ["10"])[0]), int(query.get("offset", ["0"])[0])
        filters = json.loads(query.get("columnFilters", ["{}"])[0])
    except (ValueError, TypeError) as exc:
        raise ValueError("接收列表查询参数无效") from exc
    if not 1 <= limit <= 100 or offset < 0 or not isinstance(filters, dict):
        raise ValueError("接收列表分页或筛选参数无效")
    allowed = set(repository.FIELDS) | {"receiptDate"}
    if any(
        key not in allowed
        or not isinstance(values, list)
        or len(values) > 500
        or any(not isinstance(value, str) or len(value) > 500 for value in values)
        for key, values in filters.items()
    ):
        raise ValueError("接收列表筛选无效")
    sort = query.get("sortKey", ["receiptDate"])[0]
    direction = query.get("sortDir", ["desc"])[0]
    if sort not in allowed or direction not in ("asc", "desc"):
        raise ValueError("接收列表排序无效")
    return {"limit": limit, "offset": offset, "columnFilters": filters, "sortKey": sort, "sortDir": direction}


def record(row, source, *, complete=False):
    batch = json.loads(row["payload"] if complete else row["summary"])
    application = json.loads(row["application"]) if row["application"] else {}
    receipts = batch.get("receipts") or []
    dates = sorted(
        {
            value
            for entry in receipts
            if isinstance(entry, dict) and (value := valid_date(entry.get("actualReceiptDate")))
        }
    )
    warnings = []
    if not application:
        warnings.append("伦理号未唯一匹配实验申请汇总表，项目字段未匹配，导出标记待补充")
    else:
        missing = [
            label
            for key, label in (
                ("project", "项目名称"),
                ("pi", "项目负责人"),
                ("owner", "实验负责人"),
                ("funding", "项目来源"),
                ("projectEndDate", "伦理有效期"),
            )
            if not text(application.get(key))
        ]
        if missing:
            warnings.append("实验申请汇总表缺少：" + "、".join(missing))
    if not dates:
        warnings.append("未记录实际接收日期，导出标记待补充，不使用预约日期代替")
    elif len(dates) > 1:
        warnings.append("存在多次接收日期，缺少各次实际只数；不分摊数量，导出接收时间标记待补充")
    warnings.append("数量、性别、规格来自预约预填，需核对实际到货；合格证资料待补录")
    item = {
        key: text(application.get(key)) for key in ("pi", "owner", "project", "funding", "fundCode", "projectEndDate")
    }
    item.update(
        {
            key: text(batch.get(key))
            for key in ("batchNo", "purchaseOrderNo", "iacuc", "sex", "roomName", "supplier", "specification")
        }
    )
    item.update(
        {
            "id": row["id"],
            "batchId": row["id"],
            "updatedAt": row["updated_at"],
            "strain": text(batch.get("strainStandard")) or standardize_strain(text(batch.get("strainRaw"))),
            "quantity": batch.get("quantity"),
            "receiptDates": dates,
            "projectMatched": bool(application),
            "warnings": warnings,
            "source": {
                "batchUpdatedAt": row["updated_at"],
                "applicationUpdatedAt": source["updatedAt"],
                "applicationSource": source["source"],
            },
        }
    )
    return item


def list_records(conn, actor, query):
    authorize(actor)
    params = parameters(query)
    source = repository.context(conn)
    rows, total = repository.page(conn, source, params)
    return {
        "items": [record(row, source) for row in rows],
        "applicationVersion": source["version"],
        "page": {
            "limit": params["limit"],
            "offset": params["offset"],
            "total": total,
            "hasMore": params["offset"] + params["limit"] < total,
        },
    }


def options(conn, actor, query):
    authorize(actor)
    params = parameters(query)
    column = query.get("column", [""])[0]
    if column not in set(repository.FIELDS) | {"receiptDate"}:
        raise ValueError("接收列表筛选列无效")
    return {"items": repository.filter_options(conn, repository.context(conn), column, params["columnFilters"])}


def registration_lines(item, batch):
    strain = item["strain"]
    species = text(batch.get("species")).lower()
    grade = "SPF" if species in ("mouse", "rat", "小鼠", "大鼠") else "普通级" if species else ""
    supplier, supplier_verified = supplier_full_name(item["supplier"])
    if not strain:
        item["warnings"].append("未获取标准化品系，导出具体品系标记待补充")
    if not supplier_verified:
        item["warnings"].append(
            "供应商全称未在目录中唯一核实，保留原名称并请核对" if supplier else "供应商全称缺失或有歧义，导出标记待补充"
        )
    sexes = [(item["sex"], item["quantity"])]
    if "雌" in item["sex"] and "雄" in item["sex"]:
        candidates = set()
        evidence = batch.get("recognition")
        for source in evidence.get("sources", []) if isinstance(evidence, dict) else []:
            if not isinstance(source, dict) or source.get("kind") != "husbandry":
                continue
            if source.get("batchNo") and intake_identifier_key(source["batchNo"], batch=True) != intake_identifier_key(
                batch.get("batchNo"), batch=True
            ):
                continue
            if source.get("iacuc") and text(source["iacuc"]).upper() != text(batch.get("iacuc")).upper():
                continue
            male, female = source.get("maleQuantity"), source.get("femaleQuantity")
            if all(type(n) is int and n >= 0 for n in (male, female)) and male + female == item["quantity"]:
                candidates.add((male, female))
        if len(candidates) == 1:
            male, female = candidates.pop()
            sexes = [(sex, count) for sex, count in (("雄性", male), ("雌性", female)) if count]
        else:
            item["warnings"].append("雌雄数量无法唯一确认，保留原性别与总量，请勿据此视为已拆分明细")
    return [
        {
            "batchId": item["id"],
            "receiptId": None,
            "registrationId": None,
            "project": {
                key: item[key] for key in ("iacuc", "pi", "owner", "project", "funding", "fundCode", "projectEndDate")
            },
            "source": item["source"],
            "purchaseOrderNo": item["purchaseOrderNo"],
            "batchNo": item["batchNo"],
            "actualReceiptDate": item["receiptDates"][0] if len(item["receiptDates"]) == 1 else "",
            "strain": strain,
            "specification": item["specification"],
            "sex": sex,
            "quantity": quantity,
            "quantitySource": "reservation_prefill",
            "supplier": supplier,
            "roomName": item["roomName"],
            "certificateStrain": "",
            "grade": grade,
            "qualityCertificateNo": "",
            "experimentCertificateNo": "",
            "notes": text(batch.get("notes")),
            "warnings": list(item["warnings"]),
        }
        for sex, quantity in sexes
    ]


def preview(conn, actor, body):
    authorize(actor)
    ids = body.get("ids") if isinstance(body, dict) else None
    if (
        not isinstance(ids, list)
        or not 1 <= len(ids) <= 200
        or any(not isinstance(i, str) or not i or len(i) > 200 for i in ids)
        or len(set(ids)) != len(ids)
    ):
        raise ValueError("请选择1至200个不重复的已接收批次")
    versions = body.get("expectedVersions")
    if (
        not isinstance(versions, dict)
        or set(versions) != set(ids)
        or any(not isinstance(v, str) for v in versions.values())
    ):
        raise ValueError("请提供所选批次的版本")
    source = repository.context(conn)
    if body.get("expectedApplicationVersion") != source["version"]:
        raise StaleWriteError("实验申请汇总表已更新，请刷新接收列表后重新导出")
    rows = {row["id"]: row for row in repository.selected(conn, source, ids)}
    if len(rows) != len(ids) or any(rows[i]["updated_at"] != versions[i] for i in ids):
        raise StaleWriteError("所选批次已变更或不再是已接收状态，请刷新列表后重新选择")
    items, lines = [], []
    for identity in ids:
        row = rows[identity]
        item = record(row, source, complete=True)
        lines.extend(registration_lines(item, json.loads(row["payload"])))
        items.append(item)
    return {
        "items": items,
        "rows": lines,
        "rowCount": len(lines),
        "applicationVersion": source["version"],
        "warnings": [f"{item['batchNo'] or item['id']}：{warning}" for item in items for warning in item["warnings"]],
    }
