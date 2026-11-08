"""Resolve one public card without assembling private state or audit history."""

from server_app.domains.intake.rules import cage_card_qr_id_from_batch_card, legacy_cage_card_qr_id
from server_app.repositories.application_context import applications_for_iacucs
from server_app.repositories.payload_projection import payloads_by_rowids, projected_rows
from server_app.shared import as_int, clean_text


def _last_link(conn, table, identity, order):
    selected = None
    for rowid, item in projected_rows(conn, table, ("id",), order=order):
        if item.get("id") == identity:
            selected = rowid
    return payloads_by_rowids(conn, table, [selected] if selected is not None else [], order=order)


def read_card_context(conn, target):
    task_order = "planned_move_in_date,rowid"
    tasks = {}
    for rowid, item in projected_rows(
        conn, "placement_tasks", ("sourceBatchId", "cardSequence", "qrId"), order=task_order
    ):
        tasks[(item.get("sourceBatchId"), as_int(item.get("cardSequence")) or 0)] = (rowid, item)
    batch_rowid = task_rowid = None
    for rowid, batch in projected_rows(
        conn,
        "intake_batches",
        ("id", "sourceBatchId", "iacuc", "intakeDate", "finalCardCount", "suggestedCardCount", "cards"),
        order="updated_at DESC,rowid DESC",
    ):
        cards = batch.get("cards") if isinstance(batch.get("cards"), list) else []
        count = max(as_int(batch.get("finalCardCount")) or 0, as_int(batch.get("suggestedCardCount")) or 0, len(cards))
        for sequence in range(1, count + 1):
            current_rowid, task = tasks.get((batch.get("id"), sequence), (None, {}))
            candidates = {
                cage_card_qr_id_from_batch_card(batch, sequence).upper(),
                legacy_cage_card_qr_id(batch, sequence).upper(),
            }
            if sequence <= len(cards) and isinstance(cards[sequence - 1], dict):
                candidates.add(clean_text(cards[sequence - 1].get("qrId")).upper())
            candidates.add(clean_text(task.get("qrId")).upper())
            if target in candidates:
                batch_rowid, task_rowid = rowid, current_rowid
                break
        if batch_rowid is not None:
            break
    if batch_rowid is None:
        raise LookupError("该二维码没有匹配到笼卡记录")
    batches = payloads_by_rowids(conn, "intake_batches", [batch_rowid])
    selected_tasks = payloads_by_rowids(conn, "placement_tasks", [task_rowid] if task_rowid is not None else [])
    task = selected_tasks[0] if selected_tasks else {}
    occupancy_by_qr = occupancy_by_id = None
    for rowid, item in projected_rows(conn, "occupancies", ("id", "qrId"), order="start_date,rowid"):
        if clean_text(item.get("qrId")).upper() == target:
            occupancy_by_qr = rowid
        if task.get("reservedOccupancyId") and item.get("id") == task["reservedOccupancyId"]:
            occupancy_by_id = rowid
    occupancy_rowid = occupancy_by_qr if occupancy_by_qr is not None else occupancy_by_id
    occupancies = payloads_by_rowids(conn, "occupancies", [occupancy_rowid] if occupancy_rowid is not None else [])
    occupancy = occupancies[0] if occupancies else {}
    slots = _last_link(conn, "cage_slots", occupancy.get("slotId"), "rack_id,row_no,col_no,rowid")
    racks = _last_link(
        conn, "racks", (slots[0] if slots else {}).get("rackId") or occupancy.get("rackId"), "room_id,index_no,rowid"
    )
    rooms = _last_link(
        conn,
        "rooms",
        (racks[0] if racks else {}).get("roomId") or task.get("targetRoomId") or occupancy.get("roomId"),
        "rowid",
    )
    iacuc = batches[0].get("iacuc") or task.get("iacuc") or occupancy.get("iacuc") or ""
    return {
        "intakeBatches": batches,
        "placementTasks": selected_tasks,
        "occupancies": occupancies,
        "slots": slots,
        "racks": racks,
        "rooms": rooms,
    }, applications_for_iacucs(conn, [iacuc])
