def sync_quantity_sheet_transfer_rows(conn, source_sheet, actor, now, deps):
    month = source_sheet.get("month", "")
    source_sheet_id = source_sheet.get("id", "")
    source_iacuc = deps["normalize_iacuc_number"](source_sheet.get("iacuc", ""))
    if not month or not source_sheet_id or not source_iacuc:
        return [], []

    applications_by_iacuc = deps["read_applications_by_iacuc"](conn)
    rows = source_sheet.get("rows", [])
    transfer_rows = []
    for row in rows:
        if deps["clean_text"](row.get("transferSourceSheetId", "")):
            continue
        row_id = deps["clean_text"](row.get("id", "")) or deps["new_id"]("qrow")
        row_date = deps["clean_text"](row.get("date", "")) or f"{month}-01"
        row_notes = deps["clean_text"](row.get("notes", ""))
        added_count = deps["as_int"](row.get("addedCount")) or 0
        removed_count = deps["as_int"](row.get("removedCount")) or 0
        target_iacuc = deps["normalize_iacuc_number"](row.get("transferOutToIacuc", ""))
        if target_iacuc and removed_count > 0 and target_iacuc != source_iacuc:
            transfer_rows.append(
                {
                    "direction": "out_to_in",
                    "sourceRowId": row_id,
                    "date": row_date,
                    "notes": row_notes,
                    "targetIacuc": target_iacuc,
                    "count": removed_count,
                    "fromIacuc": source_iacuc,
                    "toIacuc": target_iacuc,
                }
            )
        from_iacuc = deps["normalize_iacuc_number"](row.get("transferInFromIacuc", ""))
        if from_iacuc and added_count > 0 and from_iacuc != source_iacuc:
            transfer_rows.append(
                {
                    "direction": "in_to_out",
                    "sourceRowId": row_id,
                    "date": row_date,
                    "notes": row_notes,
                    "targetIacuc": from_iacuc,
                    "count": added_count,
                    "fromIacuc": from_iacuc,
                    "toIacuc": source_iacuc,
                }
            )

    target_iacucs = sorted({transfer["targetIacuc"] for transfer in transfer_rows if transfer["targetIacuc"]})
    source_row_ids = sorted({transfer["sourceRowId"] for transfer in transfer_rows if transfer.get("sourceRowId")})
    sheets = deps["select_quantity_sheets_for_transfer"](conn, month, source_sheet_id, target_iacucs, source_row_ids)
    events = []
    affected_sheet_by_id = {}

    for target_sheet in sheets:
        if target_sheet.get("id") == source_sheet_id:
            continue
        original_rows = target_sheet.get("rows", [])
        next_rows = []
        changed = False
        for row in original_rows:
            if deps["clean_text"](row.get("transferSourceSheetId", "")) == source_sheet_id:
                changed = True
                continue
            contrib = row.get("transferMirrorContrib")
            if isinstance(contrib, dict):
                next_contrib = {}
                row_changed = False
                for key, value in contrib.items():
                    if not str(key).startswith(f"{source_sheet_id}:"):
                        next_contrib[key] = deps["as_int"](value) or 0
                        continue
                    amount = deps["as_int"](value) or 0
                    if amount <= 0:
                        continue
                    direction = "out_to_in" if key.endswith(":out_to_in") else "in_to_out"
                    if direction == "out_to_in":
                        row["addedCount"] = max((deps["as_int"](row.get("addedCount")) or 0) - amount, 0)
                    else:
                        row["removedCount"] = max((deps["as_int"](row.get("removedCount")) or 0) - amount, 0)
                    row_changed = True
                    changed = True
                if row_changed:
                    if next_contrib:
                        row["transferMirrorContrib"] = next_contrib
                    else:
                        row.pop("transferMirrorContrib", None)
            next_rows.append(row)
        if changed:
            target_sheet["rows"] = sorted(next_rows, key=lambda item: (item.get("date", ""), item.get("id", "")))
            target_sheet["updatedAt"] = now
            deps["update_quantity_sheet"](conn, target_sheet, deps["quantity_sheet_db_values"](target_sheet))
            affected_sheet_by_id[target_sheet["id"]] = target_sheet

    target_sheet_by_iacuc = {}
    for target_sheet in sheets:
        key = deps["normalize_iacuc_number"](target_sheet.get("iacuc", ""))
        if key and key != source_iacuc and key not in target_sheet_by_iacuc:
            target_sheet_by_iacuc[key] = target_sheet

    for transfer in transfer_rows:
        target_iacuc = transfer["targetIacuc"]
        target_sheet = target_sheet_by_iacuc.get(target_iacuc)
        if not target_sheet:
            app = applications_by_iacuc.get(target_iacuc, {})
            target_sheet = {
                "id": deps["new_id"]("qsheet"),
                "month": month,
                "roomId": "",
                "roomName": "",
                "manager": actor.get("displayName", ""),
                "iacuc": target_iacuc,
                "project": deps["clean_text"](app.get("project", "")),
                "pi": deps["clean_text"](app.get("pi", "")),
                "owner": deps["clean_text"](app.get("owner", "")),
                "contact": "",
                "funding": deps["clean_text"](app.get("funding", "")),
                "billingUnit": "cage_day",
                "initialAnimalCount": 0,
                "initialCageCount": 0,
                "rows": [],
                "updatedAt": now,
            }
            deps["insert_quantity_sheet"](conn, target_sheet, deps["quantity_sheet_db_values"](target_sheet))
            target_sheet_by_iacuc[target_iacuc] = target_sheet
            sheets.append(target_sheet)
            affected_sheet_by_id[target_sheet["id"]] = target_sheet
            events.append(
                deps["audit_event"](
                    actor,
                    "quantity_sheet.transfer_placeholder_created",
                    "quantity_sheet",
                    target_sheet["id"],
                    f"{actor['displayName']} 自动创建 {target_iacuc} {month} 数量统计表（转移入账）",
                    [],
                    now,
                    None,
                    target_sheet,
                )
            )

        row_id = f"xfer-{source_sheet_id}-{transfer['sourceRowId']}-{target_iacuc}-{transfer['direction']}"
        contrib_key = f"{source_sheet_id}:{transfer['sourceRowId']}:{target_iacuc}:{transfer['direction']}"
        if transfer["direction"] == "out_to_in":
            mirrored_row = {
                "id": row_id,
                "date": transfer["date"],
                "addedCount": transfer["count"],
                "addedType": "转入",
                "transferInFromIacuc": transfer["fromIacuc"],
                "removedCount": None,
                "removedType": "",
                "transferOutToIacuc": "",
                "animalCount": None,
                "cageCount": None,
                "notes": transfer["notes"],
                "transferSourceSheetId": source_sheet_id,
                "transferSourceIacuc": source_iacuc,
            }
        else:
            mirrored_row = {
                "id": row_id,
                "date": transfer["date"],
                "addedCount": None,
                "addedType": "",
                "transferInFromIacuc": "",
                "removedCount": transfer["count"],
                "removedType": "转出",
                "transferOutToIacuc": transfer["toIacuc"],
                "animalCount": None,
                "cageCount": None,
                "notes": transfer["notes"],
                "transferSourceSheetId": source_sheet_id,
                "transferSourceIacuc": source_iacuc,
            }
        target_rows = [row for row in target_sheet.get("rows", []) if row.get("id") != row_id]
        merged = False
        for row in target_rows:
            if deps["clean_text"](row.get("transferSourceSheetId", "")):
                continue
            if deps["clean_text"](row.get("date", "")) != transfer["date"]:
                continue
            if transfer["direction"] == "out_to_in":
                if deps["clean_text"](row.get("addedType", "")) not in ("", "转入"):
                    continue
                if row.get("cageCount") is not None:
                    continue
                existing = row.get("transferMirrorContrib")
                contrib = existing if isinstance(existing, dict) else {}
                row["addedType"] = "转入"
                row["transferInFromIacuc"] = transfer["fromIacuc"]
                row["addedCount"] = (deps["as_int"](row.get("addedCount")) or 0) + transfer["count"]
                contrib[contrib_key] = transfer["count"]
                row["transferMirrorContrib"] = contrib
                merged = True
                break
            if deps["clean_text"](row.get("removedType", "")) not in ("", "转出"):
                continue
            if row.get("cageCount") is not None:
                continue
            existing = row.get("transferMirrorContrib")
            contrib = existing if isinstance(existing, dict) else {}
            row["removedType"] = "转出"
            row["transferOutToIacuc"] = transfer["toIacuc"]
            row["removedCount"] = (deps["as_int"](row.get("removedCount")) or 0) + transfer["count"]
            contrib[contrib_key] = transfer["count"]
            row["transferMirrorContrib"] = contrib
            merged = True
            break
        if not merged:
            target_rows.append(mirrored_row)
        target_sheet["rows"] = sorted(target_rows, key=lambda item: (item.get("date", ""), item.get("id", "")))
        target_sheet["updatedAt"] = now
        deps["update_quantity_sheet"](conn, target_sheet, deps["quantity_sheet_db_values"](target_sheet))
        affected_sheet_by_id[target_sheet["id"]] = target_sheet
        events.append(
            deps["audit_event"](
                actor,
                "quantity_sheet.transfer_synced",
                "quantity_sheet",
                target_sheet["id"],
                f"{actor['displayName']} 将 {source_iacuc} 转移记录同步到 {target_iacuc} 数量统计表",
                [],
                now,
                None,
                {"targetSheetId": target_sheet["id"], "targetIacuc": target_iacuc, "rowId": row_id},
            )
        )
    return events, list(affected_sheet_by_id.values())
