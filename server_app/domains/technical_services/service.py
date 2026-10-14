"""Versioned service-sheet writes with audit and transaction ownership."""

import hashlib
import json
import re

from server_app.domains.administration import audit_event, write_audit_events
from server_app.domains.iacuc import normalize_iacuc_number
from server_app.domains.state.persistence import read_applications_by_iacuc
from server_app.shared import clean_text, now_iso
from server_app.shared.concurrency import StaleWriteError

from . import repository as repo
from .rules import daily_rows, money_sum, validate_month


def authorize(actor):
    if not actor or actor.get("role") not in ("admin", "room_admin"):
        raise PermissionError("请使用管理员或房间管理员账号")


def audit(conn, actor, action, before, after):
    item = after or before
    write_audit_events(
        conn,
        [
            audit_event(
                actor,
                f"technical_service.{action}",
                "technical_service_sheet",
                item["id"],
                f"{actor['displayName']} {action}技术服务明细 {item['iacuc']}",
                [],
                now_iso(),
                before,
                after,
            )
        ],
    )


def save(conn, actor, payload, identity=None):
    authorize(actor)
    source = payload.get("sheet")
    if not isinstance(source, dict):
        raise ValueError("请提供技术服务明细")
    raw_id = identity or source.get("id")
    key = clean_text(raw_id)
    if not isinstance(raw_id, str) or not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_.-]{0,99}", key):
        raise ValueError("请提供有效的草稿ID")
    signature = hashlib.sha256(
        json.dumps(source, sort_keys=True, ensure_ascii=False, allow_nan=False).encode()
    ).hexdigest()
    conn.execute("BEGIN IMMEDIATE")
    previous = None
    if identity:
        existing, previous = repo.get(conn, key)
        repo.require_version(existing, payload.get("expectedUpdatedAt"))
        if key in repo.protected_ids(conn):
            raise ValueError("技术服务明细已发起结算，请先撤回对应流程")
    else:
        existing = conn.execute("SELECT * FROM technical_service_sheets WHERE id=?", (key,)).fetchone()
        if existing:
            if (
                existing["deleted"]
                or existing["creation_signature"] != signature
                or existing["created_by"] != actor["id"]
            ):
                raise StaleWriteError("草稿ID已被使用，请刷新后查看已有记录")
            return {"item": json.loads(existing["payload"])}
    month = validate_month(source.get("month"))
    iacuc = normalize_iacuc_number(source.get("iacuc", ""))
    application = read_applications_by_iacuc(conn).get(iacuc)
    if not application or not clean_text(application.get("pi")):
        raise ValueError("请匹配有效IACUC及项目负责人")
    facility = source.get("facility")
    customer = source.get("customerType")
    if facility not in ("zhujiang", "bioisland") or customer not in ("internal", "external"):
        raise ValueError("请选择服务设施及院内／院外类别")
    service_id = source.get("serviceId")
    reuse_price = previous and previous["serviceId"] == service_id and previous["customerType"] == customer
    selected = (
        previous["priceSnapshot"]
        if reuse_price
        else next((item for item in repo.catalog(conn) if item["id"] == service_id), None)
    )
    if not selected:
        raise ValueError("请选择有效技术服务项目")
    price = selected["externalPrice"] if customer == "external" else selected["internalPrice"]
    rows = daily_rows(source.get("rows"), month, selected["unit"], price)
    keep_project = previous and previous["iacuc"] == iacuc
    project = previous if keep_project else application
    item = {
        "id": key,
        "month": month,
        "iacuc": iacuc,
        "facility": facility,
        "customerType": customer,
        "serviceId": service_id,
        "serviceName": selected["name"],
        "unit": selected["unit"],
        "unitPrice": price,
        "priceSnapshot": selected,
        "rows": rows,
        "totalAmount": money_sum(rows),
        "serviceDayCount": sum(r["quantity"] > 0 for r in rows),
        "totalQuantity": sum(r["quantity"] for r in rows),
        "manager": actor["displayName"],
        "createdBy": previous["createdBy"] if previous else actor["id"],
        "updatedAt": now_iso(),
        "notes": clean_text(source.get("notes", "")),
    }
    item.update(
        {field: clean_text(project.get(field, "")) for field in ("pi", "project", "owner", "funding", "contact")}
    )
    duplicate = conn.execute(
        """SELECT id FROM technical_service_sheets
        WHERE month=? AND iacuc=? AND facility=? AND service_id=? AND customer_type=? AND deleted=0 AND id<>?""",
        (month, iacuc, facility, service_id, customer, key),
    ).fetchone()
    if duplicate:
        raise StaleWriteError("相同月份、伦理、设施和服务已有明细，请在已保存列表中编辑")
    repo.put(conn, item, signature, actor["id"])
    audit(conn, actor, "updated" if previous else "created", previous, item)
    return {"item": item}


def delete(conn, actor, identity, expected):
    authorize(actor)
    conn.execute("BEGIN IMMEDIATE")
    row, item = repo.get(conn, identity)
    repo.require_version(row, expected)
    if identity in repo.protected_ids(conn):
        raise ValueError("技术服务明细已发起结算，请先撤回对应流程")
    conn.execute("UPDATE technical_service_sheets SET deleted=1 WHERE id=?", (identity,))
    audit(conn, actor, "deleted", item, None)
    return {"ok": True}
