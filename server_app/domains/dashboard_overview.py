"""Overview dashboard aggregates built from real business data.

The cage-map based dashboard cards were removed because the cage map is not
fully used in production. This module aggregates intake batches, quantity
sheets and settlement candidate snapshots instead.
"""

from __future__ import annotations

import calendar
import json
from collections import Counter, defaultdict
from datetime import date

from server_app.cache import (
    cache_get,
    cache_key,
    cache_set,
    invalidate_data_cache_prefixes,
)
from server_app.domains.billing.profiles import billing_profile_for_room
from server_app.domains.intake.strain_standard import standardize_strain
from server_app.shared import as_int, clean_text


def default_overview_month():
    today = date.today()
    year = today.year
    month = today.month - 1
    if month <= 0:
        month += 12
        year -= 1
    return f"{year:04d}-{month:02d}"


def invalidate_dashboard_overview_cache():
    invalidate_data_cache_prefixes("dashboard_overview::")


def dashboard_overview_payload(conn, month: str, rooms=None):
    month = clean_text(month)
    rooms = rooms if rooms is not None else _read_rooms(conn)
    room_ids = ",".join(sorted(clean_text(room.get("id", "")) for room in rooms))
    cache_key_value = cache_key("dashboard_overview", month=month, rooms=room_ids)
    cached = cache_get(cache_key_value)
    if cached is not None:
        return cached

    room_by_id = {clean_text(room.get("id", "")): room for room in rooms}
    room_by_name = {clean_text(room.get("name", "")): room for room in rooms}

    intake = _intake_overview(conn, month)
    rooms_overview = _rooms_overview(conn, month, room_by_id, room_by_name)
    pi_overview = _pi_overview(conn, month)

    payload = {
        "month": month,
        "availableMonths": _available_months(conn),
        "intake": intake,
        "rooms": rooms_overview,
        "pi": pi_overview,
    }
    return cache_set(cache_key_value, payload)


def _available_months(conn):
    months = set()
    for row in conn.execute("SELECT DISTINCT month FROM quantity_sheets WHERE TRIM(COALESCE(month, '')) != ''"):
        if row["month"]:
            months.add(row["month"])
    for row in conn.execute(
        "SELECT DISTINCT intake_date FROM intake_batches WHERE TRIM(COALESCE(intake_date, '')) != ''"
    ):
        month = clean_text(row["intake_date"] or "")[:7]
        if month:
            months.add(month)
    return sorted(months, reverse=True)


def _read_rooms(conn):
    rows = conn.execute("SELECT payload FROM rooms ORDER BY rowid").fetchall()
    return [json.loads(row["payload"]) for row in rows]


def _intake_overview(conn, month):
    if month == "all":
        rows = conn.execute("SELECT payload FROM intake_batches ORDER BY COALESCE(intake_date, '')").fetchall()
    else:
        year, month_number = _split_month(month)
        next_year = year + 1 if month_number == 12 else year
        next_month = 1 if month_number == 12 else month_number + 1
        rows = conn.execute(
            """
            SELECT payload
            FROM intake_batches
            WHERE intake_date >= ? AND intake_date < ?
            ORDER BY intake_date
            """,
            (f"{year:04d}-{month_number:02d}-01", f"{next_year:04d}-{next_month:02d}-01"),
        ).fetchall()
    batches = [json.loads(row["payload"]) for row in rows]

    by_month = defaultdict(lambda: {"batches": 0, "animals": 0})
    by_day = defaultdict(lambda: {"batches": 0, "animals": 0})
    by_strain = Counter()
    by_species = Counter()

    for batch in batches:
        intake_date = clean_text(batch.get("intakeDate", ""))[:10]
        batch_month = intake_date[:7]
        quantity = max(as_int(batch.get("quantity")) or 0, 0)
        by_month[batch_month]["batches"] += 1
        by_month[batch_month]["animals"] += quantity

        if month != "all" and batch_month == month:
            day = 0
            if len(intake_date) == 10 and intake_date[8:10].isdigit():
                day = int(intake_date[8:10])
            if day:
                by_day[day]["batches"] += 1
                by_day[day]["animals"] += quantity

        if month == "all" or batch_month == month:
            strain_label = clean_text(batch.get("strainStandard") or batch.get("strainRaw") or "未识别")
            strain = standardize_strain(strain_label) or strain_label
            by_strain[strain] += quantity
            species = clean_text(batch.get("species", "") or "未识别")
            by_species[species] += quantity

    if month == "all":
        latest_month = max(by_month) if by_month else default_overview_month()
        year, month_number = _split_month(latest_month)
    else:
        year, month_number = _split_month(month)

    if month == "all":
        current_batches = sum(item["batches"] for item in by_month.values())
        current_animals = sum(item["animals"] for item in by_month.values())
    else:
        current_batches = by_month.get(month, {}).get("batches", 0)
        current_animals = by_month.get(month, {}).get("animals", 0)

    if month == "all":
        trend_unit = "month"
        trend = []
        for offset in range(5, -1, -1):
            year_value = year
            month_value = month_number - offset
            while month_value <= 0:
                month_value += 12
                year_value -= 1
            key = f"{year_value:04d}-{month_value:02d}"
            trend.append(
                {
                    "month": key,
                    "batches": by_month.get(key, {}).get("batches", 0),
                    "animals": by_month.get(key, {}).get("animals", 0),
                }
            )
    else:
        trend_unit = "day"
        total_days = calendar.monthrange(year, month_number)[1]
        trend = [
            {"day": day, "batches": by_day[day]["batches"], "animals": by_day[day]["animals"]}
            for day in range(1, total_days + 1)
        ]

    return {
        "month": month,
        "batches": current_batches,
        "animals": current_animals,
        "trendUnit": trend_unit,
        "trend": trend,
        "strains": [{"strain": strain, "animals": count} for strain, count in by_strain.most_common(10)],
        "species": [{"species": species, "animals": count} for species, count in by_species.most_common(10)],
    }


def _rooms_overview(conn, month, room_by_id, room_by_name):
    if month == "all":
        rows = conn.execute(
            "SELECT month, room_name, payload FROM quantity_sheets "
            "WHERE TRIM(COALESCE(month, '')) != '' ORDER BY month, room_name"
        ).fetchall()
    else:
        rows = conn.execute(
            "SELECT month, room_name, payload FROM quantity_sheets WHERE month = ? ORDER BY room_name",
            (month,),
        ).fetchall()
    if not rows:
        return []

    # Quantity-sheet rows only record change points. Expand each sheet to every
    # calendar day: the cage count starts from the initial balance and rows
    # update it on their date, keeping the last known value in between. This
    # matches the billing statement calculation so room totals cover the whole
    # month instead of only the recorded dates.
    daily_by_room_month: dict[str, dict[str, list[int]]] = defaultdict(lambda: defaultdict(list))
    for row in rows:
        sheet_month = clean_text(row["month"] or "")
        if not sheet_month:
            continue
        room_name = clean_text(row["room_name"] or "")
        if not room_name:
            continue
        sheet = json.loads(row["payload"])
        total_days = calendar.monthrange(*_split_month(sheet_month))[1]
        by_day = {}
        for detail in sheet.get("rows", []):
            day = clean_text(detail.get("date", ""))[:10]
            if not day.startswith(sheet_month):
                continue
            by_day[day] = detail
        daily = daily_by_room_month[room_name].setdefault(sheet_month, [0] * (total_days + 1))
        current = max(as_int(sheet.get("initialCageCount")) or 0, 0)
        for day_number in range(1, total_days + 1):
            detail = by_day.get(f"{sheet_month}-{day_number:02d}")
            if detail is not None:
                detail_count = detail.get("cageCount")
                if detail_count is not None:
                    current = max(as_int(detail_count) or 0, 0)
                else:
                    current = max(
                        current
                        + max(as_int(detail.get("addedCount")) or 0, 0)
                        - max(as_int(detail.get("removedCount")) or 0, 0),
                        0,
                    )
            if current:
                daily[day_number] += current

    result = []
    for room_name, monthly in sorted(daily_by_room_month.items()):
        room = room_by_name.get(room_name) or {}
        profile = billing_profile_for_room(room)
        unit_price = profile.get("unitPrice") or 0
        if month == "all":
            cage_days = sum(sum(daily) for daily in monthly.values())
            result.append(
                {
                    "roomName": room_name,
                    "species": profile.get("species", ""),
                    "cageDays": cage_days,
                    "amount": round(cage_days * unit_price, 2),
                    "unitPrice": unit_price,
                    "firstDay": 0,
                    "lastDay": 0,
                    "days": len(monthly),
                    "trendUnit": "month",
                    "trend": [
                        {"day": int(sheet_month[5:]), "cages": sum(daily), "label": sheet_month}
                        for sheet_month, daily in sorted(monthly.items())
                    ],
                }
            )
        else:
            daily_list = monthly.get(month, [])
            total_days = calendar.monthrange(*_split_month(month))[1]
            daily_list = (daily_list + [0] * (total_days + 1))[: total_days + 1]
            cage_days = sum(daily_list)
            occupied_days = [day for day, cages in enumerate(daily_list) if cages > 0]
            result.append(
                {
                    "roomName": room_name,
                    "species": profile.get("species", ""),
                    "cageDays": cage_days,
                    "amount": round(cage_days * unit_price, 2),
                    "unitPrice": unit_price,
                    "firstDay": occupied_days[0] if occupied_days else 0,
                    "lastDay": occupied_days[-1] if occupied_days else 0,
                    "days": total_days,
                    "trendUnit": "day",
                    "trend": [
                        {"day": day_number, "cages": daily_list[day_number]} for day_number in range(1, total_days + 1)
                    ],
                }
            )
    return result


def _pi_overview(conn, month):
    if month == "all":
        rows = conn.execute(
            """
            SELECT pi, total_amount, iacucs_json
            FROM billing_candidate_snapshots
            WHERE source_type = 'quantity_sheet'
            """
        ).fetchall()
    else:
        rows = conn.execute(
            """
            SELECT pi, total_amount, iacucs_json
            FROM billing_candidate_snapshots
            WHERE source_type = 'quantity_sheet' AND month = ?
            """,
            (month,),
        ).fetchall()
    if not rows:
        return []

    aggregated: dict[str, dict[str, object]] = {}
    for row in rows:
        pi = clean_text(row["pi"] or "")
        if not pi:
            continue
        item = aggregated.setdefault(pi, {"amount": 0.0, "iacucs": set()})
        item["amount"] = float(item["amount"]) + (as_int(row["total_amount"]) or 0)
        try:
            item["iacucs"].update(json.loads(row["iacucs_json"] or "[]"))
        except (TypeError, ValueError):
            pass
    return [
        {"pi": pi, "amount": round(float(item["amount"]), 2), "iacucCount": len(item["iacucs"])}
        for pi, item in sorted(aggregated.items(), key=lambda pair: pair[1]["amount"], reverse=True)
    ]


def _split_month(month):
    try:
        year, month_number = [int(part) for part in str(month).split("-", 1)]
        return year, month_number
    except (TypeError, ValueError):
        return 0, 1
