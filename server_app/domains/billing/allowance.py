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


def tier_cage_priority_sort_key(item):
    priority = as_int(item.get("tierCagePriority"))
    billable_capacity = max(as_int(item.get("billableCapacity")) or 0, 0)
    count = max(as_int(item.get("cageCount")) or 0, 0)
    iacuc = normalize_iacuc_number(item.get("iacuc", ""))
    if priority is None:
        return (1, -billable_capacity, -count, iacuc)
    return (0, max(priority, 0), -billable_capacity, -count, iacuc)


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
        if item.get("freeEligible") is False:
            continue
        count_source = item.get("animalCount") if item.get("billingUnit") == "animal_day" else item.get("cageCount")
        count = max(as_int(count_source) or 0, 0)
        iacuc = normalize_iacuc_number(item.get("iacuc", ""))
        if not count or not iacuc:
            continue
        if item.get("fullExemption"):
            allocations[iacuc] = allocations.get(iacuc, 0) + count
            continue
        if not item.get("freeAllowance") or item.get("billingUnit") != "cage_day":
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


def apply_free_cage_allocations(breakdown, allocations):
    remaining = dict(allocations or {})
    for item in breakdown or []:
        iacuc = normalize_iacuc_number(item.get("iacuc", ""))
        count_source = item.get("animalCount") if item.get("billingUnit") == "animal_day" else item.get("cageCount")
        count = max(as_int(count_source) or 0, 0)
        applied = min(max(as_int(remaining.get(iacuc)) or 0, 0), count)
        item["freeCages"] = applied
        remaining[iacuc] = max((as_int(remaining.get(iacuc)) or 0) - applied, 0)
    return breakdown


def apply_tiered_breakdown_charges(breakdown, tier_limit=160):
    groups = {}
    for item in breakdown or []:
        item["tier1Cages"] = 0
        item["tier2Cages"] = 0
        item["tier1BillableCages"] = 0
        item["tier2BillableCages"] = 0
        item["billableCages"] = 0
        item["billableAnimals"] = 0
        item["supportAmount"] = 0.0
        item["payableAmount"] = 0.0
        item["amount"] = 0.0
        count_source = item.get("animalCount") if item.get("billingUnit") == "animal_day" else item.get("cageCount")
        count = max(as_int(count_source) or 0, 0)
        free = min(max(as_int(item.get("freeCages")) or 0, 0), count)
        unit_price = float(item.get("unitPrice") or 0)
        overage_unit_price = float(item.get("overageUnitPrice") or unit_price or 0)
        if item.get("billingUnit") == "animal_day" or not item.get("tiered"):
            billable = max(count - free, 0)
            item["freeCages"] = free
            item["billableAnimals"] = billable if item.get("billingUnit") == "animal_day" else 0
            item["billableCages"] = billable if item.get("billingUnit") != "animal_day" else 0
            item["tier1Cages"] = count if item.get("billingUnit") != "animal_day" else 0
            item["tier1BillableCages"] = billable if item.get("billingUnit") != "animal_day" else 0
            item["supportAmount"] = free * unit_price
            item["payableAmount"] = billable * unit_price
            item["amount"] = item["supportAmount"] + item["payableAmount"]
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
        groups.setdefault(key, []).append(item)

    for entries in groups.values():
        group_count = 0
        group_tier2_cages = 0
        aggregated_by_iacuc = {}
        for item in entries:
            iacuc = normalize_iacuc_number(item.get("iacuc", "")) or f"__item__{id(item)}"
            count = max(as_int(item.get("cageCount")) or 0, 0)
            free = min(max(as_int(item.get("freeCages")) or 0, 0), count)
            state = aggregated_by_iacuc.setdefault(
                iacuc,
                {
                    "iacuc": iacuc,
                    "items": [],
                    "cageCount": 0,
                    "freeCages": 0,
                    "billableCapacity": 0,
                    "tierCagePriority": as_int(item.get("tierCagePriority")),
                },
            )
            state["items"].append(item)
            state["cageCount"] += count
            state["freeCages"] += free
            state["billableCapacity"] += max(count - free, 0)
            if state.get("tierCagePriority") is None:
                state["tierCagePriority"] = as_int(item.get("tierCagePriority"))
            group_count += count
        ordered_iacucs = sorted(aggregated_by_iacuc.values(), key=tier_cage_priority_sort_key)
        remaining_raw_tier = max(group_count - (as_int(tier_limit) or 0), 0)
        remaining_billable_tier = remaining_raw_tier
        for state in ordered_iacucs:
            state["rawTierAllocation"] = min(remaining_raw_tier, state["cageCount"])
            state["billableTierAllocation"] = min(remaining_billable_tier, state["billableCapacity"])
            remaining_raw_tier = max(remaining_raw_tier - state["rawTierAllocation"], 0)
            remaining_billable_tier = max(remaining_billable_tier - state["billableTierAllocation"], 0)
            group_tier2_cages += state["rawTierAllocation"]
        for state in ordered_iacucs:
            remaining_item_tier_billable = state["billableTierAllocation"]
            for item in sorted(state["items"], key=lambda current: -max(as_int(current.get("cageCount")) or 0, 0)):
                count = max(as_int(item.get("cageCount")) or 0, 0)
                free = min(max(as_int(item.get("freeCages")) or 0, 0), count)
                unit_price = float(item.get("unitPrice") or 0)
                overage_unit_price = float(item.get("overageUnitPrice") or unit_price or 0)
                billable_capacity = max(count - free, 0)
                tier2_billable = min(remaining_item_tier_billable, billable_capacity)
                remaining_item_tier_billable = max(remaining_item_tier_billable - tier2_billable, 0)
                tier1_count = max(count - tier2_billable, 0)
                tier1_free = min(free, tier1_count)
                tier1_billable = max(tier1_count - tier1_free, 0)
                item["tier1Cages"] = tier1_count
                item["tier2Cages"] = tier2_billable
                item["tier1BillableCages"] = tier1_billable
                item["tier2BillableCages"] = tier2_billable
                item["billableCages"] = tier1_billable + tier2_billable
                item["supportAmount"] = tier1_free * unit_price
                item["payableAmount"] = tier1_billable * unit_price + tier2_billable * overage_unit_price
                item["amount"] = item["supportAmount"] + item["payableAmount"]
    return breakdown


def summarize_breakdown_charges(breakdown, tier_limit=160):
    apply_tiered_breakdown_charges(breakdown, tier_limit)
    grouped_counts = {}
    non_tiered_tier1_cages = 0
    total = {
        "freeCages": 0,
        "billableCages": 0,
        "tier1Cages": 0,
        "tier2Cages": 0,
        "tier1BillableCages": 0,
        "tier2BillableCages": 0,
        "billableAnimals": 0,
        "unitPrice": 0,
        "overageUnitPrice": 0,
        "discountPercent": 0,
        "amount": 0.0,
    }
    for item in breakdown or []:
        if item.get("billingUnit") == "cage_day" and item.get("tiered"):
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
            grouped_counts[key] = grouped_counts.get(key, 0) + max(as_int(item.get("cageCount")) or 0, 0)
        total["freeCages"] += max(as_int(item.get("freeCages")) or 0, 0)
        total["billableCages"] += max(as_int(item.get("billableCages")) or 0, 0)
        total["tier1BillableCages"] += max(as_int(item.get("tier1BillableCages")) or 0, 0)
        total["tier2BillableCages"] += max(as_int(item.get("tier2BillableCages")) or 0, 0)
        total["billableAnimals"] += max(as_int(item.get("billableAnimals")) or 0, 0)
        if not (item.get("billingUnit") == "cage_day" and item.get("tiered")):
            non_tiered_tier1_cages += max(as_int(item.get("tier1Cages")) or 0, 0)
        total["amount"] += float(item.get("payableAmount") or 0)
        if item.get("unitPrice") not in (None, ""):
            total["unitPrice"] = float(item.get("unitPrice") or 0)
        if item.get("overageUnitPrice") not in (None, ""):
            total["overageUnitPrice"] = float(item.get("overageUnitPrice") or 0)
    total["tier2Cages"] = sum(max(count - (as_int(tier_limit) or 0), 0) for count in grouped_counts.values())
    total["tier1Cages"] = non_tiered_tier1_cages + sum(
        min(count, as_int(tier_limit) or 0) for count in grouped_counts.values()
    )
    return total


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
