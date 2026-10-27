"""Normalize age/weight facts only; never infer them from husbandry duration."""

import re
import unicodedata
from decimal import Decimal

_MISSING = frozenset(("", "-", "--", "—", "–", "/", "无", "未填", "不详", "未知", "n/a", "null"))
_UNIT = r"(?:千克|公斤|kg|克|g|周龄|周|weeks?|wks?|wk|w|个月龄|个月|月龄|月|months?|mos?|m|岁龄|岁|年龄|年|years?|yrs?|yr|y|日龄|天龄|天|日|days?|d)"
_VALUE = r"\d+(?:\.\d+)?"
_MEASUREMENT = re.compile(
    rf"(?<![a-zA-Z0-9.])(?P<low>{_VALUE})\s*(?:(?P<first>{_UNIT})\s*)?"
    rf"(?:(?:-|~|～|至|到|–|—)\s*(?P<high>{_VALUE})\s*)?(?P<unit>{_UNIT})(?![a-z])",
    re.IGNORECASE,
)


def is_missing_specification(value):
    return str(value or "").strip().casefold() in _MISSING


def _unit(raw):
    text = raw.lower()
    if text in ("kg", "千克", "公斤"):
        return "kg"
    if text in ("g", "克"):
        return "g"
    if text.startswith(("w", "周")):
        return "w"
    if text.startswith("m") or "月" in text:
        return "m"
    if text.startswith(("y", "年", "岁")):
        return "y"
    return "d"


def normalize_specification(raw):
    """Return canonical age/weight text and whether a nonempty fact needs review."""
    if is_missing_specification(raw):
        return "", False
    text = unicodedata.normalize("NFKC", str(raw))[:2000]
    measurements = []
    invalid = False
    for match in _MEASUREMENT.finditer(text):
        prefix = re.split(r"[/,，;；\n]", text[: match.start()])[-1]
        suffix = re.split(r"[/,，;；\n]", text[match.end() :])[0]
        if re.search(
            r"饲养|周期|下单|赠送|数量|延期|之后|到货|交货|收货|运输|配送|取材|期限|术后|术前|隔离|检疫|预计|观察",
            prefix,
        ) or re.match(r"\s*(?:后|内|前).*(?:到货|交货|收货|取材|饲养|运输|观察)", suffix):
            continue
        low = Decimal(match["low"])
        high = Decimal(match["high"]) if match["high"] else low
        unit = _unit(match["unit"])
        if low <= 0 or high < low or (match["first"] and _unit(match["first"]) != unit):
            invalid = True
            continue

        def number(value):
            return format(value.normalize(), "f")

        value = f"{number(low)}-{number(high)}{unit}" if match["high"] else f"{number(low)}{unit}"
        if value not in measurements:
            measurements.append(value)
    # Multiple incompatible values of one dimension must not silently become one specification.
    dimensions = ["weight" if item.endswith(("g", "kg")) else "age" for item in measurements]
    if invalid or len(set(dimensions)) != len(dimensions):
        return "", True
    return " / ".join(measurements), not bool(measurements)
