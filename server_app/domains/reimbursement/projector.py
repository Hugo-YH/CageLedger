"""Reimbursement detail and record payload projections."""

import hashlib
import re
from collections.abc import Callable
from dataclasses import dataclass
from typing import Any

from server_app.domains.billing.charging import BILLING_TIER_LIMIT
from server_app.domains.billing.profiles import billing_profile_for_room
from server_app.domains.billing.statements import statement_application_snapshot
from server_app.domains.iacuc.rules import normalize_iacuc_number
from server_app.domains.state.persistence import read_applications_by_iacuc
from server_app.services.reimbursement import (
    REIMBURSEMENT_STATUS_COMPLETED,
    REIMBURSEMENT_STATUS_PENDING,
    REIMBURSEMENT_STATUS_REIMBURSING,
    normalize_reimbursement_status,
    reimbursement_business_key,
    summarize_statement,
)
from server_app.services.reimbursement import (
    coerce_money as coerce_reimbursement_money,
)
from server_app.shared import clean_text, now_iso


@dataclass(frozen=True)
class ReimbursementProjectorPorts:
    list_billing_statement_lines_for_version: Callable[..., list[dict[str, Any]]]
    list_quantity_sheets_by_month_iacuc: Callable[..., list[dict[str, Any]]]
    list_quantity_sheets_by_month_pi: Callable[..., list[dict[str, Any]]]
    read_room_payloads_for_context: Callable[..., list[dict[str, Any]]]
    read_occupancies_for_billing: Callable[..., list[dict[str, Any]]]
    read_billing_state_for_occupancies: Callable[..., dict[str, Any]]
    get_reimbursement_record_by_key: Callable[..., dict[str, Any] | None]


def reimbursement_record_id(month, pi_name):
    raw = f"{clean_text(month)}|{clean_text(pi_name)}"
    slug = re.sub(r"[^A-Za-z0-9]+", "-", clean_text(month)).strip("-") or "record"
    digest = hashlib.sha1(raw.encode("utf-8")).hexdigest()[:10]
    return f"rrc-{slug}-{digest}"


def quantity_sheet_detail_context(sheets, rooms):
    room_by_id = {room.get("id"): room for room in rooms}
    context = {}
    for sheet in sheets:
        iacuc = normalize_iacuc_number(sheet.get("iacuc", ""))
        if not iacuc:
            continue
        room = room_by_id.get(sheet.get("roomId")) or next(
            (item for item in rooms if clean_text(item.get("name")) == clean_text(sheet.get("roomName"))), {}
        )
        profile = billing_profile_for_room(room or {})
        current = context.get(iacuc) or {
            "facility": profile.get("facility", ""),
            "funding": "",
            "species": room.get("defaultSpecies", ""),
            "project": "",
            "owner": "",
            "roomNames": set(),
        }
        if sheet.get("funding"):
            current["funding"] = join_distinct_text(current.get("funding", ""), sheet.get("funding", ""))
        if sheet.get("project"):
            current["project"] = join_distinct_text(current.get("project", ""), sheet.get("project", ""))
        if sheet.get("owner"):
            current["owner"] = join_distinct_text(current.get("owner", ""), sheet.get("owner", ""))
        if room.get("defaultSpecies"):
            current["species"] = join_distinct_text(current.get("species", ""), room.get("defaultSpecies", ""))
        if sheet.get("roomName"):
            current["roomNames"].add(sheet.get("roomName"))
        context[iacuc] = current
    return finalize_reimbursement_detail_context(context)


def occupancy_detail_context(occupancies, rooms):
    room_by_id = {room.get("id"): room for room in rooms}
    context = {}
    for item in occupancies:
        iacuc = normalize_iacuc_number(item.get("iacuc", ""))
        if not iacuc:
            continue
        room = room_by_id.get(item.get("roomId"), {})
        profile = billing_profile_for_room(room or {})
        current = context.get(iacuc) or {
            "facility": profile.get("facility", ""),
            "funding": "",
            "species": "",
            "project": "",
            "owner": "",
            "roomNames": set(),
        }
        current["funding"] = join_distinct_text(current.get("funding", ""), item.get("funding", ""))
        current["species"] = join_distinct_text(current.get("species", ""), item.get("species", ""))
        current["project"] = join_distinct_text(current.get("project", ""), item.get("project", ""))
        current["owner"] = join_distinct_text(current.get("owner", ""), item.get("owner", ""))
        if item.get("roomName"):
            current["roomNames"].add(item.get("roomName"))
        context[iacuc] = current
    return finalize_reimbursement_detail_context(context)


def finalize_reimbursement_detail_context(context):
    finalized = {}
    for iacuc, item in context.items():
        finalized[iacuc] = {
            **item,
            "roomNames": sorted(item.get("roomNames", set())),
        }
    return finalized


def join_distinct_text(current, value):
    values = [part for part in [clean_text(current), clean_text(value)] if part]
    if not values:
        return ""
    return "、".join(sorted(set(values)))


def reimbursement_detail_context_from_workflow(conn, workflow, statement, ports):
    detail_context = {}
    iacucs = [normalize_iacuc_number(value) for value in statement.get("iacucs", []) if normalize_iacuc_number(value)]
    applications_by_iacuc = read_applications_by_iacuc(conn)
    if statement.get("sourceType") == "pi_merged_quantity_sheet":
        sheets = ports.list_quantity_sheets_by_month_pi(conn, statement.get("month"), clean_text(statement.get("pi")))
        rooms = ports.read_room_payloads_for_context(
            conn,
            room_ids=[item.get("roomId", "") for item in sheets],
            room_names=[item.get("roomName", "") for item in sheets],
        )
        detail_context = quantity_sheet_detail_context(sheets, rooms)
    elif statement.get("sourceType") == "quantity_sheet":
        sheets = ports.list_quantity_sheets_by_month_iacuc(
            conn, statement.get("month"), normalize_iacuc_number(statement.get("iacuc"))
        )
        rooms = ports.read_room_payloads_for_context(
            conn,
            room_ids=[item.get("roomId", "") for item in sheets],
            room_names=[item.get("roomName", "") for item in sheets],
        )
        detail_context = quantity_sheet_detail_context(sheets, rooms)
    else:
        occupancies = ports.read_occupancies_for_billing(
            conn,
            statement.get("month", ""),
            iacuc=""
            if clean_text(statement.get("sourceType", "")).startswith("pi_merged_")
            else statement.get("iacuc", ""),
            pi=statement.get("pi", "") if clean_text(statement.get("pi", "")) else "",
        )
        rooms = ports.read_room_payloads_for_context(conn, room_ids=[item.get("roomId", "") for item in occupancies])
        detail_context = occupancy_detail_context(occupancies, rooms)
    for iacuc in iacucs:
        snapshot = statement_application_snapshot(iacuc, applications_by_iacuc, [])
        current = detail_context.get(iacuc, {"roomNames": []})
        detail_context[iacuc] = {
            **current,
            "funding": current.get("funding") or snapshot.get("funding", ""),
            "project": current.get("project") or snapshot.get("project", ""),
            "owner": current.get("owner") or snapshot.get("owner", ""),
        }
    return detail_context


def build_reimbursement_record_payload(existing, workflow, statement, lines, detail_context_by_iacuc, source):
    summary = summarize_statement(statement, lines, detail_context_by_iacuc, BILLING_TIER_LIMIT)
    month = clean_text(statement.get("month", ""))
    pi_name = clean_text(statement.get("pi", ""))
    business_key = reimbursement_business_key(month, pi_name)
    current_month_amount = coerce_reimbursement_money(statement.get("totalAmount", 0))
    support_amount = coerce_reimbursement_money(summary.get("supportAmount", 0))
    payable_amount = coerce_reimbursement_money(summary.get("payableAmount", current_month_amount - support_amount))
    paid_amount = coerce_reimbursement_money(existing.get("paidAmount", 0) if existing else 0)
    reimbursement_status = normalize_reimbursement_status(existing.get("reimbursementStatus") if existing else "")
    payload = {
        "id": existing.get("id") if existing else reimbursement_record_id(month, pi_name),
        "businessKey": business_key,
        "month": month,
        "pi": pi_name,
        "workflowId": workflow.get("id", "") if workflow else existing.get("workflowId", "") if existing else "",
        "workflowStatus": workflow.get("workflowStatus", "")
        if workflow
        else existing.get("workflowStatus", "")
        if existing
        else "",
        "reimbursementStatus": reimbursement_status,
        "currentMonthAmount": current_month_amount,
        "supportAmount": support_amount,
        "payableAmount": payable_amount,
        "paidAmount": paid_amount,
        "unpaidAmount": coerce_reimbursement_money(max(payable_amount - paid_amount, 0)),
        "accumulatedPayable": coerce_reimbursement_money(existing.get("accumulatedPayable", 0) if existing else 0),
        "accumulatedPaid": coerce_reimbursement_money(existing.get("accumulatedPaid", 0) if existing else 0),
        "accumulatedUnpaid": coerce_reimbursement_money(existing.get("accumulatedUnpaid", 0) if existing else 0),
        "fundBookNo": clean_text(existing.get("fundBookNo", "") if existing else ""),
        "reimbursementFormNo": clean_text(existing.get("reimbursementFormNo", "") if existing else ""),
        "approvedBudget": existing.get("approvedBudget", "") if existing else "",
        "notes": clean_text(existing.get("notes", "") if existing else ""),
        "completedAt": clean_text(existing.get("completedAt", "") if existing else ""),
        "source": source,
        "latestEventAt": workflow.get("latestEventAt", "") if workflow else statement.get("generatedAt", ""),
        "updatedAt": now_iso(),
        "details": summary.get("details", []),
        "iacucs": [detail.get("iacuc", "") for detail in summary.get("details", []) if detail.get("iacuc")],
        "statementVersionId": statement.get("versionId", "") or statement.get("id", ""),
        "documentNumber": statement.get("documentNumber", ""),
        "billingUnit": statement.get("billingUnit", ""),
        "project": statement.get("project", ""),
        "owner": statement.get("owner", ""),
        "funding": statement.get("funding", ""),
    }
    if (
        payload["reimbursementStatus"] == REIMBURSEMENT_STATUS_COMPLETED
        and payload["paidAmount"] + 1e-9 < payload["payableAmount"]
    ):
        payload["reimbursementStatus"] = (
            REIMBURSEMENT_STATUS_REIMBURSING
            if (payload["fundBookNo"] or payload["reimbursementFormNo"])
            else REIMBURSEMENT_STATUS_PENDING
        )
        payload["completedAt"] = ""
    return payload
