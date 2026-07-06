import re

REIMBURSEMENT_STATUS_PENDING = "pending_submission"
REIMBURSEMENT_STATUS_REIMBURSING = "reimbursing"
REIMBURSEMENT_STATUS_COMPLETED = "completed"

REIMBURSEMENT_STATUS_VALUES = {
    REIMBURSEMENT_STATUS_PENDING,
    REIMBURSEMENT_STATUS_REIMBURSING,
    REIMBURSEMENT_STATUS_COMPLETED,
}


def normalize_reimbursement_status(value):
    text = str(value or "").strip()
    return text if text in REIMBURSEMENT_STATUS_VALUES else REIMBURSEMENT_STATUS_PENDING


def reimbursement_business_key(month, pi_name):
    return f"{str(month or '').strip()}|{str(pi_name or '').strip()}"


def reimbursement_has_manual_entry(record):
    if not isinstance(record, dict):
        return False
    if normalize_reimbursement_status(record.get("reimbursementStatus")) != REIMBURSEMENT_STATUS_PENDING:
        return True
    if numeric(record.get("paidAmount")) > 0:
        return True
    for key in ("fundBookNo", "reimbursementFormNo", "notes"):
        if str(record.get(key) or "").strip():
            return True
    approved_budget = record.get("approvedBudget")
    if approved_budget not in (None, "", 0, 0.0):
        return True
    return False


def coerce_money(value):
    number = numeric(value)
    return round(number, 2)


def numeric(value):
    try:
        return float(value or 0)
    except (TypeError, ValueError):
        return 0.0


def statement_breakdown_count(item, billing_unit):
    return numeric(item.get("animalCount")) if billing_unit == "animal_day" else numeric(item.get("cageCount"))


def statement_column_iacucs(statement, lines, billing_unit, tier_limit):
    totals = {}
    tiered_totals = {}
    for row in lines:
        for item in row.get("iacucBreakdown", []) or []:
            iacuc = str(item.get("iacuc") or "").strip()
            if not iacuc:
                continue
            totals[iacuc] = totals.get(iacuc, 0) + statement_breakdown_count(item, billing_unit)
            tiered_totals[iacuc] = tiered_totals.get(iacuc, 0) + numeric(item.get("tier2BillableCages"))
    ordered = [str(value).strip() for value in (statement.get("iacucs") or []) if str(value or "").strip()]
    if billing_unit == "cage_day" and numeric(statement.get("totalTier2CageDays")) > 0 and len(ordered) > 1:
        tiered_target = (
            sorted(tiered_totals.items(), key=lambda item: (-item[1], -totals.get(item[0], 0), item[0]))[0][0]
            if tiered_totals
            else ""
        )
        if tiered_target:
            return [tiered_target] + [iacuc for iacuc in ordered if iacuc != tiered_target]
    return ordered


def billing_breakdown_groups(row, billing_unit):
    groups = {}
    for item in row.get("iacucBreakdown", []) or []:
        iacuc = str(item.get("iacuc") or "").strip()
        if not iacuc:
            continue
        count = statement_breakdown_count(item, billing_unit)
        if count <= 0:
            continue
        key = "|".join(
            [
                str(item.get("billingItem") or ""),
                str(item.get("customerType") or ""),
                str(item.get("billingUnit") or ""),
                str(item.get("unitPrice") or ""),
                str(item.get("overageUnitPrice") or ""),
                "1" if item.get("tiered") else "0",
                "1" if item.get("freeAllowance") else "0",
            ]
        )
        current = groups.get(key) or {
            "unitPrice": numeric(item.get("unitPrice")),
            "overageUnitPrice": numeric(item.get("overageUnitPrice")),
            "tiered": bool(item.get("tiered")),
            "freeAllowance": bool(item.get("freeAllowance")),
            "countsByIacuc": {},
            "freeByIacuc": {},
            "hasExplicitFree": False,
        }
        current["countsByIacuc"][iacuc] = current["countsByIacuc"].get(iacuc, 0) + count
        if "freeCages" in item:
            current["hasExplicitFree"] = True
        current["freeByIacuc"][iacuc] = current["freeByIacuc"].get(iacuc, 0) + numeric(item.get("freeCages"))
        groups[key] = current
    return list(groups.values())


def summarize_statement(statement, lines, detail_context_by_iacuc, tier_limit):
    billing_unit = statement.get("billingUnit") or (
        "animal_day" if numeric(statement.get("totalAnimalDays")) > 0 else "cage_day"
    )
    iacucs = statement_column_iacucs(statement, lines, billing_unit, tier_limit)
    per_iacuc = {iacuc: {"count": 0, "supportAmount": 0, "payableAmount": 0, "amount": 0} for iacuc in iacucs}
    free_allowance = numeric(statement.get("freeCageAllowance"))
    for row in lines:
        explicit_breakdown = row.get("iacucBreakdown", []) or []
        if explicit_breakdown and any(
            item.get("supportAmount") is not None or item.get("payableAmount") is not None
            for item in explicit_breakdown
        ):
            for item in explicit_breakdown:
                iacuc = str(item.get("iacuc") or "").strip()
                if not iacuc or iacuc not in per_iacuc:
                    continue
                current = per_iacuc[iacuc]
                current["count"] += statement_breakdown_count(item, billing_unit)
                current["supportAmount"] += numeric(item.get("supportAmount"))
                current["payableAmount"] += numeric(item.get("payableAmount"))
                current["amount"] += numeric(item.get("amount")) or (
                    numeric(item.get("supportAmount")) + numeric(item.get("payableAmount"))
                )
            continue
        for group in billing_breakdown_groups(row, billing_unit):
            remaining_free = free_allowance if group.get("freeAllowance") and billing_unit == "cage_day" else 0
            remaining_tier1 = tier_limit if group.get("tiered") else 0
            for iacuc in iacucs:
                count = numeric(group["countsByIacuc"].get(iacuc))
                if count <= 0:
                    continue
                current = per_iacuc[iacuc]
                current["count"] += count
                if group.get("tiered"):
                    explicit_free = numeric(group.get("freeByIacuc", {}).get(iacuc))
                    free = min(explicit_free, count) if group.get("hasExplicitFree") else min(remaining_free, count)
                    remaining_free -= free
                    billable = max(count - free, 0)
                    tier1 = min(remaining_tier1, billable)
                    remaining_tier1 -= tier1
                    tier2 = max(billable - tier1, 0)
                    support = free * group["unitPrice"]
                    payable = tier1 * group["unitPrice"] + tier2 * (group["overageUnitPrice"] or group["unitPrice"])
                else:
                    explicit_free = numeric(group.get("freeByIacuc", {}).get(iacuc))
                    free = min(explicit_free, count) if group.get("hasExplicitFree") else 0
                    support = free * group["unitPrice"]
                    payable = max(count - free, 0) * group["unitPrice"]
                current["supportAmount"] += support
                current["payableAmount"] += payable
                current["amount"] += support + payable
    details = []
    for iacuc in iacucs:
        context = detail_context_by_iacuc.get(iacuc, {})
        values = per_iacuc.get(iacuc, {})
        details.append(
            {
                "iacuc": iacuc,
                "facility": context.get("facility", ""),
                "funding": context.get("funding", ""),
                "species": context.get("species", ""),
                "project": context.get("project", ""),
                "owner": context.get("owner", ""),
                "amount": coerce_money(values.get("amount", 0)),
                "supportAmount": coerce_money(values.get("supportAmount", 0)),
                "payableAmount": coerce_money(values.get("payableAmount", 0)),
                "roomNames": context.get("roomNames", []),
                "statementVersionId": statement.get("versionId", "") or statement.get("id", ""),
            }
        )
    support_total = sum(item["supportAmount"] for item in details)
    payable_total = sum(item["payableAmount"] for item in details)
    return {
        "billingUnit": billing_unit,
        "details": details,
        "supportAmount": coerce_money(support_total),
        "payableAmount": coerce_money(payable_total),
    }


def merge_reimbursement_edit(existing, patch):
    next_record = {**existing}
    next_record["fundBookNo"] = str(patch.get("fundBookNo", existing.get("fundBookNo", "")) or "").strip()
    next_record["reimbursementFormNo"] = str(
        patch.get("reimbursementFormNo", existing.get("reimbursementFormNo", "")) or ""
    ).strip()
    next_record["notes"] = str(patch.get("notes", existing.get("notes", "")) or "").strip()
    approved_budget = patch.get("approvedBudget", existing.get("approvedBudget"))
    next_record["approvedBudget"] = "" if approved_budget in (None, "") else coerce_money(approved_budget)
    next_record["paidAmount"] = coerce_money(patch.get("paidAmount", existing.get("paidAmount", 0)))
    requested_status = normalize_reimbursement_status(
        patch.get("reimbursementStatus", existing.get("reimbursementStatus", REIMBURSEMENT_STATUS_PENDING))
    )
    payable_amount = coerce_money(next_record.get("payableAmount", 0))
    next_record["unpaidAmount"] = coerce_money(max(payable_amount - next_record["paidAmount"], 0))
    if requested_status == REIMBURSEMENT_STATUS_COMPLETED and next_record["paidAmount"] + 1e-9 < payable_amount:
        raise ValueError("已缴金额达到本月应缴金额后才能标记完成")
    if requested_status == REIMBURSEMENT_STATUS_REIMBURSING and not (
        next_record["fundBookNo"] or next_record["reimbursementFormNo"]
    ):
        raise ValueError("录入经费本号或报销单号后才能标记为报销中")
    next_record["reimbursementStatus"] = requested_status
    if requested_status == REIMBURSEMENT_STATUS_COMPLETED:
        next_record["completedAt"] = patch.get("completedAt") or existing.get("completedAt") or ""
    return next_record


def infer_import_status(fund_book_no, reimbursement_form_no, notes):
    note_text = str(notes or "").strip()
    if fund_book_no or reimbursement_form_no or re.search(r"已提交|已交汇总表", note_text):
        return REIMBURSEMENT_STATUS_REIMBURSING
    return REIMBURSEMENT_STATUS_PENDING
