"""Opt-in calendar-month normalization for reviewed intake batch writes."""

from datetime import date

from server_app.domains.intake.husbandry_period import calendar_month_end, normalize_husbandry_months
from server_app.domains.intake.purpose import is_direct_sampling


def normalize_calendar_batch(batch, previous=None):
    result = dict(batch)
    previous = previous or {}
    if "husbandryMonths" not in result and normalize_husbandry_months(previous.get("husbandryMonths")):
        dates_changed = any(
            field in result and result[field] != previous.get(field)
            for field in ("intakeDate", "endDate", "husbandryDays")
        )
        result["husbandryMonths"] = None if dates_changed else previous["husbandryMonths"]
    if "husbandryMonths" not in result:
        return result
    raw = result["husbandryMonths"]
    months = normalize_husbandry_months(raw)
    if is_direct_sampling(result):
        result["husbandryMonths"] = None
    elif raw is not None and months is None:
        raise ValueError("饲养周期自然月数必须为有效正整数")
    elif months is not None:
        start = result.get("intakeDate", previous.get("intakeDate")) or ""
        end = calendar_month_end(start, months) if start else ""
        if start and not end:
            raise ValueError("接收日期或自然月周期超出有效日期范围")
        result.update(
            husbandryMonths=months,
            endDate=end,
            husbandryDays=(date.fromisoformat(end) - date.fromisoformat(start)).days if end else None,
        )
    return result
