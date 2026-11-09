"""Reconcile an actual arrival date without shortening the agreed husbandry period."""

from datetime import date, timedelta

from .husbandry_period import calendar_month_end

PERIOD_FIELDS = ("endDate", "husbandryMonths", "husbandryDays")


def supplement_period(existing, incoming, merged, image_fields, resolutions=None):
    resolutions = resolutions or {}
    if merged.get("intakePurpose", "housing") == "direct_sampling":
        return None
    selected_days = merged.get("husbandryDays") if "husbandryDays" in resolutions else None
    if (
        "husbandryDays" in image_fields
        and "husbandryMonths" not in image_fields
        and "husbandryMonths" not in resolutions
    ):
        merged["husbandryMonths"] = None
    if not merged.get("intakeDate"):
        return None
    changed = any(existing.get(field) != merged.get(field) for field in ("intakeDate", *PERIOD_FIELDS))
    if not changed:
        return None
    period_source = "saved"
    if "husbandryMonths" in resolutions or "husbandryMonths" in image_fields and incoming.get("husbandryMonths"):
        months, days = merged.get("husbandryMonths"), None
        period_source = resolutions.get("husbandryMonths", "incoming")
    elif "husbandryDays" in image_fields and incoming.get("husbandryDays") is not None:
        months, days = None, incoming["husbandryDays"]
        period_source = "incoming"
    elif existing.get("husbandryMonths") or existing.get("husbandryDays") is not None:
        months, days = existing.get("husbandryMonths"), existing.get("husbandryDays")
    else:
        months, days = merged.get("husbandryMonths"), merged.get("husbandryDays")
        period_source = "incoming"
    start = date.fromisoformat(merged["intakeDate"])
    chosen_end = merged.get("endDate") if "endDate" in resolutions else None
    explicit_period = any(field in resolutions for field in ("husbandryMonths", "husbandryDays"))
    if chosen_end and not explicit_period:
        months, days = None, None
        merged["husbandryMonths"] = None
    if months:
        end = calendar_month_end(start.isoformat(), months)
        if not end:
            raise ValueError("接收日期与自然月周期超出有效日期范围，请核对。")
        merged["endDate"], merged["husbandryMonths"] = end, months
        basis = "calendar_months"
    elif days is not None:
        try:
            merged["endDate"] = (start + timedelta(days=days)).isoformat()
        except OverflowError as exc:
            raise ValueError("接收日期与饲养天数超出有效日期范围，请核对。") from exc
        merged["husbandryMonths"] = None
        basis = "fixed_days"
    elif merged.get("endDate"):
        basis = "date_range"
        period_source = resolutions.get("endDate") or ("saved" if existing.get("endDate") else "incoming")
    else:
        return None
    if chosen_end and explicit_period and chosen_end != merged["endDate"]:
        raise ValueError("所选结束日期与所选饲养周期不一致，请调整其中一项后合并。")
    days = (date.fromisoformat(merged["endDate"]) - start).days
    if days < 0:
        raise ValueError("补充日期晚于已有结束日期，且没有可确认的饲养周期，请核对。")
    if selected_days is not None and days != selected_days:
        raise ValueError("所选饲养天数与所选日期或自然月周期不一致，请调整后合并。")
    merged["husbandryDays"] = days
    return {
        "basis": basis,
        "periodSource": period_source,
        "startDate": start.isoformat(),
        "endDate": merged["endDate"],
        "days": days,
        **({"months": months} if months else {}),
    }


def calculated_comparisons(rows, merged, changes):
    calculation = next((row["calculation"] for row in changes if row.get("calculation")), None)
    if not calculation:
        return rows
    result = []
    for row in rows:
        row = dict(row)
        if row["field"] in PERIOD_FIELDS and (
            row["field"] != "husbandryMonths" or calculation.get("months") or row["before"] != merged.get(row["field"])
        ):
            row["calculation"] = calculation
            row["status"] = "retained" if row["before"] == merged.get(row["field"]) else "calculated"
        result.append(row)
    return result
