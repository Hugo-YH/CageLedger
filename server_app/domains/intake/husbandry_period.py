"""Parse evidenced calendar-month periods and perform calendar arithmetic."""

import calendar
import re
from datetime import date


def normalize_husbandry_months(value):
    if isinstance(value, bool):
        return None
    text = str(value).strip()
    number = int(text) if re.fullmatch(r"[1-9]\d{0,3}", text) else None
    return number if number is not None and number <= 1200 else None


def husbandry_month_values(raw_review_notes):
    """Keep distinct evidenced month counts so conflicts cannot masquerade as missing data."""
    text = str(raw_review_notes or "")
    number = r"(\d{1,7}|[一二两三四五六七八九十]+)"
    pattern = rf"(?:饲养(?:周期|时间|期限)?|周期|饲养期)\s*(?:为|是|共|:|：)?\s*{number}\s*个?\s*(?:自然月|月)(?!龄)"
    chinese = {"一": 1, "二": 2, "两": 2, "三": 3, "四": 4, "五": 5, "六": 6, "七": 7, "八": 8, "九": 9, "十": 10}
    values = set()
    for match in re.finditer(pattern, text):
        prefix = re.split(r"[，,；;。\n]", text[: match.start()])[-1]
        if re.search(r"不是|不按|无需|不需要|取消|不再", prefix):
            continue
        raw = match.group(1)
        value = normalize_husbandry_months(raw)
        if value is None and raw in chinese:
            value = chinese[raw]
        if value:
            values.add(value)
    return values


def parse_husbandry_months(raw_review_notes):
    """Require an explicit period or husbandry context, and reject ambiguity."""
    values = husbandry_month_values(raw_review_notes)
    return next(iter(values)) if len(values) == 1 else None


def calendar_month_end(start, months):
    months = normalize_husbandry_months(months)
    if months is None:
        return ""
    try:
        day = date.fromisoformat(start)
        absolute = day.year * 12 + day.month - 1 + months
        year, month_zero = divmod(absolute, 12)
        month = month_zero + 1
        return date(year, month, min(day.day, calendar.monthrange(year, month)[1])).isoformat()
    except (TypeError, ValueError, OverflowError):
        return ""
