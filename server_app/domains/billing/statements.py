from server_app.domains.iacuc import normalize_iacuc_number
from server_app.shared import as_int, clean_text, new_id

from .allowance import (
    allocate_daily_free_cages_by_iacuc,
    apply_free_cage_allocations,
    iacuc_free_allowance_eligible,
    summarize_breakdown_charges,
)
from .charging import (
    BILLING_TIER_BASE_PRICE,
    BILLING_TIER_OVER_PRICE,
    dates_in_month,
)
from .profiles import billing_profile_for_room


def quantity_sheet_statement_lines(sheets, free_cages, rooms=None, applications_by_iacuc=None):
    if not sheets:
        return []

    applications_by_iacuc = applications_by_iacuc or {}
    room_by_id = {room.get("id"): room for room in rooms or []}
    sheet_states = []
    sheet_state_by_iacuc = {}
    month = sheets[0]["month"]
    full_exemption_iacucs = {
        normalize_iacuc_number(sheet.get("iacuc", "")) for sheet in sheets if sheet.get("fullExemption")
    }
    for sheet in sheets:
        rows_by_date = {}
        for row in sheet.get("rows", []):
            rows_by_date.setdefault(row["date"], []).append(row)
        profile = quantity_sheet_billing_profile(
            billing_profile_for_room(room_by_id.get(sheet.get("roomId"), {}), sheet.get("billingUnit")), sheet
        )
        state = {
            "sheet": sheet,
            "rowsByDate": rows_by_date,
            "profile": profile,
            "animalCount": sheet.get("initialAnimalCount") or 0,
            "cageCount": sheet.get("initialCageCount") or 0,
        }
        sheet_states.append(state)
        iacuc = normalize_iacuc_number(sheet.get("iacuc", ""))
        if iacuc and iacuc not in sheet_state_by_iacuc:
            sheet_state_by_iacuc[iacuc] = state

    cumulative = 0
    lines = []
    for line_date in dates_in_month(month):
        transfer_deltas = {}
        breakdown = []
        animal_count = 0
        cage_count = 0
        quantity_row_ids = []
        for state in sheet_states:
            day_rows = state["rowsByDate"].get(line_date, [])
            for row in day_rows:
                added_count = row.get("addedCount") or 0
                removed_count = row.get("removedCount") or 0
                profile = state["profile"]
                if profile["unit"] == "animal_day":
                    if row.get("animalCount") is not None:
                        state["animalCount"] = row.get("animalCount") or 0
                    else:
                        state["animalCount"] = max(state["animalCount"] + added_count - removed_count, 0)
                    if row.get("cageCount") is not None:
                        state["cageCount"] = row.get("cageCount") or 0
                else:
                    if row.get("cageCount") is not None:
                        state["cageCount"] = row.get("cageCount") or 0
                    else:
                        state["cageCount"] = max(state["cageCount"] + added_count - removed_count, 0)
                    if row.get("animalCount") is not None:
                        state["animalCount"] = row.get("animalCount") or 0
                transfer_out_iacuc = normalize_iacuc_number(row.get("transferOutToIacuc", ""))
                if transfer_out_iacuc and removed_count > 0:
                    transfer_deltas[transfer_out_iacuc] = transfer_deltas.get(transfer_out_iacuc, 0) + removed_count
                transfer_in_from_iacuc = normalize_iacuc_number(row.get("transferInFromIacuc", ""))
                if transfer_in_from_iacuc and added_count > 0:
                    transfer_deltas[transfer_in_from_iacuc] = (
                        transfer_deltas.get(transfer_in_from_iacuc, 0) - added_count
                    )
            sheet = state["sheet"]
            quantity_row_ids.extend(row["id"] for row in day_rows)

        for iacuc, delta in transfer_deltas.items():
            target = sheet_state_by_iacuc.get(iacuc)
            if not target:
                continue
            if target["profile"]["unit"] == "animal_day":
                target["animalCount"] = max((target.get("animalCount") or 0) + delta, 0)
            else:
                target["cageCount"] = max((target.get("cageCount") or 0) + delta, 0)

        for state in sheet_states:
            sheet = state["sheet"]
            profile = state["profile"]
            animal_count += state["animalCount"]
            cage_count += state["cageCount"]
            if state["cageCount"] or state["animalCount"]:
                sheet_iacuc = normalize_iacuc_number(sheet.get("iacuc", ""))
                application = applications_by_iacuc.get(sheet_iacuc, {})
                breakdown.append(
                    {
                        "iacuc": sheet.get("iacuc", ""),
                        "project": sheet.get("project", ""),
                        "animalCount": state["animalCount"],
                        "cageCount": state["cageCount"],
                        "billingItem": profile["billingItem"],
                        "billingUnit": profile["unit"],
                        "customerType": profile["customerType"],
                        "unitPrice": profile["unitPrice"],
                        "overageUnitPrice": (
                            profile.get("overageUnitPrice", BILLING_TIER_OVER_PRICE) if profile["tiered"] else 0
                        ),
                        "tiered": bool(profile["tiered"]),
                        "freeAllowance": bool(profile["freeAllowance"]),
                        "freeEligible": iacuc_free_allowance_eligible(application or sheet, line_date),
                        "fullExemption": sheet_iacuc in full_exemption_iacucs,
                        "preferredFreeCages": max(as_int(sheet.get("preferredFreeCages")) or 0, 0),
                        "freeCagePriority": as_int(sheet.get("freeCagePriority")),
                        "tierCagePriority": as_int(sheet.get("tierCagePriority")),
                        "freeCages": 0,
                    }
                )

        free_allocations = allocate_daily_free_cages_by_iacuc(breakdown, free_cages)
        apply_free_cage_allocations(breakdown, free_allocations)
        charges = summarize_breakdown_charges(breakdown)
        cumulative += charges["amount"]
        lines.append(
            {
                "id": new_id("line"),
                "date": line_date,
                "animalCount": animal_count,
                "cageCount": cage_count,
                **charges,
                "cumulative": cumulative,
                "iacucBreakdown": breakdown,
                "quantitySheetRowIds": quantity_row_ids,
                "occupancyIds": [],
            }
        )
    return lines


def quantity_sheet_billing_profile(profile, sheet):
    if not sheet.get("customBillingEnabled") or sheet.get("customUnitPrice") in (None, ""):
        return profile
    unit_price = max(float(sheet.get("customUnitPrice") or 0), 0)
    overage_delta = BILLING_TIER_OVER_PRICE - BILLING_TIER_BASE_PRICE
    return {
        **profile,
        "unitPrice": unit_price,
        "overageUnitPrice": unit_price + overage_delta if profile.get("tiered") else 0,
        "customBilling": True,
    }


def pi_for_iacuc(iacuc, applications_by_iacuc, occupancies):
    if not iacuc:
        return ""
    application = applications_by_iacuc.get(iacuc)
    if application and application.get("pi"):
        return clean_text(application.get("pi", ""))
    for item in occupancies:
        if normalize_iacuc_number(item.get("iacuc", "")) == iacuc and item.get("pi"):
            return clean_text(item.get("pi", ""))
    return ""


def statement_application_snapshot(iacuc, applications_by_iacuc, occupancies):
    application = applications_by_iacuc.get(iacuc)
    if application:
        return application
    for item in occupancies:
        if normalize_iacuc_number(item.get("iacuc", "")) == iacuc:
            return {
                "project": item.get("project", ""),
                "pi": item.get("pi", ""),
                "owner": item.get("owner", ""),
                "funding": item.get("funding", ""),
            }
    return {}


def statement_pi_snapshot(pi_name, applications_by_iacuc, occupancies):
    projects = []
    owners = []
    fundings = []
    for application in applications_by_iacuc.values():
        if clean_text(application.get("pi", "")) == pi_name:
            projects.append(application.get("project", ""))
            owners.append(application.get("owner", ""))
            fundings.append(application.get("funding", ""))
    for item in occupancies:
        if clean_text(item.get("pi", "")) == pi_name:
            projects.append(item.get("project", ""))
            owners.append(item.get("owner", ""))
            fundings.append(item.get("funding", ""))
    return {
        "project": "、".join(sorted({value for value in projects if value})),
        "pi": pi_name,
        "owner": "、".join(sorted({value for value in owners if value})),
        "funding": "、".join(sorted({value for value in fundings if value})),
    }
