from collections import Counter

SETTLEMENT_CANDIDATE_COLUMNS = {"month", "pi", "iacuc", "amount"}


def list_settlement_candidates(groups, filters, calculate):
    candidates = []
    for group in groups:
        try:
            statement = calculate(group["month"], group["pi"])
            candidates.append(
                {
                    "id": f"{group['month']}::{group['pi']}",
                    "month": group["month"],
                    "pi": group["pi"],
                    "iacucs": statement.get("iacucs", []),
                    "totalAmount": float(statement.get("totalAmount", 0) or 0),
                    "error": "",
                }
            )
        except ValueError as exc:
            candidates.append(
                {
                    "id": f"{group['month']}::{group['pi']}",
                    "month": group["month"],
                    "pi": group["pi"],
                    "iacucs": [],
                    "totalAmount": None,
                    "error": str(exc),
                }
            )

    column_filters = filters.get("columnFilters") or {}
    filtered = _apply_filters(candidates, column_filters)
    filtered.sort(key=lambda item: _sort_value(item, filters.get("sortKey")), reverse=filters.get("sortDir") != "asc")
    filtered.sort(key=lambda item: item["totalAmount"] is None)
    offset = filters["offset"]
    limit = filters["limit"]
    return {
        "items": filtered[offset : offset + limit],
        "page": {
            "limit": limit,
            "offset": offset,
            "total": len(filtered),
            "hasMore": offset + limit < len(filtered),
        },
        "filterOptions": {
            column: _filter_options(_apply_filters(candidates, column_filters, exclude=column), column)
            for column in SETTLEMENT_CANDIDATE_COLUMNS
        },
    }


def _apply_filters(candidates, column_filters, exclude=""):
    output = candidates
    for column, values in column_filters.items():
        selected = {str(value).strip() for value in values if str(value).strip()}
        if column == exclude or column not in SETTLEMENT_CANDIDATE_COLUMNS or not selected:
            continue
        if column == "iacuc":
            output = [item for item in output if selected.intersection(item["iacucs"])]
        else:
            output = [item for item in output if _column_value(item, column) in selected]
    return output


def _filter_options(candidates, column):
    counts = Counter()
    for item in candidates:
        values = item["iacucs"] if column == "iacuc" else [_column_value(item, column)]
        counts.update(value for value in values if value != "")
    return [
        {
            "value": value,
            "label": f"¥{value}" if column == "amount" else value or "空白",
            "count": count,
        }
        for value, count in sorted(counts.items(), key=lambda entry: entry[0].lower())
    ]


def _column_value(item, column):
    if column == "amount":
        return "" if item["totalAmount"] is None else f"{item['totalAmount']:.2f}"
    return str(item.get(column, "") or "")


def _sort_value(item, column):
    if column == "amount":
        return (item["totalAmount"] is not None, item["totalAmount"] or 0, item["month"], item["pi"].lower())
    if column == "pi":
        return (item["pi"].lower(), item["month"])
    if column == "iacuc":
        return ("、".join(item["iacucs"]).lower(), item["month"], item["pi"].lower())
    return (item["month"], item["pi"].lower())
