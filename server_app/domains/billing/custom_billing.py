import re

from server_app.shared import as_float, as_int, clean_text, new_id

from .charging import dates_in_month
from .profiles import billing_profile_for_room


def normalize_custom_billing_segments(source, month):
    raw_segments = source.get("customBillingSegments") if isinstance(source, dict) else None
    if isinstance(raw_segments, list):
        return [_normalize_segment(item, month) for item in raw_segments if isinstance(item, dict)]
    legacy_price = as_float((source or {}).get("customUnitPrice"))
    if not (source or {}).get("customBillingEnabled") or legacy_price is None or legacy_price <= 0:
        return []
    return [
        {
            "id": f"legacy-custom-{clean_text((source or {}).get('id', '')) or new_id('custom')}",
            "startDate": f"{month}-01",
            "endDate": dates_in_month(month)[-1],
            "quantity": None,
            "unitPrice": legacy_price,
            "note": "历史整月自定义收费",
        }
    ]


def _normalize_segment(source, month):
    quantity = as_int(source.get("quantity")) if source.get("quantity") not in (None, "") else None
    unit_price = as_float(source.get("unitPrice")) if source.get("unitPrice") not in (None, "") else None
    return {
        "id": clean_text(source.get("id", "")) or new_id("custom"),
        "startDate": clean_text(source.get("startDate", "")) or f"{month}-01",
        "endDate": clean_text(source.get("endDate", "")) or dates_in_month(month)[-1],
        "quantity": max(quantity, 0) if quantity is not None else None,
        "unitPrice": max(unit_price, 0) if unit_price is not None else None,
        "note": clean_text(source.get("note", "")),
    }


def custom_billing_segments_for_day(sheet, line_date, available_count):
    available_count = max(as_int(available_count) or 0, 0)
    result = []
    segments = sheet.get("customBillingSegments")
    if not isinstance(segments, list):
        segments = normalize_custom_billing_segments(sheet, clean_text(sheet.get("month", "")))
    for segment in segments:
        if not _segment_covers_date(segment, line_date):
            continue
        quantity = available_count if segment.get("quantity") is None else max(as_int(segment.get("quantity")) or 0, 0)
        if quantity <= 0:
            continue
        result.append({**segment, "quantity": quantity})
    return result


def custom_billing_quantity_for_day(sheet, line_date, available_count):
    return sum(item["quantity"] for item in custom_billing_segments_for_day(sheet, line_date, available_count))


def validate_custom_billing_segments(sheets, rooms):
    room_by_id = {room.get("id"): room for room in rooms or []}
    balances = resolve_quantity_sheet_daily_counts(sheets, room_by_id)
    for sheet in sheets or []:
        month = clean_text(sheet.get("month", ""))
        segments = sheet.get("customBillingSegments")
        if not isinstance(segments, list):
            segments = normalize_custom_billing_segments(sheet, month)
        for segment in segments:
            _validate_segment_shape(segment, month)
        for line_date, balance in balances.get(sheet.get("id"), {}).items():
            unit = billing_profile_for_room(room_by_id.get(sheet.get("roomId"), {}), sheet.get("billingUnit")).get(
                "unit"
            )
            available = balance["animalCount"] if unit == "animal_day" else balance["cageCount"]
            configured = custom_billing_quantity_for_day(sheet, line_date, available)
            if configured > available:
                unit_label = "只" if unit == "animal_day" else "笼"
                raise ValueError(
                    f"{sheet.get('iacuc', '')} {line_date} 自定义收费数量 {configured} {unit_label}，超过当天结余 {available} {unit_label}"
                )


def _validate_segment_shape(segment, month):
    start_date = clean_text(segment.get("startDate", ""))
    end_date = clean_text(segment.get("endDate", ""))
    if not (_date_in_month(start_date, month) and _date_in_month(end_date, month)):
        raise ValueError("自定义收费区间必须位于统计表月份内")
    if start_date > end_date:
        raise ValueError("自定义收费区间的结束日期应晚于开始日期")
    if segment.get("quantity") is not None and (as_int(segment.get("quantity")) or 0) <= 0:
        raise ValueError("请填写大于 0 的自定义收费区间每日适用数量")
    if (as_float(segment.get("unitPrice")) or 0) <= 0:
        raise ValueError("请填写大于 0 的自定义收费单价")


def resolve_quantity_sheet_daily_counts(sheets, room_by_id):
    if not sheets:
        return {}
    month = clean_text(sheets[0].get("month", ""))
    states = []
    state_by_iacuc = {}
    for sheet in sheets:
        rows_by_date = {}
        for row in sheet.get("rows", []):
            rows_by_date.setdefault(row.get("date", ""), []).append(row)
        state = {
            "sheet": sheet,
            "rowsByDate": rows_by_date,
            "unit": billing_profile_for_room(room_by_id.get(sheet.get("roomId"), {}), sheet.get("billingUnit")).get(
                "unit"
            ),
            "animalCount": max(as_int(sheet.get("initialAnimalCount")) or 0, 0),
            "cageCount": max(as_int(sheet.get("initialCageCount")) or 0, 0),
        }
        states.append(state)
        iacuc = clean_text(sheet.get("iacuc", "")).upper()
        if iacuc and iacuc not in state_by_iacuc:
            state_by_iacuc[iacuc] = state

    balances = {sheet.get("id"): {} for sheet in sheets}
    for line_date in dates_in_month(month):
        transfer_deltas = {}
        for state in states:
            for row in state["rowsByDate"].get(line_date, []):
                added = max(as_int(row.get("addedCount")) or 0, 0)
                removed = max(as_int(row.get("removedCount")) or 0, 0)
                if state["unit"] == "animal_day":
                    state["animalCount"] = (
                        max(as_int(row.get("animalCount")) or 0, 0)
                        if row.get("animalCount") is not None
                        else max(state["animalCount"] + added - removed, 0)
                    )
                    if row.get("cageCount") is not None:
                        state["cageCount"] = max(as_int(row.get("cageCount")) or 0, 0)
                else:
                    state["cageCount"] = (
                        max(as_int(row.get("cageCount")) or 0, 0)
                        if row.get("cageCount") is not None
                        else max(state["cageCount"] + added - removed, 0)
                    )
                    if row.get("animalCount") is not None:
                        state["animalCount"] = max(as_int(row.get("animalCount")) or 0, 0)
                target = clean_text(row.get("transferOutToIacuc", "")).upper()
                if target and removed:
                    transfer_deltas[target] = transfer_deltas.get(target, 0) + removed
                source = clean_text(row.get("transferInFromIacuc", "")).upper()
                if source and added:
                    transfer_deltas[source] = transfer_deltas.get(source, 0) - added
        for iacuc, delta in transfer_deltas.items():
            target = state_by_iacuc.get(iacuc)
            if not target:
                continue
            key = "animalCount" if target["unit"] == "animal_day" else "cageCount"
            target[key] = max(target[key] + delta, 0)
        for state in states:
            balances[state["sheet"].get("id")][line_date] = {
                "animalCount": state["animalCount"],
                "cageCount": state["cageCount"],
            }
    return balances


def _segment_covers_date(segment, line_date):
    return clean_text(segment.get("startDate", "")) <= line_date <= clean_text(segment.get("endDate", ""))


def _date_in_month(value, month):
    return bool(re.fullmatch(r"\d{4}-\d{2}-\d{2}", value or "")) and value[:7] == month
