"""Billing statement generation application transactions."""

import re
from collections.abc import Callable
from dataclasses import dataclass
from typing import Any

from server_app.domains.administration import audit_event, merge_audit_logs, write_audit_events
from server_app.domains.billing.allowance import (
    BILLING_PRINCIPAL_INDEPENDENT,
    allocate_daily_free_cages_by_iacuc,
    apply_free_cage_allocations,
    billing_free_cages_for_pi,
    iacuc_free_allowance_eligible,
)
from server_app.domains.billing.charging import (
    BILLING_TIER_BASE_PRICE,
    BILLING_TIER_LIMIT,
    BILLING_TIER_OVER_PRICE,
    add_charge_group,
    combined_daily_charge,
    dates_in_month,
    occupancy_active_on_date,
    statement_billing_unit_from_lines,
)
from server_app.domains.billing.profiles import billing_profile_for_occupancy, occupancy_animal_count
from server_app.domains.billing.statements import (
    distinct_funding_text,
    pi_for_iacuc,
    quantity_sheet_free_allowance_notes,
    quantity_sheet_statement_lines,
    statement_application_snapshot,
    statement_pi_snapshot,
)
from server_app.domains.iacuc.rules import normalize_iacuc_number
from server_app.domains.workflow.constants import WORKFLOW_STATUS_SENT
from server_app.shared import clean_text, new_id, now_iso


@dataclass(frozen=True)
class BillingGenerationPorts:
    get_quantity_sheet: Callable[..., dict[str, Any]]
    list_quantity_sheets_by_month_iacuc: Callable[..., list[dict[str, Any]]]
    list_quantity_sheets_by_month_pi: Callable[..., list[dict[str, Any]]]
    read_principal_type_by_pi: Callable[..., dict[str, str]]
    read_rooms_for_quantity_sheets: Callable[..., list[dict[str, Any]]]
    read_applications_by_iacuc: Callable[..., dict[str, dict[str, Any]]]
    read_occupancies_for_billing: Callable[..., list[dict[str, Any]]]
    read_billing_state_for_occupancies: Callable[..., dict[str, Any]]
    save_billing_statement_workflow: Callable[..., tuple]
    update_workflow_status: Callable[..., tuple]
    occupancy_detail_context: Callable[..., dict[str, Any]]
    quantity_sheet_detail_context: Callable[..., dict[str, Any]]
    upsert_reimbursement_record_from_statement: Callable[..., Any]
    recalculate_reimbursement_accumulations: Callable[..., Any]


def validate_quantity_sheet_permission(actor, sheet):
    if actor:
        return
    raise PermissionError("请先登录")


def generate_quantity_sheet_statement(conn, sheet_id, payload, actor, ports):
    sheet = ports.get_quantity_sheet(conn, sheet_id)
    validate_quantity_sheet_permission(actor, sheet)
    status = clean_text(payload.get("status", "draft")) or "draft"
    persist = bool(payload.get("persist"))
    if status not in ("draft", "locked"):
        raise ValueError("结算单状态只能是 draft 或 locked")

    sheet_iacuc = normalize_iacuc_number(sheet.get("iacuc", ""))
    if not sheet_iacuc:
        raise ValueError("数量统计表缺少伦理号，无法生成按伦理号拆分的结算单")
    sheets = ports.list_quantity_sheets_by_month_iacuc(conn, sheet["month"], sheet_iacuc)
    for item in sheets:
        validate_quantity_sheet_permission(actor, item)
    pi_name = clean_text(sheet.get("pi", ""))
    principal_type_by_pi = ports.read_principal_type_by_pi(conn)
    principal_type = principal_type_by_pi.get(pi_name, BILLING_PRINCIPAL_INDEPENDENT)
    # IACUC 分表阶段不应用 PI 免费笼位，避免跨伦理号结算失真。
    free_cages = 0
    rooms = ports.read_rooms_for_quantity_sheets(conn, sheets)
    applications_by_iacuc = ports.read_applications_by_iacuc(conn)
    lines = quantity_sheet_statement_lines(sheets, free_cages, rooms, applications_by_iacuc)
    generated_at = now_iso()
    notes = quantity_sheet_free_allowance_notes(lines, generated_date=generated_at)
    iacucs = sorted({normalize_iacuc_number(item.get("iacuc", "")) for item in sheets if item.get("iacuc")})
    statement_iacuc = iacucs[0] if iacucs else sheet_iacuc
    statement = {
        "id": new_id("stmt"),
        "iacuc": statement_iacuc,
        "iacucs": iacucs,
        "month": sheet["month"],
        "project": "、".join(sorted({item.get("project", "") for item in sheets if item.get("project")})),
        "pi": pi_name,
        "owner": sheet.get("owner", ""),
        "funding": distinct_funding_text(item.get("funding", "") for item in sheets),
        "sourceType": "quantity_sheet",
        "sourceId": sheet["id"],
        "sourceIds": [item["id"] for item in sheets],
        "sourceLabel": "数量统计表",
        "roomName": "、".join(sorted({item.get("roomName", "") for item in sheets if item.get("roomName")})),
        "manager": "、".join(sorted({item.get("manager", "") for item in sheets if item.get("manager")})),
        "billingUnit": "cage_day",
        "principalType": principal_type,
        "freeCageAllowance": free_cages,
        "tierLimit": BILLING_TIER_LIMIT,
        "baseUnitPrice": BILLING_TIER_BASE_PRICE,
        "overageUnitPrice": BILLING_TIER_OVER_PRICE,
        "totalCageDays": sum(line["cageCount"] for line in lines),
        "totalFreeCageDays": sum(line.get("freeCages", 0) for line in lines),
        "totalBillableCageDays": sum(line.get("billableCages", 0) for line in lines),
        "totalTier1CageDays": sum(line.get("tier1BillableCages", 0) for line in lines),
        "totalTier2CageDays": sum(line.get("tier2BillableCages", 0) for line in lines),
        "totalAnimalDays": sum(line.get("animalCount", 0) for line in lines),
        "totalAmount": lines[-1]["cumulative"] if lines else 0,
        "sheetUpdatedAt": max(
            (clean_text(item.get("updatedAt", "")) for item in sheets if clean_text(item.get("updatedAt", ""))),
            default="",
        ),
        "notes": notes,
        "status": status,
        "generatedAt": generated_at,
        "lockedAt": generated_at if status == "locked" else "",
    }
    for line in lines:
        line["statementId"] = statement["id"]

    if not persist:
        return statement, lines, []

    workflow, version, statement, lines, workflow_events = ports.save_billing_statement_workflow(
        conn,
        statement,
        lines,
        actor,
        f"根据数量统计表生成 {statement_iacuc} {sheet['month']} 饲养费结算单",
    )
    event = audit_event(
        actor,
        "billing_statement.generated_from_quantity_sheet",
        "billing_workflow",
        workflow["id"],
        f"{actor['displayName']} 根据数量统计表生成 {statement_iacuc} {sheet['month']} 饲养费结算单",
        [],
        generated_at,
        sheet,
        {"workflow": workflow, "version": version},
    )
    write_audit_events(conn, [event])
    return statement, lines, merge_audit_logs([], [event])


def generate_billing_statement(conn, payload, actor, ports):
    iacuc = normalize_iacuc_number(payload.get("iacuc", ""))
    requested_pi = clean_text(payload.get("pi", ""))
    month = clean_text(payload.get("month", ""))
    status = clean_text(payload.get("status", "draft")) or "draft"
    persist = bool(payload.get("persist"))
    if not re.fullmatch(r"\d{4}-\d{2}", month):
        raise ValueError("结算月份格式应为 YYYY-MM")
    if status not in ("draft", "locked"):
        raise ValueError("结算单状态只能是 draft 或 locked")
    if not iacuc:
        raise ValueError("请先选择伦理号后再生成结算单")

    occupancies = ports.read_occupancies_for_billing(conn, month, iacuc=iacuc)
    applications_by_iacuc = ports.read_applications_by_iacuc(conn)
    state = ports.read_billing_state_for_occupancies(conn, occupancies)
    rooms = state["rooms"]
    dates = dates_in_month(month)
    generated_at = now_iso()
    cumulative = 0
    lines = []
    pi_name = requested_pi or pi_for_iacuc(iacuc, applications_by_iacuc, occupancies)
    if not pi_name:
        raise ValueError("项目负责人不能为空")
    principal_type_by_pi = ports.read_principal_type_by_pi(conn)
    principal_type = principal_type_by_pi.get(pi_name, BILLING_PRINCIPAL_INDEPENDENT)
    # IACUC 分表阶段不应用 PI 免费笼位，避免跨伦理号结算失真。
    free_cages = 0
    iacucs = [iacuc]

    for line_date in dates:
        active_items = [
            item
            for item in occupancies
            if normalize_iacuc_number(item.get("iacuc", "")) == iacuc and occupancy_active_on_date(item, line_date)
        ]
        charge_groups = {}
        cage_count = 0
        animal_count = 0
        for item in active_items:
            profile = billing_profile_for_occupancy(item, state)
            if profile["unit"] == "animal_day":
                count = occupancy_animal_count(item, profile)
                animal_count += count
            else:
                count = 1
                cage_count += 1
            add_charge_group(charge_groups, profile, count)
        charges = combined_daily_charge(charge_groups, free_cages)
        amount = charges["amount"]
        cumulative += amount
        breakdown = []
        if active_items:
            for item in active_items:
                profile = billing_profile_for_occupancy(item, state)
                found = next(
                    (
                        entry
                        for entry in breakdown
                        if entry["iacuc"] == iacuc
                        and entry.get("billingItem") == profile["billingItem"]
                        and entry.get("customerType") == profile["customerType"]
                    ),
                    None,
                )
                if not found:
                    found = {
                        "iacuc": iacuc,
                        "project": statement_application_snapshot(iacuc, applications_by_iacuc, occupancies).get(
                            "project", ""
                        ),
                        "animalCount": 0,
                        "cageCount": 0,
                        "billingItem": profile["billingItem"],
                        "billingUnit": profile["unit"],
                        "customerType": profile["customerType"],
                        "unitPrice": profile["unitPrice"],
                        "overageUnitPrice": BILLING_TIER_OVER_PRICE if profile["tiered"] else 0,
                        "tiered": bool(profile["tiered"]),
                        "freeAllowance": bool(profile["freeAllowance"]),
                    }
                    breakdown.append(found)
                if profile["unit"] == "animal_day":
                    found["animalCount"] += occupancy_animal_count(item, profile)
                else:
                    found["cageCount"] += 1
        line = {
            "id": new_id("line"),
            "date": line_date,
            "animalCount": animal_count,
            "cageCount": cage_count,
            **charges,
            "amount": amount,
            "cumulative": cumulative,
            "iacucBreakdown": breakdown,
            "occupancyIds": [item.get("id") for item in active_items if item.get("id")],
        }
        lines.append(line)

    application = statement_application_snapshot(iacuc, applications_by_iacuc, occupancies)
    statement = {
        "id": new_id("stmt"),
        "iacuc": iacuc,
        "iacucs": iacucs,
        "month": month,
        "project": application.get("project", ""),
        "pi": pi_name,
        "owner": application.get("owner", ""),
        "funding": application.get("funding", ""),
        "sourceType": "cage_map",
        "sourceLabel": "动态笼位图",
        "billingUnit": statement_billing_unit_from_lines(lines),
        "principalType": principal_type,
        "freeCageAllowance": free_cages,
        "tierLimit": BILLING_TIER_LIMIT,
        "baseUnitPrice": BILLING_TIER_BASE_PRICE,
        "overageUnitPrice": BILLING_TIER_OVER_PRICE,
        "totalCageDays": sum(line["cageCount"] for line in lines),
        "totalFreeCageDays": sum(line.get("freeCages", 0) for line in lines),
        "totalBillableCageDays": sum(line.get("billableCages", 0) for line in lines),
        "totalTier1CageDays": sum(line.get("tier1BillableCages", 0) for line in lines),
        "totalTier2CageDays": sum(line.get("tier2BillableCages", 0) for line in lines),
        "totalAnimalDays": sum(line.get("animalCount", 0) for line in lines),
        "totalAmount": cumulative,
        "status": status,
        "generatedAt": generated_at,
        "lockedAt": generated_at if status == "locked" else "",
    }
    for line in lines:
        line["statementId"] = statement["id"]

    if not persist:
        return statement, lines, []

    workflow, version, statement, lines, workflow_events = ports.save_billing_statement_workflow(
        conn,
        statement,
        lines,
        actor,
        f"生成 {pi_name} {month} 饲养费结算单",
    )
    detail_context = ports.occupancy_detail_context(occupancies, rooms)
    ports.upsert_reimbursement_record_from_statement(conn, workflow, statement, lines, detail_context, "workflow")
    ports.recalculate_reimbursement_accumulations(conn, pi_name)
    event = audit_event(
        actor,
        "billing_statement.generated",
        "billing_workflow",
        workflow["id"],
        f"{actor['displayName']} 生成 {pi_name} {month} 饲养费结算单",
        [],
        generated_at,
        None,
        {"workflow": workflow, "version": version},
    )
    write_audit_events(conn, [event])
    return statement, lines, merge_audit_logs([], [event])


def generate_billing_statement_by_pi(conn, payload, actor, ports):
    month = clean_text(payload.get("month", ""))
    pi_name = clean_text(payload.get("pi", ""))
    status = clean_text(payload.get("status", "draft")) or "draft"
    source_type = clean_text(payload.get("sourceType", "cage_map")) or "cage_map"
    persist = bool(payload.get("persist"))
    if not re.fullmatch(r"\d{4}-\d{2}", month):
        raise ValueError("结算月份格式应为 YYYY-MM")
    if status not in ("draft", "locked"):
        raise ValueError("结算单状态只能是 draft 或 locked")
    if source_type not in ("cage_map", "quantity_sheet"):
        raise ValueError("sourceType 只能是 cage_map 或 quantity_sheet")
    if not pi_name:
        raise ValueError("按 PI 合表需要提供项目负责人")

    principal_type_by_pi = ports.read_principal_type_by_pi(conn)
    principal_type = principal_type_by_pi.get(pi_name, BILLING_PRINCIPAL_INDEPENDENT)
    free_cages = billing_free_cages_for_pi(principal_type_by_pi, pi_name)
    generated_at = now_iso()
    iacucs = []

    if source_type == "cage_map":
        applications_by_iacuc = ports.read_applications_by_iacuc(conn)
        occupancies = ports.read_occupancies_for_billing(conn, month, pi=pi_name)
        state = ports.read_billing_state_for_occupancies(conn, occupancies)
        rooms = state["rooms"]
        iacucs = sorted(
            {
                normalize_iacuc_number(item.get("iacuc", ""))
                for item in occupancies
                if clean_text(item.get("pi", "")) == pi_name and normalize_iacuc_number(item.get("iacuc", ""))
            }
        )
        cumulative = 0
        lines = []
        for date in dates_in_month(month):
            active_items = [
                item
                for item in occupancies
                if clean_text(item.get("pi", "")) == pi_name and occupancy_active_on_date(item, date)
            ]
            charge_groups = {}
            cage_count = 0
            animal_count = 0
            for item in active_items:
                profile = billing_profile_for_occupancy(item, state)
                if profile["unit"] == "animal_day":
                    count = occupancy_animal_count(item, profile)
                    animal_count += count
                else:
                    count = 1
                    cage_count += 1
                add_charge_group(charge_groups, profile, count)
            breakdown = []
            for item in active_items:
                item_iacuc = normalize_iacuc_number(item.get("iacuc", ""))
                profile = billing_profile_for_occupancy(item, state)
                found = next(
                    (
                        entry
                        for entry in breakdown
                        if entry["iacuc"] == item_iacuc
                        and entry.get("billingItem") == profile["billingItem"]
                        and entry.get("customerType") == profile["customerType"]
                    ),
                    None,
                )
                if not found:
                    found = {
                        "iacuc": item_iacuc,
                        "project": item.get("project", ""),
                        "animalCount": 0,
                        "cageCount": 0,
                        "billingItem": profile["billingItem"],
                        "billingUnit": profile["unit"],
                        "customerType": profile["customerType"],
                        "unitPrice": profile["unitPrice"],
                        "overageUnitPrice": BILLING_TIER_OVER_PRICE if profile["tiered"] else 0,
                        "tiered": bool(profile["tiered"]),
                        "freeAllowance": bool(profile["freeAllowance"]),
                        "freeEligible": iacuc_free_allowance_eligible(
                            applications_by_iacuc.get(item_iacuc, item), date
                        ),
                        "freeCages": 0,
                    }
                    breakdown.append(found)
                if profile["unit"] == "animal_day":
                    found["animalCount"] += occupancy_animal_count(item, profile)
                else:
                    found["cageCount"] += 1
            free_allocations = allocate_daily_free_cages_by_iacuc(breakdown, free_cages)
            apply_free_cage_allocations(breakdown, free_allocations)
            charges = combined_daily_charge(charge_groups, sum(free_allocations.values()))
            cumulative += charges["amount"]
            lines.append(
                {
                    "id": new_id("line"),
                    "date": date,
                    "animalCount": animal_count,
                    "cageCount": cage_count,
                    **charges,
                    "amount": charges["amount"],
                    "cumulative": cumulative,
                    "iacucBreakdown": breakdown,
                    "occupancyIds": [item.get("id") for item in active_items if item.get("id")],
                }
            )
        application = statement_pi_snapshot(pi_name, applications_by_iacuc, occupancies)
        statement = {
            "id": new_id("stmt"),
            "iacuc": f"pi::{pi_name}",
            "iacucs": iacucs,
            "month": month,
            "project": application.get("project", ""),
            "pi": pi_name,
            "owner": application.get("owner", ""),
            "funding": application.get("funding", ""),
            "sourceType": "pi_merged_cage_map",
            "sourceLabel": "动态笼位图（按 PI 合表）",
            "billingUnit": statement_billing_unit_from_lines(lines),
            "principalType": principal_type,
            "freeCageAllowance": free_cages,
            "tierLimit": BILLING_TIER_LIMIT,
            "baseUnitPrice": BILLING_TIER_BASE_PRICE,
            "overageUnitPrice": BILLING_TIER_OVER_PRICE,
            "totalCageDays": sum(line["cageCount"] for line in lines),
            "totalFreeCageDays": sum(line.get("freeCages", 0) for line in lines),
            "totalBillableCageDays": sum(line.get("billableCages", 0) for line in lines),
            "totalTier1CageDays": sum(line.get("tier1BillableCages", 0) for line in lines),
            "totalTier2CageDays": sum(line.get("tier2BillableCages", 0) for line in lines),
            "totalAnimalDays": sum(line.get("animalCount", 0) for line in lines),
            "totalAmount": cumulative,
            "sheetUpdatedAt": "",
            "status": status,
            "generatedAt": generated_at,
            "lockedAt": generated_at if status == "locked" else "",
        }
        detail_context = ports.occupancy_detail_context(occupancies, rooms)
    else:
        sheets = ports.list_quantity_sheets_by_month_pi(conn, month, pi_name)
        if not sheets:
            raise ValueError("未找到该 PI 在结算月份内的数量统计表")
        for item in sheets:
            validate_quantity_sheet_permission(actor, item)
        iacucs = sorted({normalize_iacuc_number(item.get("iacuc", "")) for item in sheets if item.get("iacuc")})
        rooms = ports.read_rooms_for_quantity_sheets(conn, sheets)
        applications_by_iacuc = ports.read_applications_by_iacuc(conn)
        lines = quantity_sheet_statement_lines(sheets, free_cages, rooms, applications_by_iacuc)
        notes = quantity_sheet_free_allowance_notes(lines, generated_date=generated_at)
        statement = {
            "id": new_id("stmt"),
            "iacuc": f"pi::{pi_name}",
            "iacucs": iacucs,
            "month": month,
            "project": "、".join(sorted({item.get("project", "") for item in sheets if item.get("project")})),
            "pi": pi_name,
            "owner": "、".join(sorted({item.get("owner", "") for item in sheets if item.get("owner")})),
            "funding": distinct_funding_text(item.get("funding", "") for item in sheets),
            "sourceType": "pi_merged_quantity_sheet",
            "sourceIds": [item["id"] for item in sheets],
            "sourceLabel": "数量统计表（按 PI 合表）",
            "roomName": "、".join(sorted({item.get("roomName", "") for item in sheets if item.get("roomName")})),
            "manager": "、".join(sorted({item.get("manager", "") for item in sheets if item.get("manager")})),
            "billingUnit": statement_billing_unit_from_lines(lines),
            "principalType": principal_type,
            "freeCageAllowance": free_cages,
            "tierLimit": BILLING_TIER_LIMIT,
            "baseUnitPrice": BILLING_TIER_BASE_PRICE,
            "overageUnitPrice": BILLING_TIER_OVER_PRICE,
            "totalCageDays": sum(line["cageCount"] for line in lines),
            "totalFreeCageDays": sum(line.get("freeCages", 0) for line in lines),
            "totalBillableCageDays": sum(line.get("billableCages", 0) for line in lines),
            "totalTier1CageDays": sum(line.get("tier1BillableCages", 0) for line in lines),
            "totalTier2CageDays": sum(line.get("tier2BillableCages", 0) for line in lines),
            "totalAnimalDays": sum(line.get("animalCount", 0) for line in lines),
            "totalAmount": lines[-1]["cumulative"] if lines else 0,
            "sheetUpdatedAt": max(
                (clean_text(item.get("updatedAt", "")) for item in sheets if clean_text(item.get("updatedAt", ""))),
                default="",
            ),
            "notes": notes,
            "status": status,
            "generatedAt": generated_at,
            "lockedAt": generated_at if status == "locked" else "",
        }
        detail_context = ports.quantity_sheet_detail_context(sheets, rooms)

    for line in lines:
        line["statementId"] = statement["id"]
    if not persist:
        return statement, lines, []
    workflow, version, statement, lines, workflow_events = ports.save_billing_statement_workflow(
        conn,
        statement,
        lines,
        actor,
        f"按 PI 合表生成 {pi_name} {month} 饲养费结算单",
    )
    initiate = bool(payload.get("initiate"))
    if initiate:
        workflow, version, sent_event = ports.update_workflow_status(
            conn, workflow["id"], WORKFLOW_STATUS_SENT, actor, f"按 PI 合表发起 {pi_name} {month} 结算流程"
        )
        statement = version["statement"]
        workflow_events.append(sent_event)
    ports.upsert_reimbursement_record_from_statement(conn, workflow, statement, lines, detail_context, "workflow")
    ports.recalculate_reimbursement_accumulations(conn, pi_name)
    action = "按 PI 合表生成并发起" if initiate else "按 PI 合表生成"
    event = audit_event(
        actor,
        "billing_statement.generated_by_pi",
        "billing_workflow",
        workflow["id"],
        f"{actor['displayName']} {action} {pi_name} {month} 饲养费结算单",
        [],
        generated_at,
        None,
        {"workflow": workflow, "version": version},
    )
    audits = [event]
    if initiate:
        audits.append(
            audit_event(
                actor,
                "billing_workflow.statement_sent",
                "billing_workflow",
                workflow["id"],
                f"{actor['displayName']} 发起 {pi_name} {month} 结算流程",
                [],
                sent_event["at"],
                None,
                {"workflow": workflow, "version": version, "event": sent_event},
            )
        )
    write_audit_events(conn, audits)
    return statement, lines, merge_audit_logs([], audits)
