"""Quantity sheet validation, persistence, and transfer application services."""

import json
import re
import time
from datetime import datetime
from http import HTTPStatus

from server_app.cache import log_perf
from server_app.domains.administration import audit_event, merge_audit_logs, write_audit_events
from server_app.domains.billing import (
    billing_free_cages_for_pi,
    billing_profile_for_room,
    normalize_custom_billing_segments,
    normalize_principal_type,
    validate_custom_billing_segments,
)
from server_app.domains.billing.generation import validate_quantity_sheet_permission
from server_app.domains.iacuc import normalize_iacuc_number
from server_app.domains.quantity.facade import (
    get_quantity_sheet,
    list_quantity_sheets_by_month_pi,
)
from server_app.domains.state.persistence import read_applications_by_iacuc
from server_app.repositories.billing import (
    delete_quantity_sheet_by_id as delete_quantity_sheet_by_id_repository,
)
from server_app.repositories.billing import (
    get_current_billing_statement as get_current_billing_statement_repository,
)
from server_app.repositories.billing import (
    get_quantity_sheet as get_quantity_sheet_repository,
)
from server_app.repositories.billing import (
    insert_quantity_sheet as insert_quantity_sheet_repository,
)
from server_app.repositories.billing import (
    select_quantity_sheets_for_transfer as select_quantity_sheets_for_transfer_repository,
)
from server_app.repositories.billing import (
    update_quantity_sheet as update_quantity_sheet_repository,
)
from server_app.repositories.entities import read_principal_type_by_pi as read_principal_type_by_pi_repository
from server_app.repositories.payload import dump_json, placeholders
from server_app.services.quantity import sync_quantity_sheet_transfer_rows as sync_quantity_sheet_transfer_rows_service
from server_app.shared import as_float, as_int, clean_text, new_id, now_iso
from server_app.shared.concurrency import require_current_version


def quantity_service_deps():
    return {
        "as_int": as_int,
        "audit_event": audit_event,
        "clean_text": clean_text,
        "insert_quantity_sheet": insert_quantity_sheet_repository,
        "new_id": new_id,
        "normalize_iacuc_number": normalize_iacuc_number,
        "quantity_sheet_db_values": quantity_sheet_db_values,
        "read_applications_by_iacuc": read_applications_by_iacuc,
        "select_quantity_sheets_for_transfer": select_quantity_sheets_for_transfer_repository,
        "update_quantity_sheet": update_quantity_sheet_repository,
    }


def write_perf_summary(started_at, rows_changed=0, **fields):
    return {
        "total_ms": round((time.perf_counter() - started_at) * 1000, 1),
        "rows_changed": rows_changed,
        **{key: value for key, value in fields.items() if value not in (None, "")},
    }


def bounded_int(value, default, min_value, max_value):
    try:
        number = int(value)
    except (TypeError, ValueError):
        return default
    return max(min_value, min(number, max_value))


def quantity_sheet_print_items(conn, body, actor):
    raw_ids = body.get("ids")
    if not isinstance(raw_ids, list):
        raise ValueError("请选择数量统计表")
    sheet_ids = []
    for raw_id in raw_ids:
        sheet_id = clean_text(raw_id)
        if sheet_id and sheet_id not in sheet_ids:
            sheet_ids.append(sheet_id)
    if not sheet_ids:
        raise ValueError("请选择数量统计表")
    items = []
    for sheet_id in sheet_ids:
        sheet = get_quantity_sheet(conn, sheet_id)
        validate_quantity_sheet_permission(actor, sheet)
        items.append(sheet)
    return items


def get_current_billing_statement(conn, statement_id):
    return get_current_billing_statement_repository(conn, clean_text(statement_id))


def save_quantity_sheet(conn, payload, actor, sheet_id=None):
    started_at = time.perf_counter()
    now = now_iso()
    sheet = normalize_quantity_sheet(payload, sheet_id, now)
    room = read_room_payload(conn, sheet.get("roomId", "")) or {}
    sheet["manager"] = clean_text(actor.get("displayName", ""))
    sheet["roomManager"] = clean_text(room.get("roomManager", ""))
    validate_quantity_sheet_permission(actor, sheet)
    validate_quantity_sheet_animal_requirements(conn, sheet)
    validate_quantity_sheet_free_cage_settings(conn, sheet)
    validate_quantity_sheet_tier_priority(conn, sheet)
    previous_sheet = get_quantity_sheet_repository(conn, sheet["id"])
    exists = previous_sheet is not None
    if exists:
        require_current_version(previous_sheet, payload.get("expectedUpdatedAt"), "数量统计表")
    db_values = quantity_sheet_db_values(sheet)
    if exists:
        update_quantity_sheet_repository(conn, sheet, db_values)
        action = "quantity_sheet.updated"
        message = f"{actor['displayName']} 更新 {sheet['iacuc']} {sheet['month']} 数量统计表"
        status = HTTPStatus.OK
    else:
        insert_quantity_sheet_repository(conn, sheet, db_values)
        action = "quantity_sheet.created"
        message = f"{actor['displayName']} 创建 {sheet['iacuc']} {sheet['month']} 数量统计表"
        status = HTTPStatus.CREATED

    transfer_events, affected_sheets = sync_quantity_sheet_transfer_rows(conn, sheet, actor, now)
    changed_sheets = [sheet, *affected_sheets]
    validate_custom_billing_segments(changed_sheets, read_rooms_for_quantity_sheets(conn, changed_sheets))
    event = audit_event(actor, action, "quantity_sheet", sheet["id"], message, [], now, None, sheet)
    events = [event, *transfer_events]
    write_audit_events(conn, events)
    log_perf(
        "quantity_sheet.save",
        started_at,
        sheet_id=sheet["id"],
        affected=len(affected_sheets),
        rows=len(sheet.get("rows", [])),
    )
    perf = write_perf_summary(
        started_at,
        rows_changed=1 + len(affected_sheets),
        affected=len(affected_sheets),
        rows=len(sheet.get("rows", [])),
    )
    return sheet, previous_sheet, affected_sheets, merge_audit_logs([], events), status, perf


def delete_quantity_sheet(conn, actor, sheet_id):
    sheet = get_quantity_sheet(conn, sheet_id)
    validate_quantity_sheet_permission(actor, sheet)
    now = now_iso()
    delete_quantity_sheet_by_id_repository(conn, sheet_id)
    event = audit_event(
        actor,
        "quantity_sheet.deleted",
        "quantity_sheet",
        sheet_id,
        f"{actor['displayName']} 删除 {sheet.get('iacuc', '')} {sheet.get('month', '')} 数量统计表",
        [],
        now,
        sheet,
        None,
    )
    write_audit_events(conn, [event])
    return sheet, merge_audit_logs([], [event])


def quantity_sheet_db_values(sheet):
    return (
        sheet["month"],
        sheet["iacuc"],
        sheet.get("roomId", ""),
        sheet.get("roomName", ""),
        sheet.get("manager", ""),
        sheet.get("project", ""),
        sheet.get("pi", ""),
        sheet.get("owner", ""),
        sheet.get("funding", ""),
        sheet["updatedAt"],
        dump_json(sheet),
    )


def sync_quantity_sheet_transfer_rows(conn, source_sheet, actor, now):
    return sync_quantity_sheet_transfer_rows_service(conn, source_sheet, actor, now, quantity_service_deps())


def normalize_quantity_sheet(payload, sheet_id, updated_at):
    source = payload.get("sheet") if isinstance(payload, dict) and isinstance(payload.get("sheet"), dict) else payload
    if not isinstance(source, dict):
        raise ValueError("数量统计表必须是 JSON 对象")

    month = clean_text(source.get("month", ""))
    iacuc = clean_text(source.get("iacuc", ""))
    if not re.fullmatch(r"\d{4}-\d{2}", month):
        raise ValueError("结算月份格式应为 YYYY-MM")
    if not normalize_iacuc_number(iacuc):
        raise ValueError("IACUC 编号不能为空")

    rows = source.get("rows", [])
    if not isinstance(rows, list):
        raise ValueError("统计表明细必须是数组")

    sheet = {
        "id": clean_text(sheet_id or source.get("id") or new_id("qsheet")),
        "month": month,
        "roomId": clean_text(source.get("roomId", "")),
        "roomName": clean_text(source.get("roomName", "")),
        "manager": clean_text(source.get("manager", "")),
        "roomManager": clean_text(source.get("roomManager", "")),
        "iacuc": iacuc,
        "project": clean_text(source.get("project", "")),
        "pi": clean_text(source.get("pi", "")),
        "owner": clean_text(source.get("owner", "")),
        "contact": clean_text(source.get("contact", "")),
        "funding": clean_text(source.get("funding", "")),
        "preferredFreeCages": max(as_int(source.get("preferredFreeCages")) or 0, 0)
        if source.get("preferredFreeCages") not in (None, "")
        else None,
        "freeCagePriority": max(as_int(source.get("freeCagePriority")) or 0, 0)
        if source.get("freeCagePriority") not in (None, "")
        else None,
        "tierCagePriority": max(as_int(source.get("tierCagePriority")) or 0, 0)
        if source.get("tierCagePriority") not in (None, "")
        else None,
        "fullExemption": parse_bool(source.get("fullExemption")),
        "customBillingEnabled": parse_bool(source.get("customBillingEnabled")),
        "customUnitPrice": max(as_float(source.get("customUnitPrice")) or 0, 0)
        if source.get("customUnitPrice") not in (None, "")
        else None,
        "billingUnit": "animal_day" if clean_text(source.get("billingUnit", "")) == "animal_day" else "cage_day",
        "animalDetailEnabled": parse_bool(source.get("animalDetailEnabled")),
        "initialAnimalCount": as_int(source.get("initialAnimalCount")),
        "initialCageCount": as_int(source.get("initialCageCount")),
        "pageCount": max(as_int(source.get("pageCount")) or 1, 1),
        "rows": [normalize_quantity_sheet_row(row, month) for row in rows],
        "updatedAt": updated_at,
    }
    sheet["customBillingSegments"] = normalize_custom_billing_segments(source, month)
    sheet["customBillingEnabled"] = bool(sheet["customBillingSegments"])
    if sheet["fullExemption"]:
        sheet["preferredFreeCages"] = None
        sheet["freeCagePriority"] = None
        sheet["tierCagePriority"] = None
    sheet["rows"] = sorted(sheet["rows"], key=lambda item: (item["date"], item["id"]))
    return sheet


def parse_bool(value):
    if isinstance(value, bool):
        return value
    return clean_text(value).lower() in ("1", "true", "yes", "on")


def read_room_payload(conn, room_id):
    room_key = clean_text(room_id)
    if not room_key:
        return None
    row = conn.execute("SELECT payload FROM rooms WHERE id = ?", (room_key,)).fetchone()
    return json.loads(row["payload"]) if row else None


def read_room_payloads_for_context(conn, room_ids=None, room_names=None):
    ids = [clean_text(item) for item in (room_ids or []) if clean_text(item)]
    names = [clean_text(item) for item in (room_names or []) if clean_text(item)]
    clauses = []
    params = []
    if ids:
        clauses.append(f"id IN ({placeholders(ids)})")
        params.extend(ids)
    if names:
        clauses.append(f"name IN ({placeholders(names)})")
        params.extend(names)
    if not clauses:
        return []
    rows = conn.execute(
        f"SELECT payload FROM rooms WHERE {' OR '.join(clauses)} ORDER BY rowid", tuple(params)
    ).fetchall()
    return [json.loads(row["payload"]) for row in rows]


def validate_quantity_sheet_animal_requirements(conn, sheet):
    room = read_room_payload(conn, sheet.get("roomId"))
    profile = billing_profile_for_room(room, sheet.get("billingUnit"))
    if profile["unit"] != "animal_day":
        return
    has_animal_balance = any((row.get("animalCount") or 0) > 0 for row in sheet.get("rows", []))
    if not has_animal_balance:
        raise ValueError("该房间按只/天计费，请打开动物数量并补充结余总数")


def validate_quantity_sheet_free_cage_settings(conn, sheet):
    preferred = max(as_int(sheet.get("preferredFreeCages")) or 0, 0)
    has_priority = as_int(sheet.get("freeCagePriority")) is not None
    if preferred <= 0 and not has_priority:
        return
    pi_name = clean_text(sheet.get("pi", ""))
    if not pi_name:
        raise ValueError("设置优先减免笼数前，请先填写项目负责人")
    principal_type_by_pi = read_principal_type_by_pi(conn)
    allowance = billing_free_cages_for_pi(principal_type_by_pi, pi_name)
    if preferred > allowance:
        raise ValueError(f"优先减免笼数不能超过 {pi_name} 的每日总减免额度 {allowance} 笼")
    # Merge preferred amounts per IACUC: the same IACUC may span multiple
    # sheets, and allocation treats it as one unit.
    preferred_by_iacuc = {normalize_iacuc_number(sheet.get("iacuc", "")): preferred}
    for item in list_quantity_sheets_by_month_pi(conn, sheet.get("month"), pi_name):
        if item.get("id") == sheet.get("id") or not item.get("iacuc"):
            continue
        iacuc = normalize_iacuc_number(item.get("iacuc"))
        preferred_by_iacuc[iacuc] = max(
            preferred_by_iacuc.get(iacuc, 0),
            max(as_int(item.get("preferredFreeCages")) or 0, 0),
        )
    total = sum(preferred_by_iacuc.values())
    if total > allowance:
        raise ValueError(f"{pi_name} 本月已指定优先减免 {total} 笼/天，超过总额度 {allowance} 笼/天")


def validate_quantity_sheet_tier_priority(conn, sheet):
    priority = as_int(sheet.get("tierCagePriority"))
    if priority is None:
        return
    room = read_room_payload(conn, sheet.get("roomId"))
    profile = billing_profile_for_room(room, sheet.get("billingUnit"))
    if profile["unit"] != "cage_day" or not profile.get("tiered"):
        raise ValueError("当前房间计费口径不支持优先梯度")
    pi_name = clean_text(sheet.get("pi", ""))
    if not pi_name:
        raise ValueError("设置优先梯度前，请先填写项目负责人")
    enabled_count = 1
    for item in list_quantity_sheets_by_month_pi(conn, sheet.get("month"), pi_name):
        if item.get("id") == sheet.get("id"):
            continue
        if as_int(item.get("tierCagePriority")) is not None:
            enabled_count += 1
    if enabled_count > 1:
        raise ValueError(f"{pi_name} 在 {sheet.get('month')} 仅能指定一个优先梯度伦理")


def read_rooms_for_quantity_sheets(conn, sheets):
    return read_room_payloads_for_context(
        conn,
        room_ids=[sheet.get("roomId", "") for sheet in sheets],
        room_names=[sheet.get("roomName", "") for sheet in sheets],
    )


def normalize_quantity_sheet_row(row, month):
    if not isinstance(row, dict):
        raise ValueError("统计表明细行必须是 JSON 对象")
    date = normalize_sheet_date(row.get("date", ""), month)
    return {
        "id": clean_text(row.get("id", "")) or new_id("qrow"),
        "date": date,
        "addedCount": as_int(row.get("addedCount")),
        "addedType": clean_text(row.get("addedType", "")),
        "removedCount": as_int(row.get("removedCount")),
        "removedType": clean_text(row.get("removedType", "")),
        "transferInFromIacuc": normalize_iacuc_number(row.get("transferInFromIacuc", "")),
        "transferOutToIacuc": normalize_iacuc_number(row.get("transferOutToIacuc", "")),
        "animalCount": as_int(row.get("animalCount")),
        "cageCount": as_int(row.get("cageCount")),
        "handler": clean_text(row.get("handler", "")),
        "balanceSource": "manual" if clean_text(row.get("balanceSource", "")) == "manual" else "auto",
        "notes": clean_text(row.get("notes", "")),
        "transferSourceSheetId": clean_text(row.get("transferSourceSheetId", "")),
        "transferSourceIacuc": normalize_iacuc_number(row.get("transferSourceIacuc", "")),
        "transferMirrorContrib": {
            clean_text(key): max(as_int(value) or 0, 0)
            for key, value in (row.get("transferMirrorContrib") or {}).items()
            if clean_text(key)
        }
        if isinstance(row.get("transferMirrorContrib"), dict)
        else {},
    }


def normalize_sheet_date(value, month):
    text = clean_text(value)
    if re.fullmatch(r"\d{4}-\d{2}-\d{2}", text):
        date = text
    elif re.fullmatch(r"\d{1,2}[./-]\d{1,2}", text):
        year = month.split("-", 1)[0]
        month_no, day = [int(part) for part in re.split(r"[./-]", text)]
        date = f"{int(year):04d}-{month_no:02d}-{day:02d}"
    elif re.fullmatch(r"\d{1,2}", text):
        date = f"{month}-{int(text):02d}"
    else:
        raise ValueError("统计表日期格式应为 YYYY-MM-DD、M.D 或当月日期")
    if not date.startswith(month + "-"):
        raise ValueError("统计表明细日期必须属于结算月份")
    try:
        datetime.strptime(date, "%Y-%m-%d")
    except ValueError as exc:
        raise ValueError("统计表明细日期无效") from exc
    return date


def read_principal_type_by_pi(conn):
    return {
        clean_text(pi_name): normalize_principal_type(principal_type)
        for pi_name, principal_type in read_principal_type_by_pi_repository(conn).items()
        if clean_text(pi_name)
    }
