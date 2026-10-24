"""Settlement column identities, row projections and summary measures."""

from server_app.pdf.formatting import normalize_iacuc, species_label

from .document_formatting import as_number


def statement_columns(statement, lines):
    order = {normalize_iacuc(value): index for index, value in enumerate(statement.get("iacucs") or [])}
    columns = {}
    for line in lines:
        for item in line.get("iacucBreakdown") or []:
            iacuc = normalize_iacuc(item.get("iacuc"))
            if not iacuc:
                continue
            key = breakdown_key(item)
            if key in columns:
                columns[key]["hasTieredCharge"] = (
                    columns[key]["hasTieredCharge"] or as_number(item.get("tier2BillableCages")) > 0
                )
                continue
            columns[key] = {
                "key": key,
                "iacuc": iacuc,
                "species": species_label(item),
                "unit": str(item.get("billingUnit") or ""),
                "unitPrice": as_number(item.get("statementUnitPrice", item.get("unitPrice"))),
                "overageUnitPrice": as_number(item.get("statementOverageUnitPrice", item.get("overageUnitPrice"))),
                "tiered": bool(item["tiered"]) if "tiered" in item else bool(item.get("statementTiered")),
                "hasTieredCharge": as_number(item.get("tier2BillableCages")) > 0,
                "fullExemption": bool(item.get("statementFullExemption", item.get("fullExemption"))),
            }
    sorted_columns = sorted(
        columns.values(),
        key=lambda item: (
            SPECIES_ORDER.get(item["species"], len(SPECIES_ORDER)),
            order.get(item["iacuc"], 10**9),
            item["iacuc"],
            item["unit"],
            item["unitPrice"],
        ),
    )
    labels = {}
    for item in sorted_columns:
        base = _statement_column_label(item)
        labels[base] = labels.get(base, 0) + 1
    for item in sorted_columns:
        base = _statement_column_label(item)
        suffix = f" / ¥{item['unitPrice']:.2f}" if labels[base] > 1 else ""
        item["label"] = f"{base}{suffix}"
    return sorted_columns


def _statement_column_label(item):
    return item["iacuc"]


def statement_row(line, columns, unit):
    values = {column["key"]: empty_summary() for column in columns}
    for item in line.get("iacucBreakdown") or []:
        key = breakdown_key(item)
        if key not in values:
            continue
        current = values[key]
        count = as_number(item.get("animalCount") if item.get("billingUnit") == "animal_day" else item.get("cageCount"))
        free = as_number(item.get("freeCages"))
        current["count"] += count
        current["free"] += free
        current["support"] += as_number(item.get("supportAmount"))
        current["amount"] += as_number(item.get("payableAmount", item.get("amount")))
        current["tier"] += as_number(item.get("tier2BillableCages"))
        current["hasRecord"] = True
    return {
        "date": str(line.get("date") or ""),
        "totalCount": display_line_count(line, unit, values.values()),
        "totalFree": as_number(line.get("freeCages")),
        "totalTier": as_number(line.get("tier2BillableCages")),
        "totalAmount": as_number(line.get("amount")),
        "values": values,
    }


def summary_for_column(key, rows):
    result = empty_summary()
    for row in rows:
        value = row["values"].get(key, empty_summary())
        for field in ("count", "free", "tier", "support", "amount"):
            result[field] += as_number(value.get(field))
        result["hasRecord"] = result["hasRecord"] or bool(value.get("hasRecord"))
    return result


def empty_summary():
    return {"count": 0, "free": 0, "tier": 0, "support": 0, "amount": 0, "hasRecord": False}


def statement_unit(statement, lines):
    declared = str(statement.get("billingUnit") or "")
    if declared and declared != "mixed":
        return declared
    units = {str(item.get("billingUnit") or "cage_day") for line in lines for item in line.get("iacucBreakdown") or []}
    return "mixed" if len(units) > 1 else (next(iter(units), "cage_day"))


def display_line_count(line, unit, summaries):
    if unit == "animal_day":
        return as_number(line.get("animalCount"))
    if unit == "cage_day":
        return as_number(line.get("cageCount"))
    return sum(as_number(item.get("count")) for item in summaries)


def display_total_count(statement, unit, summaries):
    if unit == "animal_day":
        return as_number(statement.get("totalAnimalDays"))
    if unit == "cage_day":
        return as_number(statement.get("totalCageDays"))
    return sum(as_number(item.get("count")) for item in summaries)


def unit_label(unit, total=False):
    if unit == "animal_day":
        return "总数量" if total else "数量"
    if unit == "mixed":
        return "总量" if total else "数量"
    return "总笼数" if total else "笼数"


def unit_display(unit):
    return {"animal_day": "只/天", "cage_day": "笼/天"}.get(unit, "混合")


def breakdown_key(item):
    return "|".join(
        [
            normalize_iacuc(item.get("iacuc")),
            species_label(item),
            str(item.get("billingItem") or ""),
            str(item.get("billingUnit") or ""),
            f"{as_number(item.get('statementUnitPrice', item.get('unitPrice'))):.2f}",
            f"{as_number(item.get('statementOverageUnitPrice', item.get('overageUnitPrice'))):.2f}",
            "1" if item.get("statementTiered", item.get("tiered")) else "0",
            "1" if item.get("statementFreeAllowance", item.get("freeAllowance")) else "0",
            "1" if item.get("statementFullExemption", item.get("fullExemption")) else "0",
        ]
    )


SPECIES_ORDER = {"小鼠": 0, "大鼠": 1, "豚鼠": 2, "兔": 3, "猴": 4, "猪": 5, "犬": 6, "动物": 7}
