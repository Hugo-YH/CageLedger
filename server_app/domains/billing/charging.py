import calendar

from server_app.domains.iacuc import normalize_iacuc_number
from server_app.shared import as_int

BILLING_TIER_LIMIT = 160

BILLING_TIER_BASE_PRICE = 4.5

BILLING_TIER_OVER_PRICE = 6.5


def dates_in_month(month):
    year, month_no = [int(part) for part in month.split("-")]
    day_count = calendar.monthrange(year, month_no)[1]
    return [f"{year:04d}-{month_no:02d}-{day:02d}" for day in range(1, day_count + 1)]


def tiered_daily_charge(cage_count, free_cages):
    cage_count = max(as_int(cage_count) or 0, 0)
    free_cages = min(max(as_int(free_cages) or 0, 0), cage_count)
    tier1_cages = min(cage_count, BILLING_TIER_LIMIT)
    tier2_cages = max(cage_count - BILLING_TIER_LIMIT, 0)
    tier1_free = min(free_cages, tier1_cages)
    tier2_free = min(max(free_cages - tier1_free, 0), tier2_cages)
    tier1_billable = max(tier1_cages - tier1_free, 0)
    tier2_billable = max(tier2_cages - tier2_free, 0)
    amount = tier1_billable * BILLING_TIER_BASE_PRICE + tier2_billable * BILLING_TIER_OVER_PRICE
    return {
        "freeCages": free_cages,
        "billableCages": tier1_billable + tier2_billable,
        "tier1Cages": tier1_cages,
        "tier2Cages": tier2_cages,
        "tier1BillableCages": tier1_billable,
        "tier2BillableCages": tier2_billable,
        "unitPrice": BILLING_TIER_BASE_PRICE,
        "overageUnitPrice": BILLING_TIER_OVER_PRICE,
        "discountPercent": 0,
        "amount": amount,
    }


def flat_daily_charge(count, profile):
    count = max(as_int(count) or 0, 0)
    amount = count * float(profile.get("unitPrice") or 0)
    if profile.get("unit") == "animal_day":
        return {
            "freeCages": 0,
            "billableCages": 0,
            "tier1Cages": 0,
            "tier2Cages": 0,
            "tier1BillableCages": 0,
            "tier2BillableCages": 0,
            "billableAnimals": count,
            "unitPrice": profile.get("unitPrice") or 0,
            "overageUnitPrice": 0,
            "discountPercent": 0,
            "amount": amount,
        }
    return {
        "freeCages": 0,
        "billableCages": count,
        "tier1Cages": count,
        "tier2Cages": 0,
        "tier1BillableCages": count,
        "tier2BillableCages": 0,
        "billableAnimals": 0,
        "unitPrice": profile.get("unitPrice") or 0,
        "overageUnitPrice": 0,
        "discountPercent": 0,
        "amount": amount,
    }


def add_charge_group(groups, profile, count):
    count = max(as_int(count) or 0, 0)
    if count <= 0:
        return
    key = "|".join(
        [
            profile.get("billingItem", ""),
            profile.get("customerType", ""),
            profile.get("unit", ""),
            str(profile.get("unitPrice") or 0),
        ]
    )
    if key not in groups:
        groups[key] = {"profile": profile, "count": 0}
    groups[key]["count"] += count


def combined_daily_charge(groups, free_cages):
    total = {
        "freeCages": 0,
        "billableCages": 0,
        "tier1Cages": 0,
        "tier2Cages": 0,
        "tier1BillableCages": 0,
        "tier2BillableCages": 0,
        "billableAnimals": 0,
        "unitPrice": BILLING_TIER_BASE_PRICE,
        "overageUnitPrice": BILLING_TIER_OVER_PRICE,
        "discountPercent": 0,
        "amount": 0,
    }
    remaining_free_cages = max(as_int(free_cages) or 0, 0)
    for group in groups.values():
        profile = group["profile"]
        count = group["count"]
        if profile.get("tiered"):
            allowance = remaining_free_cages if profile.get("freeAllowance") else 0
            charges = tiered_daily_charge(count, allowance)
            remaining_free_cages = max(remaining_free_cages - charges.get("freeCages", 0), 0)
        else:
            charges = flat_daily_charge(count, profile)
        for key in (
            "freeCages",
            "billableCages",
            "tier1Cages",
            "tier2Cages",
            "tier1BillableCages",
            "tier2BillableCages",
            "billableAnimals",
            "amount",
        ):
            total[key] += charges.get(key, 0)
        total["unitPrice"] = charges.get("unitPrice", total["unitPrice"])
        if charges.get("overageUnitPrice"):
            total["overageUnitPrice"] = charges.get("overageUnitPrice")
    return total


def statement_billing_unit_from_lines(lines):
    has_animals = any((line.get("animalCount") or 0) > 0 for line in lines)
    has_cages = any((line.get("cageCount") or 0) > 0 for line in lines)
    if has_animals and has_cages:
        return "mixed"
    return "animal_day" if has_animals else "cage_day"


def occupancy_active_on_date(item, date):
    if item.get("status") not in ("active", "ended"):
        return False
    if not item.get("startDate") or item.get("startDate") > date:
        return False
    if item.get("endDate") and item.get("endDate") < date:
        return False
    return True


def billing_unit_price_for(rules, date):
    for rule in rules:
        after_start = not rule.get("effectiveStart") or rule.get("effectiveStart") <= date
        before_end = not rule.get("effectiveEnd") or rule.get("effectiveEnd") >= date
        if rule.get("unit") == "cage_day" and after_start and before_end:
            return float(rule.get("price") or 0)
    return 4.5


def billing_discount_for(adjustments, iacuc, date):
    for adjustment in adjustments:
        in_range = (not adjustment.get("effectiveStart") or adjustment.get("effectiveStart") <= date) and (
            not adjustment.get("effectiveEnd") or adjustment.get("effectiveEnd") >= date
        )
        if (
            adjustment.get("targetType") == "iacuc"
            and normalize_iacuc_number(adjustment.get("targetId", "")) == iacuc
            and adjustment.get("type") == "discount"
            and in_range
        ):
            return float(adjustment.get("value") or 0)
    return 0
