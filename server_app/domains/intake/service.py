from datetime import date, timedelta


def next_monday_after(date_text, clean_text):
    try:
        current = date.fromisoformat(clean_text(date_text))
    except ValueError as exc:
        raise ValueError("实际接收日期无效") from exc
    days_until_next_monday = 7 - current.weekday()
    return (current + timedelta(days=days_until_next_monday)).isoformat()


def room_by_name(state, room_name, clean_text):
    target = clean_text(room_name)
    return next((room for room in state.get("rooms", []) if clean_text(room.get("name")) == target), None)


def intake_receipt_total(batch, as_int):
    return sum(max(as_int(item.get("cardCount")) or 0, 0) for item in batch.get("receipts", []))


def confirm_intake_receipt(state, batch_id, payload, actor, deps):
    batch = next((item for item in state.get("intakeBatches", []) if item.get("id") == batch_id), None)
    if not batch:
        raise LookupError("待接收批次不存在")
    if batch.get("status") not in ("printed", "received"):
        raise ValueError("只有已打印批次可以确认接收")
    actual_date = deps["clean_text"](payload.get("actualReceiptDate"))
    if not actual_date:
        raise ValueError("实际接收日期不能为空")
    card_count = deps["as_int"](payload.get("cardCount"))
    if card_count is None or card_count <= 0:
        raise ValueError("实际到货笼卡数必须大于 0")
    confirmed_total = intake_receipt_total(batch, deps["as_int"])
    final_count = max(deps["as_int"](batch.get("finalCardCount")) or 0, 0)
    if confirmed_total + card_count > final_count:
        raise ValueError("实际到货笼卡数超过打印张数")
    target_room = room_by_name(state, batch.get("roomName"), deps["clean_text"])
    if not target_room:
        raise ValueError("目标饲养间不存在，请先确认房间名称")
    receipt_id = deps["new_id"]("receipt")
    planned_date = next_monday_after(actual_date, deps["clean_text"])
    now = deps["now_iso"]()
    receipt = {
        "id": receipt_id,
        "actualReceiptDate": actual_date,
        "cardCount": card_count,
        "confirmedBy": actor.get("displayName", ""),
        "confirmedAt": now,
        "plannedMoveInDate": planned_date,
    }
    batch.setdefault("receipts", []).append(receipt)
    batch["confirmedCardCount"] = confirmed_total + card_count
    batch["remainingCardCount"] = max(final_count - batch["confirmedCardCount"], 0)
    batch["status"] = "received" if batch["remainingCardCount"] == 0 else "printed"
    batch["updatedAt"] = now
    tasks = []
    for index in range(card_count):
        card_sequence = confirmed_total + index + 1
        task = {
            "id": deps["new_id"]("ptask"),
            "sourceBatchId": batch["id"],
            "sourceReceiptId": receipt_id,
            "batchNo": batch.get("batchNo", ""),
            "targetRoomId": target_room.get("id", ""),
            "targetRoomName": target_room.get("name", ""),
            "plannedMoveInDate": planned_date,
            "status": "pending",
            "reservedOccupancyId": "",
            "actualMoveInDate": "",
            "roomChangeHistory": [],
            "iacuc": batch.get("iacuc", ""),
            "project": batch.get("project", ""),
            "pi": batch.get("pi", ""),
            "owner": batch.get("owner", ""),
            "species": batch.get("species", ""),
            "strainStandard": batch.get("strainStandard", ""),
            "animalCount": max(deps["as_int"](batch.get("suggestedAnimalsPerCage")) or 1, 1),
            "cardSequence": card_sequence,
            "qrId": deps["cage_card_qr_id"](batch, card_sequence) if deps.get("cage_card_qr_id") else "",
            "updatedAt": now,
        }
        state.setdefault("placementTasks", []).append(task)
        tasks.append(task)
    return batch, receipt, tasks
