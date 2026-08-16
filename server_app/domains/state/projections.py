"""State projections for cage cards and infrastructure summaries."""

import calendar
import re
from datetime import date

from server_app.domains.billing import billing_profile_for_room, occupancy_animal_count
from server_app.domains.iacuc import normalize_iacuc_number
from server_app.domains.intake import (
    animal_age_text,
    cage_card_qr_id_from_batch_card,
    cage_card_status_label,
    legacy_cage_card_qr_id,
    species_label,
)
from server_app.domains.state.entity_rules import empty_state
from server_app.domains.workflow.constants import (
    WORKFLOW_STATUS_FINANCE,
    WORKFLOW_STATUS_GENERATED,
    WORKFLOW_STATUS_SENT,
    WORKFLOW_STATUS_SIGNED,
)
from server_app.repositories.state import assemble_state as assemble_state_repository
from server_app.repositories.state import read_applications_by_iacuc as read_applications_repository
from server_app.shared import as_int, clean_text, today_iso


def assemble_state(conn):
    return assemble_state_repository(conn)


def read_applications_by_iacuc(conn):
    return read_applications_repository(conn, normalize_iacuc_number)


def month_range(month):
    normalized = clean_text(month)
    if not re.fullmatch(r"\d{4}-\d{2}", normalized):
        raise ValueError("结算月份格式应为 YYYY-MM")
    year, month_no = normalized.split("-")
    start = f"{year}-{month_no}-01"
    last_day = calendar.monthrange(int(year), int(month_no))[1]
    return start, f"{year}-{month_no}-{last_day:02d}"


def occupancy_overlaps_month(item, month):
    start, end = month_range(month)
    start_date = clean_text(item.get("startDate") or item.get("start_date"))
    end_date = clean_text(item.get("endDate") or item.get("end_date"))
    return bool(start_date and start_date <= end and (not end_date or end_date >= start))


def current_occupancy_by_slot(state):
    current = {}
    for item in state.get("occupancies", []):
        if item.get("slotId") and item.get("status") in ("active", "reserved"):
            current[item.get("slotId")] = item
    return current


def public_cage_card_payload(conn, qr_id):
    target = clean_text(qr_id).upper()
    if not target:
        raise LookupError("二维码地址无效")
    state = assemble_state(conn) or empty_state()
    applications_by_iacuc = read_applications_by_iacuc(conn)
    rooms_by_id = {item.get("id"): item for item in state.get("rooms", [])}
    racks_by_id = {item.get("id"): item for item in state.get("racks", [])}
    slots_by_id = {item.get("id"): item for item in state.get("slots", [])}
    tasks_by_batch_and_sequence = {
        (task.get("sourceBatchId"), as_int(task.get("cardSequence")) or 0): task
        for task in state.get("placementTasks", [])
    }
    occupancies_by_id = {item.get("id"): item for item in state.get("occupancies", [])}
    occupancies_by_qr = {
        clean_text(item.get("qrId")).upper(): item
        for item in state.get("occupancies", [])
        if clean_text(item.get("qrId"))
    }

    for batch in state.get("intakeBatches", []):
        card_count = max(
            as_int(batch.get("finalCardCount")) or 0,
            as_int(batch.get("suggestedCardCount")) or 0,
            len(batch.get("cards") or []) if isinstance(batch.get("cards"), list) else 0,
        )
        for sequence in range(1, card_count + 1):
            task = tasks_by_batch_and_sequence.get((batch.get("id"), sequence))
            candidate_ids = {
                cage_card_qr_id_from_batch_card(batch, sequence).upper(),
                legacy_cage_card_qr_id(batch, sequence).upper(),
            }
            cards = batch.get("cards") if isinstance(batch.get("cards"), list) else []
            card_index = sequence - 1
            if 0 <= card_index < len(cards) and isinstance(cards[card_index], dict):
                stored_qr_id = clean_text(cards[card_index].get("qrId")).upper()
                if stored_qr_id:
                    candidate_ids.add(stored_qr_id)
            if task and clean_text(task.get("qrId")):
                candidate_ids.add(clean_text(task.get("qrId")).upper())
            if target not in candidate_ids:
                continue
            occupancy = occupancies_by_qr.get(target)
            if not occupancy and task and task.get("reservedOccupancyId"):
                occupancy = occupancies_by_id.get(task.get("reservedOccupancyId"))
            slot = slots_by_id.get((occupancy or {}).get("slotId"))
            rack = racks_by_id.get((slot or {}).get("rackId") or (occupancy or {}).get("rackId"))
            room = rooms_by_id.get(
                (rack or {}).get("roomId") or (task or {}).get("targetRoomId") or (occupancy or {}).get("roomId")
            )
            iacuc = normalize_iacuc_number(
                batch.get("iacuc") or (task or {}).get("iacuc") or (occupancy or {}).get("iacuc")
            )
            application = applications_by_iacuc.get(iacuc, {})
            animal_count = (task or {}).get("animalCount")
            if animal_count in (None, ""):
                animal_count = (occupancy or {}).get("animalCount")
            if animal_count in (None, ""):
                per_cage = max(as_int(batch.get("suggestedAnimalsPerCage")) or 1, 1)
                quantity = max(as_int(batch.get("quantity")) or 0, 0)
                remainder = quantity % per_cage if quantity and per_cage else 0
                animal_count = "" if remainder and sequence == card_count else per_cage
            birth_date = (occupancy or {}).get("birthDate", "")
            item = {
                "qrId": target,
                "batchNo": batch.get("batchNo", ""),
                "cageCode": (occupancy or {}).get("cageCode", ""),
                "roomName": (room or {}).get("name")
                or (task or {}).get("targetRoomName")
                or batch.get("roomName", "")
                or (occupancy or {}).get("roomName", ""),
                "rackName": (rack or {}).get("name") or (occupancy or {}).get("rackName", ""),
                "slotCode": (slot or {}).get("code") or (occupancy or {}).get("slotCode", ""),
                "iacuc": iacuc,
                "project": batch.get("project")
                or (task or {}).get("project")
                or (occupancy or {}).get("project")
                or application.get("project", ""),
                "pi": batch.get("pi")
                or (task or {}).get("pi")
                or (occupancy or {}).get("pi")
                or application.get("pi", ""),
                "owner": batch.get("owner")
                or (task or {}).get("owner")
                or (occupancy or {}).get("owner")
                or application.get("owner", ""),
                "species": batch.get("species") or (task or {}).get("species") or (occupancy or {}).get("species", ""),
                "speciesLabel": species_label(
                    batch.get("species") or (task or {}).get("species") or (occupancy or {}).get("species", "")
                ),
                "strainStandard": batch.get("strainStandard")
                or (task or {}).get("strainStandard")
                or (occupancy or {}).get("strainStandard", ""),
                "animalCount": animal_count,
                "sex": batch.get("sex") or (occupancy or {}).get("sex", ""),
                "birthDate": birth_date,
                "age": animal_age_text(birth_date),
                "startDate": (occupancy or {}).get("startDate") or (task or {}).get("actualMoveInDate", ""),
                "actualMoveInDate": (task or {}).get("actualMoveInDate", ""),
                "endDate": (occupancy or {}).get("endDate") or batch.get("endDate", ""),
                "statusLabel": cage_card_status_label(batch, task, occupancy),
            }
            return {"item": item}
    raise LookupError("该二维码没有匹配到笼卡记录")


def occupancy_period_tone(occupancy):
    if not occupancy or occupancy.get("status") != "active":
        return ""
    end_date = clean_text(occupancy.get("endDate", ""))
    if not end_date:
        return "open"
    return "overdue" if today_iso() > end_date else "normal"


def summarize_infrastructure(state):
    current_by_slot = current_occupancy_by_slot(state)
    rack_by_id = {rack.get("id"): rack for rack in state.get("racks", [])}
    room_by_id = {room.get("id"): room for room in state.get("rooms", [])}
    slot_to_rack_id = {slot.get("id"): slot.get("rackId") for slot in state.get("slots", [])}
    facility_summaries = {}
    current_month = date.today().strftime("%Y-%m")
    room_summaries = {
        room.get("id"): {
            "roomId": room.get("id"),
            "rackCount": 0,
            "slotCount": 0,
            "activeCount": 0,
            "reservedCount": 0,
            "emptyCount": 0,
            "periodOpenCount": 0,
            "periodNormalCount": 0,
            "periodOverdueCount": 0,
            "occupancyRecordCount": 0,
        }
        for room in state.get("rooms", [])
    }
    rack_summaries = {
        rack.get("id"): {
            "rackId": rack.get("id"),
            "roomId": rack.get("roomId"),
            "slotCount": 0,
            "activeCount": 0,
            "reservedCount": 0,
            "emptyCount": 0,
            "periodOpenCount": 0,
            "periodNormalCount": 0,
            "periodOverdueCount": 0,
            "occupancyRecordCount": 0,
        }
        for rack in state.get("racks", [])
    }
    dashboard = {
        "total": 0,
        "active": 0,
        "reserved": 0,
        "empty": 0,
        "periodOpen": 0,
        "periodNormal": 0,
        "periodOverdue": 0,
        "intakePendingCount": 0,
        "openPlacementTaskCount": 0,
        "currentMonthWorkflowTodoCount": 0,
        "currentMonthWorkflowDoneCount": 0,
        "unmatchedIntakeCount": 0,
        "overduePlacementCount": 0,
        "stalledWorkflowCount": 0,
        "exceptionCount": 0,
    }

    def ensure_facility_summary(facility):
        key = clean_text(facility or "zhujiang") or "zhujiang"
        if key not in facility_summaries:
            facility_summaries[key] = {
                "facility": key,
                "roomCount": 0,
                "activeCageCount": 0,
                "activeAnimalCount": 0,
                "openPlacementTaskCount": 0,
                "currentMonthWorkflowTodoCount": 0,
                "currentMonthWorkflowDoneCount": 0,
            }
        return facility_summaries[key]

    for room in state.get("rooms", []):
        ensure_facility_summary(room.get("facility"))["roomCount"] += 1

    for rack in state.get("racks", []):
        room_summary = room_summaries.get(rack.get("roomId"))
        if room_summary:
            room_summary["rackCount"] += 1

    for slot in state.get("slots", []):
        rack_summary = rack_summaries.get(slot.get("rackId"))
        rack = rack_by_id.get(slot.get("rackId"), {})
        room_summary = room_summaries.get(rack.get("roomId"))
        occupancy = current_by_slot.get(slot.get("id"))
        tone = occupancy_period_tone(occupancy)
        status = clean_text(slot.get("status", ""))
        dashboard["total"] += 1
        if rack_summary:
            rack_summary["slotCount"] += 1
        if room_summary:
            room_summary["slotCount"] += 1
        if status == "active":
            dashboard["active"] += 1
            ensure_facility_summary(
                (room_summary and room_by_id.get(room_summary["roomId"], {}).get("facility")) or rack.get("facility")
            )["activeCageCount"] += 1
            if rack_summary:
                rack_summary["activeCount"] += 1
            if room_summary:
                room_summary["activeCount"] += 1
        elif status == "reserved":
            dashboard["reserved"] += 1
            if rack_summary:
                rack_summary["reservedCount"] += 1
            if room_summary:
                room_summary["reservedCount"] += 1
        else:
            dashboard["empty"] += 1
            if rack_summary:
                rack_summary["emptyCount"] += 1
            if room_summary:
                room_summary["emptyCount"] += 1
        if tone == "open":
            dashboard["periodOpen"] += 1
            if rack_summary:
                rack_summary["periodOpenCount"] += 1
            if room_summary:
                room_summary["periodOpenCount"] += 1
        elif tone == "normal":
            dashboard["periodNormal"] += 1
            if rack_summary:
                rack_summary["periodNormalCount"] += 1
            if room_summary:
                room_summary["periodNormalCount"] += 1
        elif tone == "overdue":
            dashboard["periodOverdue"] += 1
            if rack_summary:
                rack_summary["periodOverdueCount"] += 1
            if room_summary:
                room_summary["periodOverdueCount"] += 1

    for item in state.get("occupancies", []):
        slot_id = item.get("slotId")
        rack_id = item.get("rackId") or slot_to_rack_id.get(slot_id)
        room_id = item.get("roomId") or rack_by_id.get(rack_id, {}).get("roomId")
        room = room_by_id.get(room_id, {})
        if item.get("status") == "active":
            facility_profile = billing_profile_for_room(room)
            ensure_facility_summary(facility_profile.get("facility"))["activeAnimalCount"] += occupancy_animal_count(
                item, facility_profile
            )
        if rack_id and rack_id in rack_summaries:
            rack_summaries[rack_id]["occupancyRecordCount"] += 1
        if room_id and room_id in room_summaries:
            room_summaries[room_id]["occupancyRecordCount"] += 1

    for batch in state.get("intakeBatches", []):
        if clean_text(batch.get("status")) != "received":
            dashboard["intakePendingCount"] += 1
        if clean_text(batch.get("roomName")) and not batch.get("roomMatched"):
            dashboard["unmatchedIntakeCount"] += 1

    for task in state.get("placementTasks", []):
        status = clean_text(task.get("status"))
        if status in ("active", "cancelled"):
            continue
        room = room_by_id.get(task.get("targetRoomId"), {})
        ensure_facility_summary(billing_profile_for_room(room).get("facility"))["openPlacementTaskCount"] += 1
        dashboard["openPlacementTaskCount"] += 1
        planned_move_in = clean_text(task.get("plannedMoveInDate"))
        if planned_move_in and planned_move_in < today_iso():
            dashboard["overduePlacementCount"] += 1

    for workflow in state.get("billingWorkflows", []):
        if clean_text(workflow.get("month")) != current_month:
            continue
        workflow_status = clean_text(workflow.get("workflowStatus"))
        facility_keys = set()
        statement = (workflow.get("currentVersion") or {}).get("statement") or {}
        room_name = clean_text(statement.get("roomName"))
        if room_name:
            room = next((item for item in state.get("rooms", []) if clean_text(item.get("name")) == room_name), None)
            if room:
                facility_keys.add(billing_profile_for_room(room).get("facility"))
        if not facility_keys and clean_text(workflow.get("sourceType")) == "cage_map":
            pi = clean_text(workflow.get("pi"))
            if pi:
                for item in state.get("occupancies", []):
                    if clean_text(item.get("pi")) != pi or not occupancy_overlaps_month(item, current_month):
                        continue
                    rack_id = item.get("rackId") or slot_to_rack_id.get(item.get("slotId"))
                    room_id = item.get("roomId") or rack_by_id.get(rack_id, {}).get("roomId")
                    facility_keys.add(billing_profile_for_room(room_by_id.get(room_id, {})).get("facility"))
        if not facility_keys:
            facility_keys.add("zhujiang")
        if workflow_status == WORKFLOW_STATUS_FINANCE:
            dashboard["currentMonthWorkflowDoneCount"] += 1
            for key in facility_keys:
                ensure_facility_summary(key)["currentMonthWorkflowDoneCount"] += 1
            continue
        dashboard["currentMonthWorkflowTodoCount"] += 1
        if workflow_status in (WORKFLOW_STATUS_GENERATED, WORKFLOW_STATUS_SENT, WORKFLOW_STATUS_SIGNED):
            dashboard["stalledWorkflowCount"] += 1
        for key in facility_keys:
            ensure_facility_summary(key)["currentMonthWorkflowTodoCount"] += 1

    dashboard["exceptionCount"] = (
        dashboard["unmatchedIntakeCount"] + dashboard["overduePlacementCount"] + dashboard["stalledWorkflowCount"]
    )

    return {
        "dashboardSummary": dashboard,
        "roomSummaries": list(room_summaries.values()),
        "rackSummaries": list(rack_summaries.values()),
        "facilitySummaries": list(facility_summaries.values()),
    }
