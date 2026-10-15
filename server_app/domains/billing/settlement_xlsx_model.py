"""Settlement column identities, daily projections, labels and Excel formulas."""

from openpyxl.utils import get_column_letter

_UNIT_LABELS = {"cage_day": "笼/天", "animal_day": "只/天", "mixed": "混合"}
_SPECIES_ORDER = {"mouse": 0, "rat": 1, "guinea_pig": 2, "rabbit": 3, "monkey": 4, "pig": 5, "dog": 6}
_SPECIES_LABELS = {
    "mouse": "小鼠",
    "rat": "大鼠",
    "guinea_pig": "豚鼠",
    "rabbit": "兔",
    "monkey": "猴",
    "pig": "猪",
    "dog": "犬",
}


def _as_int(value):
    try:
        return int(float(value or 0))
    except (TypeError, ValueError):
        return 0


def _as_money(value):
    try:
        return round(float(value or 0), 2)
    except (TypeError, ValueError):
        return 0.0


def _column_key(item):
    return "|".join(
        [
            str(item.get("iacuc") or ""),
            str(item.get("species") or ""),
            str(item.get("billingItem") or ""),
            str(item.get("billingUnit") or ""),
            f"{_as_money(item.get('statementUnitPrice', item.get('unitPrice'))):.2f}",
            f"{_as_money(item.get('statementOverageUnitPrice', item.get('overageUnitPrice'))):.2f}",
            "1" if item.get("statementTiered", item.get("tiered")) else "0",
            "1" if item.get("statementFreeAllowance", item.get("freeAllowance")) else "0",
            "1" if item.get("statementFullExemption", item.get("fullExemption")) else "0",
        ]
    )


def _statement_columns(statement, lines):
    iacuc_order = {iacuc: index for index, iacuc in enumerate(statement.get("iacucs") or [])}
    columns = []
    seen = set()
    for line in lines:
        for item in line.get("iacucBreakdown") or []:
            key = _column_key(item)
            if key in seen:
                continue
            seen.add(key)
            unit = str(item.get("billingUnit") or "cage_day")
            columns.append(
                {
                    "key": key,
                    "iacuc": str(item.get("iacuc") or ""),
                    "species": str(item.get("species") or ""),
                    "unit": unit,
                    "basePrice": _as_money(item.get("statementUnitPrice", item.get("unitPrice"))),
                    "overagePrice": _as_money(item.get("statementOverageUnitPrice", item.get("overageUnitPrice"))),
                    "tiered": bool(item["tiered"]) if "tiered" in item else bool(item.get("statementTiered")),
                    "freeAllowance": bool(item.get("statementFreeAllowance", item.get("freeAllowance"))),
                    "fullExemption": bool(item.get("statementFullExemption", item.get("fullExemption"))),
                    "hasCustom": False,
                }
            )
    for line in lines:
        for item in line.get("iacucBreakdown") or []:
            if not item.get("customBilling"):
                continue
            key = _column_key(item)
            for column in columns:
                if column["key"] == key:
                    column["hasCustom"] = True
    columns.sort(
        key=lambda column: (
            _SPECIES_ORDER.get(column["species"], len(_SPECIES_ORDER)),
            iacuc_order.get(column["iacuc"], 10**9),
            column["iacuc"],
            column["unit"],
            column["basePrice"],
        )
    )
    return columns


def _custom_range(item):
    start = str(item.get("customBillingStartDate") or "").strip()
    end = str(item.get("customBillingEndDate") or "").strip()
    if start and end:
        return f"{start} ~ {end}"
    return start or end or ""


def _statement_rows(lines, columns):
    rows = []
    for line in lines:
        per_column = {
            column["key"]: {"count": 0, "free": 0, "tier1": 0, "tier2": 0, "amount": 0.0} for column in columns
        }
        custom = []
        has_activity = False
        for item in line.get("iacucBreakdown") or []:
            key = _column_key(item)
            if key in per_column:
                cell = per_column[key]
                cell["count"] += _as_int(item.get("cageCount") or item.get("animalCount"))
                cell["free"] += _as_int(item.get("freeCages"))
                cell["tier1"] += _as_int(item.get("tier1BillableCages"))
                cell["tier2"] += _as_int(item.get("tier2BillableCages"))
                payable = item.get("payableAmount")
                cell["amount"] += _as_money(payable if payable is not None else item.get("amount"))
            if item.get("customBilling"):
                quantity = _as_int(item.get("cageCount") or item.get("animalCount"))
                custom.append(
                    {
                        "date": line.get("date", ""),
                        "iacuc": str(item.get("iacuc") or ""),
                        "range": _custom_range(item),
                        "quantity": quantity,
                        "unitPrice": _as_money(item.get("unitPrice")),
                        "note": str(item.get("customBillingNote") or ""),
                    }
                )
                has_activity = has_activity or quantity > 0
            elif key in per_column:
                cell = per_column[key]
                if cell["count"] or cell["free"] or cell["tier1"] or cell["tier2"] or cell["amount"]:
                    has_activity = True
        if has_activity:
            rows.append({"date": line.get("date", ""), "perColumn": per_column, "custom": custom})
    return rows


def _sanitize_sheet_name(name):
    cleaned = "".join("_" if character in "[]:*?/\\" else character for character in name)
    return (cleaned or "结算单")[:31]


def _count_label(unit):
    if unit == "animal_day":
        return "只数"
    if unit == "mixed":
        return "总量"
    return "笼数"


def _species_label(value):
    return _SPECIES_LABELS.get(str(value or "").strip().lower(), str(value or "动物"))


def _leading_count_label(unit):
    if unit == "animal_day":
        return "总数量"
    if unit == "mixed":
        return "总量"
    return "总笼数"


def _amount_formula(count_cell, free_cell, tier_cell, base_price, overage_price, data_row):
    def ref(cell):
        return f"{get_column_letter(cell)}{data_row}"

    count_ref = ref(count_cell)
    billable_expr = count_ref
    if free_cell:
        billable_expr = f"({count_ref}-{ref(free_cell)}"
        if tier_cell:
            billable_expr += f"-{ref(tier_cell)}"
        billable_expr += ")"
    elif tier_cell:
        billable_expr = f"({count_ref}-{ref(tier_cell)})"
    tier_expr = ref(tier_cell) if tier_cell else "0"
    return f"=ROUND({billable_expr}*{base_price:.2f}+{tier_expr}*{overage_price:.2f},2)"
