from server_app.domains.iacuc import normalize_application_date, normalize_iacuc_number
from server_app.shared import as_int, clean_text

BILLING_PRINCIPAL_PI = "pi"

BILLING_PRINCIPAL_INDEPENDENT = "independent"

FREE_CAGES_PI = 20

FREE_CAGES_INDEPENDENT = 10

FREE_CAGES_DEFAULT = FREE_CAGES_PI


def free_cage_allocation_sort_key(item):
    priority = as_int(item.get("freeCagePriority"))
    priority_value = priority if priority is not None else 999999
    return (max(priority_value, 0), normalize_iacuc_number(item.get("iacuc", "")))


def iacuc_free_allowance_eligible(application, target_date):
    start_date = normalize_application_date((application or {}).get("projectStartDate", ""))
    end_date = normalize_application_date((application or {}).get("projectEndDate", ""))
    if start_date and target_date < start_date:
        return False
    if end_date and target_date > end_date:
        return False
    return True


def allocate_daily_free_cages_by_iacuc(breakdown, free_cages):
    remaining_by_iacuc = {}
    allocations = {}
    eligible = []
    for item in breakdown or []:
        if not item.get("freeAllowance") or item.get("freeEligible") is False or item.get("billingUnit") != "cage_day":
            continue
        count = max(as_int(item.get("cageCount")) or 0, 0)
        iacuc = normalize_iacuc_number(item.get("iacuc", ""))
        if not count or not iacuc:
            continue
        entry = {
            "iacuc": iacuc,
            "cageCount": count,
            "preferredFreeCages": max(as_int(item.get("preferredFreeCages")) or 0, 0),
            "freeCagePriority": as_int(item.get("freeCagePriority")),
        }
        eligible.append(entry)
        remaining_by_iacuc[iacuc] = remaining_by_iacuc.get(iacuc, 0) + count
        allocations.setdefault(iacuc, 0)

    remaining = max(as_int(free_cages) or 0, 0)
    for item in sorted(
        (entry for entry in eligible if entry["preferredFreeCages"] > 0), key=free_cage_allocation_sort_key
    ):
        if remaining <= 0:
            break
        current_remaining = remaining_by_iacuc.get(item["iacuc"], 0)
        applied = min(item["preferredFreeCages"], current_remaining, remaining)
        if applied <= 0:
            continue
        allocations[item["iacuc"]] = allocations.get(item["iacuc"], 0) + applied
        remaining_by_iacuc[item["iacuc"]] = current_remaining - applied
        remaining -= applied

    while remaining > 0:
        candidates = [
            {**item, "remainingCages": remaining_by_iacuc.get(item["iacuc"], 0)}
            for item in eligible
            if remaining_by_iacuc.get(item["iacuc"], 0) > 0
        ]
        if not candidates:
            break
        coverable = sorted(
            (item for item in candidates if item["remainingCages"] <= remaining), key=free_cage_allocation_sort_key
        )
        if coverable:
            target = coverable[0]
            allocations[target["iacuc"]] = allocations.get(target["iacuc"], 0) + target["remainingCages"]
            remaining_by_iacuc[target["iacuc"]] = 0
            remaining -= target["remainingCages"]
            continue
        target = sorted(candidates, key=free_cage_allocation_sort_key)[0]
        allocations[target["iacuc"]] = allocations.get(target["iacuc"], 0) + remaining
        remaining_by_iacuc[target["iacuc"]] = max(target["remainingCages"] - remaining, 0)
        remaining = 0

    return allocations


def billing_free_cages_for(adjustments, pi_name):
    for adjustment in adjustments:
        if (
            adjustment.get("targetType") == "pi"
            and clean_text(adjustment.get("targetId", "")) == pi_name
            and adjustment.get("type") == "free_cages"
        ):
            if adjustment.get("principalType"):
                return free_cages_for_principal_type(adjustment.get("principalType"))
            return max(as_int(adjustment.get("value")) or 0, 0)
    return FREE_CAGES_DEFAULT


def billing_free_cages_for_pi(principal_type_by_pi, pi_name):
    return free_cages_for_principal_type(principal_type_by_pi.get(clean_text(pi_name), BILLING_PRINCIPAL_INDEPENDENT))


def normalize_principal_type(value):
    return BILLING_PRINCIPAL_PI if value == BILLING_PRINCIPAL_PI else BILLING_PRINCIPAL_INDEPENDENT


def free_cages_for_principal_type(value):
    return FREE_CAGES_PI if normalize_principal_type(value) == BILLING_PRINCIPAL_PI else FREE_CAGES_INDEPENDENT


def principal_type_label(value):
    return "PI" if normalize_principal_type(value) == BILLING_PRINCIPAL_PI else "独立科研人员"
