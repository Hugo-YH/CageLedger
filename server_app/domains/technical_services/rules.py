"""Service quantities and money are calculated without cage allowances."""

import re
from datetime import date
from decimal import ROUND_HALF_UP, Decimal, InvalidOperation


def validate_month(value):
    if not isinstance(value, str) or not re.fullmatch(r"\d{4}-\d{2}", value):
        raise ValueError("月份格式应为 YYYY-MM")
    date.fromisoformat(value + "-01")
    return value


def daily_rows(rows, month, unit, price):
    if not isinstance(rows, list) or not rows or len(rows) > 31:
        raise ValueError("请填写1至31条日期数量记录")
    seen, result = set(), []
    for row in rows:
        if not isinstance(row, dict):
            raise ValueError("服务明细必须为对象")
        day = row.get("date", "")
        date.fromisoformat(day)
        if day[:7] != month or day in seen:
            raise ValueError("日期必须属于所选月份且不能重复")
        seen.add(day)
        value = row.get("quantity")
        if isinstance(value, bool) or not isinstance(value, int | float):
            raise ValueError("计费数量必须为有效数字")
        try:
            quantity = Decimal(str(value))
        except InvalidOperation as exc:
            raise ValueError("计费数量无效") from exc
        if not quantity.is_finite() or quantity < 0 or quantity > 1_000_000:
            raise ValueError("计费数量须为0至100万之间的有限数字")
        if unit == "小时":
            if 0 < quantity < 1:
                raise ValueError("请填写已确认计费小时数，实际服务不足1小时按1小时计费")
        elif quantity != quantity.to_integral_value():
            raise ValueError("该服务计费数量必须为整数")
        amount = (quantity * Decimal(str(price))).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
        result.append({"date": day, "quantity": float(quantity), "amount": float(amount)})
    return sorted(result, key=lambda r: r["date"])


def money_sum(rows):
    return float(sum((Decimal(str(r["amount"])) for r in rows), Decimal(0)))
