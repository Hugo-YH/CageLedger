"""Room-scoped animal inspection records, evidence, and corrective-action workflow."""

import json
from collections import Counter

from server_app.config import ANIMAL_INSPECTION_ATTACHMENTS_PATH
from server_app.domains.administration import audit_event, merge_audit_logs, write_audit_events
from server_app.pdf.animal_inspection import render_animal_inspection_pdf
from server_app.shared import clean_text, new_id, now_iso

from .catalog import CATALOG_VERSION, ensure_catalog_rows
from .catalog import catalog_payload as read_catalog_payload
from .catalog_payload import prepare_catalog_payload

ALLOWED_IMAGE_TYPES = {"image/jpeg", "image/png", "image/webp"}
MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024
FINDING_STATUSES = {"pending", "in_progress", "pending_recheck", "resolved"}


def ensure_catalog(conn):
    return ensure_catalog_rows(conn)


def catalog_payload(conn, actor):
    _require_actor(actor)
    payload = prepare_catalog_payload(read_catalog_payload(conn))
    payload["reviewNotice"] = "评分标准、图例和建议处置为内部参考资料；医疗与安乐死建议需经兽医和伦理流程确认。"
    return payload


def list_inspections(conn, actor, filters):
    _require_actor(actor)
    where, params = _inspection_visibility_clause(actor)
    room = clean_text(filters.get("room"))
    status = clean_text(filters.get("status"))
    module = clean_text(filters.get("module"))
    creator = clean_text(filters.get("creator"))
    date_from = clean_text(filters.get("dateFrom"))
    date_to = clean_text(filters.get("dateTo"))
    if room:
        where.append("room_name = ?")
        params.append(room)
    if status:
        where.append("status = ?")
        params.append(status)
    if module:
        where.append("module_codes LIKE ?")
        params.append(f'%"{module}"%')
    if creator:
        where.append("created_by_name = ?")
        params.append(creator)
    if date_from:
        where.append("updated_at >= ?")
        params.append(date_from)
    if date_to:
        where.append("updated_at <= ?")
        params.append(f"{date_to}T23:59:59")
    sort_map = {
        "room": "room_name COLLATE NOCASE",
        "status": "status",
        "creator": "created_by_name COLLATE NOCASE",
        "submittedAt": "submitted_at",
        "updatedAt": "updated_at",
    }
    sort_key = sort_map.get(clean_text(filters.get("sortKey")), "updated_at")
    direction = "ASC" if clean_text(filters.get("sortDir")).lower() == "asc" else "DESC"
    limit = max(1, min(int(filters.get("limit") or 20), 100))
    offset = max(0, int(filters.get("offset") or 0))
    clause = " AND ".join(where)
    total = conn.execute(f"SELECT COUNT(*) FROM animal_inspections WHERE {clause}", tuple(params)).fetchone()[0]
    rows = conn.execute(
        f"SELECT * FROM animal_inspections WHERE {clause} ORDER BY {sort_key} {direction}, id DESC LIMIT ? OFFSET ?",
        (*params, limit, offset),
    ).fetchall()
    items = [_inspection_list_item(conn, row) for row in rows]
    options = {
        "rooms": _distinct(conn, f"SELECT DISTINCT room_name FROM animal_inspections WHERE {clause}", params),
        "creators": _distinct(conn, f"SELECT DISTINCT created_by_name FROM animal_inspections WHERE {clause}", params),
    }
    return {"items": items, "page": {"offset": offset, "limit": limit, "total": total}, "filterOptions": options}


def get_inspection(conn, actor, inspection_id):
    item = _inspection_row(conn, inspection_id)
    _require_view(actor, item)
    answers = [
        dict(row) | {"payload": json.loads(row["payload"])}
        for row in conn.execute(
            "SELECT * FROM animal_inspection_answers WHERE inspection_id = ? ORDER BY module_code, node_code",
            (inspection_id,),
        )
    ]
    findings = [
        _finding_payload(conn, row)
        for row in conn.execute(
            "SELECT * FROM animal_inspection_findings WHERE inspection_id = ? ORDER BY severity, updated_at DESC",
            (inspection_id,),
        )
    ]
    return {"item": item, "answers": answers, "findings": findings, "catalog": catalog_payload(conn, actor)}


def create_or_update_inspection(conn, actor, inspection_id, body):
    _require_actor(actor)
    room_id = clean_text(body.get("roomId"))
    modules = _clean_modules(body.get("moduleCodes"))
    answers = _clean_answers(body.get("answers"))
    if inspection_id:
        current = _inspection_row(conn, inspection_id)
        _require_draft_write(actor, current)
        room_id = room_id or current["roomId"]
        modules = modules or current["moduleCodes"]
        created_at = current["createdAt"]
    else:
        current = None
        created_at = now_iso()
    if not room_id:
        raise ValueError("请选择饲养间")
    if not modules:
        raise ValueError("至少选择一个评估模块")
    room, snapshot = _room_snapshot(conn, room_id)
    inspection_id = inspection_id or new_id("inspect")
    updated_at = now_iso()
    record = {
        "id": inspection_id,
        "roomId": room_id,
        "roomName": room.get("name", ""),
        "facility": room.get("facility") or room.get("area") or "",
        "moduleCodes": modules,
        "status": "draft",
        "catalogVersion": CATALOG_VERSION,
        "createdBy": actor["id"],
        "createdByName": actor["displayName"],
        "createdAt": created_at,
        "submittedAt": "",
        "updatedAt": updated_at,
        "snapshot": snapshot,
    }
    if current:
        record = {**current, **record, "createdBy": current["createdBy"], "createdByName": current["createdByName"]}
    conn.execute(
        """
        INSERT INTO animal_inspections
          (id, room_id, room_name, facility, module_codes, status, catalog_version, created_by, created_by_name, submitted_at, updated_at, snapshot_json, payload)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          room_id=excluded.room_id, room_name=excluded.room_name, facility=excluded.facility, module_codes=excluded.module_codes,
          status=excluded.status, catalog_version=excluded.catalog_version, updated_at=excluded.updated_at,
          snapshot_json=excluded.snapshot_json, payload=excluded.payload
        """,
        _inspection_values(record),
    )
    conn.execute("DELETE FROM animal_inspection_answers WHERE inspection_id = ?", (inspection_id,))
    _insert_answers(conn, inspection_id, answers)
    audit = audit_event(
        actor,
        "animal_inspection.draft_saved",
        "animal_inspection",
        inspection_id,
        f"{actor['displayName']} 保存饲养间 {record['roomName']} 巡检草稿",
        [],
        updated_at,
        current,
        record,
    )
    write_audit_events(conn, [audit])
    conn.commit()
    return {"item": _inspection_row(conn, inspection_id), "auditLogs": merge_audit_logs([], [audit])}


def submit_inspection(conn, actor, inspection_id):
    item = _inspection_row(conn, inspection_id)
    _require_draft_write(actor, item)
    answers = [
        dict(row)
        for row in conn.execute("SELECT * FROM animal_inspection_answers WHERE inspection_id = ?", (inspection_id,))
    ]
    _validate_submission(conn, item, answers)
    now = now_iso()
    submitted = {**item, "status": "submitted", "submittedAt": now, "updatedAt": now}
    conn.execute(
        "UPDATE animal_inspections SET status = ?, submitted_at = ?, updated_at = ?, payload = ? WHERE id = ?",
        ("submitted", now, now, json.dumps(submitted, ensure_ascii=False), inspection_id),
    )
    conn.execute("DELETE FROM animal_inspection_findings WHERE inspection_id = ?", (inspection_id,))
    findings = []
    for answer in answers:
        if int(answer["score"]) >= 3:
            continue
        answer_payload = json.loads(answer["payload"])
        finding = {
            "id": new_id("finding"),
            "inspectionId": inspection_id,
            "roomId": item["roomId"],
            "moduleCode": answer["module_code"],
            "nodeCode": answer["node_code"],
            "severity": int(answer["score"]),
            "status": "pending",
            "locationHint": clean_text(answer_payload.get("locationHint")),
            "rackHint": clean_text(answer_payload.get("rackHint")),
            "cageNumber": clean_text(answer_payload.get("cageNumber")),
            "animalIdentifier": clean_text(answer_payload.get("animalIdentifier")),
            "actionNote": "",
            "responsibleName": "",
            "recheckDueAt": "",
            "resolvedAt": "",
            "updatedAt": now,
        }
        _upsert_finding(conn, finding)
        _insert_finding_event(conn, finding["id"], "created", "评分异常，等待处置", actor, now)
        findings.append(finding)
    audit = audit_event(
        actor,
        "animal_inspection.submitted",
        "animal_inspection",
        inspection_id,
        f"{actor['displayName']} 提交饲养间 {item['roomName']} 巡检记录，生成 {len(findings)} 项待处理异常",
        [],
        now,
        item,
        submitted,
    )
    write_audit_events(conn, [audit])
    conn.commit()
    return {
        "item": _inspection_row(conn, inspection_id),
        "findings": findings,
        "auditLogs": merge_audit_logs([], [audit]),
    }


def list_findings(conn, actor, filters):
    _require_actor(actor)
    where, params = _finding_visibility_clause(actor)
    status = clean_text(filters.get("status"))
    room = clean_text(filters.get("room"))
    severity = clean_text(filters.get("severity"))
    if status:
        where.append("f.status = ?")
        params.append(status)
    if room:
        where.append("i.room_name = ?")
        params.append(room)
    if severity in {"1", "2"}:
        where.append("f.severity = ?")
        params.append(int(severity))
    clause = " AND ".join(where)
    limit = max(1, min(int(filters.get("limit") or 50), 100))
    offset = max(0, int(filters.get("offset") or 0))
    rows = conn.execute(
        f"""SELECT f.* FROM animal_inspection_findings f
            JOIN animal_inspections i ON i.id = f.inspection_id
            WHERE {clause} ORDER BY CASE f.status WHEN 'pending' THEN 0 WHEN 'in_progress' THEN 1 WHEN 'pending_recheck' THEN 2 ELSE 3 END,
            f.severity ASC, f.recheck_due_at ASC, f.updated_at DESC LIMIT ? OFFSET ?""",
        (*params, limit, offset),
    ).fetchall()
    total = conn.execute(
        f"SELECT COUNT(*) FROM animal_inspection_findings f JOIN animal_inspections i ON i.id = f.inspection_id WHERE {clause}",
        tuple(params),
    ).fetchone()[0]
    return {
        "items": [_finding_payload(conn, row) for row in rows],
        "page": {"offset": offset, "limit": limit, "total": total},
    }


def update_finding(conn, actor, finding_id, body):
    finding = _finding_row(conn, finding_id)
    inspection = _inspection_row(conn, finding["inspectionId"])
    _require_room_manager(actor, inspection)
    status = clean_text(body.get("status")) or finding["status"]
    if status not in FINDING_STATUSES:
        raise ValueError("异常处置状态无效")
    updated = {
        **finding,
        "status": status,
        "actionNote": clean_text(body.get("actionNote")) or finding["actionNote"],
        "responsibleName": clean_text(body.get("responsibleName")) or finding["responsibleName"],
        "recheckDueAt": clean_text(body.get("recheckDueAt")) or finding["recheckDueAt"],
        "updatedAt": now_iso(),
    }
    _upsert_finding(conn, updated)
    _insert_finding_event(
        conn,
        finding_id,
        "action_updated",
        clean_text(body.get("note")) or updated["actionNote"],
        actor,
        updated["updatedAt"],
    )
    audit = audit_event(
        actor,
        "animal_inspection.finding_updated",
        "animal_inspection_finding",
        finding_id,
        f"{actor['displayName']} 更新异常处置状态为 {status}",
        [],
        updated["updatedAt"],
        finding,
        updated,
    )
    write_audit_events(conn, [audit])
    conn.commit()
    return {"item": _finding_payload(conn, _finding_row(conn, finding_id)), "auditLogs": merge_audit_logs([], [audit])}


def resolve_finding(conn, actor, finding_id, body):
    finding = _finding_row(conn, finding_id)
    inspection = _inspection_row(conn, finding["inspectionId"])
    if actor.get("role") != "admin":
        _require_room_manager(actor, inspection)
    conclusion = clean_text(body.get("conclusion"))
    if not conclusion:
        raise ValueError("请填写关闭结论")
    now = now_iso()
    updated = {**finding, "status": "resolved", "resolvedAt": now, "updatedAt": now, "actionNote": conclusion}
    _upsert_finding(conn, updated)
    _insert_finding_event(conn, finding_id, "resolved", conclusion, actor, now)
    audit = audit_event(
        actor,
        "animal_inspection.finding_resolved",
        "animal_inspection_finding",
        finding_id,
        f"{actor['displayName']} 关闭异常处置项",
        [],
        now,
        finding,
        updated,
    )
    write_audit_events(conn, [audit])
    conn.commit()
    return {"item": _finding_payload(conn, _finding_row(conn, finding_id)), "auditLogs": merge_audit_logs([], [audit])}


def add_attachment(conn, actor, inspection_id, finding_id, filename, body, content_type):
    inspection = _inspection_row(conn, inspection_id)
    _require_view(actor, inspection)
    finding = _finding_row(conn, finding_id)
    if finding["inspectionId"] != inspection_id:
        raise ValueError("附件与异常处置项不匹配")
    attachment_count = conn.execute(
        "SELECT COUNT(*) FROM animal_inspection_attachments WHERE finding_id = ?", (finding_id,)
    ).fetchone()[0]
    if attachment_count >= 3:
        raise ValueError("每个异常条目最多上传 3 张照片")
    if len(body) > MAX_ATTACHMENT_BYTES:
        raise ValueError("单张照片不能超过 10 MB")
    mime_type = _detect_image_type(body, content_type)
    if mime_type not in ALLOWED_IMAGE_TYPES:
        raise ValueError("仅支持 JPEG、PNG 或 WebP 图片")
    attachment_id = new_id("inspection-image")
    suffix = {"image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp"}[mime_type]
    stored_name = f"{attachment_id}{suffix}"
    target = ANIMAL_INSPECTION_ATTACHMENTS_PATH / inspection_id / stored_name
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_bytes(body)
    record = {
        "id": attachment_id,
        "inspectionId": inspection_id,
        "findingId": finding_id,
        "originalName": clean_text(filename) or stored_name,
        "storedName": stored_name,
        "mimeType": mime_type,
        "sizeBytes": len(body),
        "createdBy": actor["id"],
        "createdAt": now_iso(),
    }
    conn.execute(
        """INSERT INTO animal_inspection_attachments
           (id, inspection_id, finding_id, original_name, stored_name, mime_type, size_bytes, created_by, created_at, payload)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
        (*_attachment_values(record),),
    )
    _insert_finding_event(
        conn, finding_id, "photo_added", f"添加现场照片 {record['originalName']}", actor, record["createdAt"]
    )
    audit = audit_event(
        actor,
        "animal_inspection.photo_added",
        "animal_inspection_attachment",
        attachment_id,
        f"{actor['displayName']} 上传异常现场照片",
        [],
        record["createdAt"],
        None,
        record,
    )
    write_audit_events(conn, [audit])
    conn.commit()
    return {"item": record, "auditLogs": merge_audit_logs([], [audit])}


def get_attachment(conn, actor, attachment_id):
    row = conn.execute("SELECT * FROM animal_inspection_attachments WHERE id = ?", (attachment_id,)).fetchone()
    if not row:
        raise LookupError("巡检照片不存在")
    record = _attachment_payload(row)
    inspection = _inspection_row(conn, record["inspectionId"])
    _require_view(actor, inspection)
    target = ANIMAL_INSPECTION_ATTACHMENTS_PATH / record["inspectionId"] / record["storedName"]
    if not target.is_file():
        raise LookupError("巡检照片文件不存在")
    return record, target.read_bytes()


def export_inspection_pdf(conn, actor, inspection_id):
    detail = get_inspection(conn, actor, inspection_id)
    return render_animal_inspection_pdf(
        detail
    ), f"实验动物巡检报告 {detail['item']['roomName']} {detail['item']['createdAt'][:10]}.pdf"


def _inspection_row(conn, inspection_id):
    row = conn.execute("SELECT * FROM animal_inspections WHERE id = ?", (inspection_id,)).fetchone()
    if not row:
        raise LookupError("巡检记录不存在")
    return _inspection_payload(row)


def _inspection_payload(row):
    payload = json.loads(row["payload"])
    payload.update(
        {
            "id": row["id"],
            "roomId": row["room_id"],
            "roomName": row["room_name"],
            "facility": row["facility"] or "",
            "moduleCodes": json.loads(row["module_codes"]),
            "status": row["status"],
            "catalogVersion": row["catalog_version"],
            "createdBy": row["created_by"],
            "createdByName": row["created_by_name"],
            "submittedAt": row["submitted_at"] or "",
            "updatedAt": row["updated_at"],
            "snapshot": json.loads(row["snapshot_json"]),
        }
    )
    return payload


def _inspection_values(item):
    return (
        item["id"],
        item["roomId"],
        item["roomName"],
        item["facility"],
        json.dumps(item["moduleCodes"], ensure_ascii=False),
        item["status"],
        item["catalogVersion"],
        item["createdBy"],
        item["createdByName"],
        item["submittedAt"] or None,
        item["updatedAt"],
        json.dumps(item["snapshot"], ensure_ascii=False),
        json.dumps(item, ensure_ascii=False),
    )


def _inspection_list_item(conn, row):
    item = _inspection_payload(row)
    counts = Counter(
        finding["status"]
        for finding in conn.execute(
            "SELECT status FROM animal_inspection_findings WHERE inspection_id = ?", (item["id"],)
        )
    )
    item["findingSummary"] = {
        "total": sum(counts.values()),
        "pending": counts["pending"] + counts["in_progress"] + counts["pending_recheck"],
        "resolved": counts["resolved"],
    }
    return item


def _room_snapshot(conn, room_id):
    row = conn.execute("SELECT payload FROM rooms WHERE id = ?", (room_id,)).fetchone()
    if not row:
        raise LookupError("饲养间不存在")
    room = json.loads(row["payload"])
    occupancy_rows = conn.execute(
        "SELECT iacuc, pi, species, animal_count, cage_code FROM occupancies WHERE room_id = ? AND status IN ('active', 'reserved')",
        (room_id,),
    ).fetchall()
    iacucs = sorted({clean_text(item["iacuc"]) for item in occupancy_rows if clean_text(item["iacuc"])})
    pis = sorted({clean_text(item["pi"]) for item in occupancy_rows if clean_text(item["pi"])})
    species = sorted({clean_text(item["species"]) for item in occupancy_rows if clean_text(item["species"])})
    cages = sorted({clean_text(item["cage_code"]) for item in occupancy_rows if clean_text(item["cage_code"])})
    snapshot = {
        "iacucs": iacucs,
        "pis": pis,
        "species": species,
        "animalCount": sum(int(item["animal_count"] or 0) for item in occupancy_rows),
        "cageCodes": cages,
    }
    return room, snapshot


def _clean_modules(value):
    allowed = {"basicAssessment", "advancedAssessment", "abnormalAnimalAssessment"}
    return [item for item in dict.fromkeys(clean_text(entry) for entry in (value or [])) if item in allowed]


def _clean_answers(value):
    answers = []
    for item in value or []:
        code = clean_text(item.get("nodeCode"))
        module = clean_text(item.get("moduleCode"))
        score = item.get("score")
        if not code or module not in {"basicAssessment", "advancedAssessment", "abnormalAnimalAssessment"}:
            continue
        try:
            score = int(score)
        except (TypeError, ValueError):
            continue
        if score not in {1, 2, 3}:
            continue
        answers.append(
            {
                "nodeCode": code,
                "moduleCode": module,
                "score": score,
                "subOption": clean_text(item.get("subOption")),
                "note": clean_text(item.get("note")),
                "locationHint": clean_text(item.get("locationHint")),
                "rackHint": clean_text(item.get("rackHint")),
                "cageNumber": clean_text(item.get("cageNumber")),
                "animalIdentifier": clean_text(item.get("animalIdentifier")),
            }
        )
    return answers


def _insert_answers(conn, inspection_id, answers):
    for answer in answers:
        payload = dict(answer)
        conn.execute(
            """INSERT INTO animal_inspection_answers (id, inspection_id, module_code, node_code, score, sub_option, note, payload)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
            (
                new_id("inspection-answer"),
                inspection_id,
                answer["moduleCode"],
                answer["nodeCode"],
                answer["score"],
                answer["subOption"] or None,
                answer["note"] or None,
                json.dumps(payload, ensure_ascii=False),
            ),
        )


def _validate_submission(conn, inspection, answers):
    selected = set(inspection["moduleCodes"])
    answered = {(item["module_code"], item["node_code"]) for item in answers}
    rows = conn.execute(
        "SELECT module_code, code, input_type FROM inspection_catalog_nodes WHERE version = ? AND node_type = 'ITEM'",
        (inspection["catalogVersion"],),
    ).fetchall()
    missing = [
        row["code"]
        for row in rows
        if row["module_code"] in selected
        and row["module_code"] != "abnormalAnimalAssessment"
        and (row["module_code"], row["code"]) not in answered
    ]
    if missing:
        raise ValueError(f"仍有 {len(missing)} 项基础或进阶评分未填写")


def _finding_row(conn, finding_id):
    row = conn.execute("SELECT * FROM animal_inspection_findings WHERE id = ?", (finding_id,)).fetchone()
    if not row:
        raise LookupError("异常处置项不存在")
    return _finding_payload(conn, row)


def _finding_payload(conn, row):
    payload = json.loads(row["payload"])
    payload.update(
        {
            "id": row["id"],
            "inspectionId": row["inspection_id"],
            "roomId": row["room_id"],
            "moduleCode": row["module_code"],
            "nodeCode": row["node_code"],
            "severity": row["severity"],
            "status": row["status"],
            "locationHint": row["location_hint"] or "",
            "rackHint": row["rack_hint"] or "",
            "cageNumber": row["cage_number"] or "",
            "animalIdentifier": row["animal_identifier"] or "",
            "actionNote": row["action_note"] or "",
            "responsibleName": row["responsible_name"] or "",
            "recheckDueAt": row["recheck_due_at"] or "",
            "resolvedAt": row["resolved_at"] or "",
            "updatedAt": row["updated_at"],
        }
    )
    inspection = conn.execute(
        "SELECT room_name, created_by_name FROM animal_inspections WHERE id = ?", (row["inspection_id"],)
    ).fetchone()
    payload["roomName"] = inspection["room_name"] if inspection else ""
    payload["createdByName"] = inspection["created_by_name"] if inspection else ""
    payload["attachments"] = [
        _attachment_payload(item)
        for item in conn.execute(
            "SELECT * FROM animal_inspection_attachments WHERE finding_id = ? ORDER BY created_at", (row["id"],)
        )
    ]
    payload["events"] = [
        dict(item) | {"payload": json.loads(item["payload"])}
        for item in conn.execute(
            "SELECT * FROM animal_inspection_finding_events WHERE finding_id = ? ORDER BY at", (row["id"],)
        )
    ]
    return payload


def _upsert_finding(conn, item):
    conn.execute(
        """INSERT INTO animal_inspection_findings
           (id, inspection_id, room_id, module_code, node_code, severity, status, location_hint, rack_hint, cage_number,
            animal_identifier, action_note, responsible_name, recheck_due_at, resolved_at, updated_at, payload)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET status=excluded.status, location_hint=excluded.location_hint,
             rack_hint=excluded.rack_hint, cage_number=excluded.cage_number, animal_identifier=excluded.animal_identifier,
             action_note=excluded.action_note, responsible_name=excluded.responsible_name,
             recheck_due_at=excluded.recheck_due_at, resolved_at=excluded.resolved_at, updated_at=excluded.updated_at, payload=excluded.payload""",
        (
            item["id"],
            item["inspectionId"],
            item["roomId"],
            item["moduleCode"],
            item["nodeCode"],
            item["severity"],
            item["status"],
            item["locationHint"] or None,
            item["rackHint"] or None,
            item["cageNumber"] or None,
            item["animalIdentifier"] or None,
            item["actionNote"] or None,
            item["responsibleName"] or None,
            item["recheckDueAt"] or None,
            item["resolvedAt"] or None,
            item["updatedAt"],
            json.dumps(item, ensure_ascii=False),
        ),
    )


def _insert_finding_event(conn, finding_id, event_type, note, actor, at):
    payload = {
        "findingId": finding_id,
        "eventType": event_type,
        "note": note,
        "actorId": actor["id"],
        "actorName": actor["displayName"],
        "at": at,
    }
    conn.execute(
        """INSERT INTO animal_inspection_finding_events (id, finding_id, event_type, note, actor_id, actor_name, at, payload)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
        (
            new_id("finding-event"),
            finding_id,
            event_type,
            note or None,
            actor["id"],
            actor["displayName"],
            at,
            json.dumps(payload, ensure_ascii=False),
        ),
    )


def _attachment_values(item):
    return (
        item["id"],
        item["inspectionId"],
        item["findingId"],
        item["originalName"],
        item["storedName"],
        item["mimeType"],
        item["sizeBytes"],
        item["createdBy"],
        item["createdAt"],
        json.dumps(item, ensure_ascii=False),
    )


def _attachment_payload(row):
    payload = json.loads(row["payload"])
    payload.update(
        {
            "id": row["id"],
            "inspectionId": row["inspection_id"],
            "findingId": row["finding_id"],
            "originalName": row["original_name"],
            "mimeType": row["mime_type"],
            "sizeBytes": row["size_bytes"],
            "createdAt": row["created_at"],
            "downloadUrl": f"/api/animal-inspection-attachments/{row['id']}",
        }
    )
    return payload


def _inspection_visibility_clause(actor):
    if actor.get("role") == "admin":
        return ["1 = 1"], []
    allowed = [clean_text(item) for item in actor.get("roomIds", []) if clean_text(item)]
    placeholders = ", ".join("?" for _ in allowed)
    if allowed:
        return [f"(created_by = ? OR room_id IN ({placeholders}))"], [actor["id"], *allowed]
    return ["created_by = ?"], [actor["id"]]


def _finding_visibility_clause(actor):
    if actor.get("role") == "admin":
        return ["1 = 1"], []
    allowed = [clean_text(item) for item in actor.get("roomIds", []) if clean_text(item)]
    placeholders = ", ".join("?" for _ in allowed)
    if allowed:
        return [f"(i.created_by = ? OR i.room_id IN ({placeholders}))"], [actor["id"], *allowed]
    return ["i.created_by = ?"], [actor["id"]]


def _require_actor(actor):
    if not actor:
        raise PermissionError("请先登录")


def _require_view(actor, item):
    _require_actor(actor)
    if (
        actor.get("role") == "admin"
        or item["createdBy"] == actor.get("id")
        or item["roomId"] in set(actor.get("roomIds", []))
    ):
        return
    raise PermissionError("无权查看该饲养间巡检记录")


def _require_draft_write(actor, item):
    _require_view(actor, item)
    if item["status"] != "draft":
        raise ValueError("已提交巡检记录保持锁定，请通过复查记录补充处理结果")
    if actor.get("role") != "admin" and item["createdBy"] != actor.get("id"):
        raise PermissionError("仅创建者可编辑巡检草稿")


def _require_room_manager(actor, item):
    _require_view(actor, item)
    if actor.get("role") == "admin" or item["roomId"] in set(actor.get("roomIds", [])):
        return
    raise PermissionError("需要该饲养间的处置权限")


def _distinct(conn, sql, params):
    return [row[0] for row in conn.execute(sql, tuple(params)).fetchall() if clean_text(row[0])]


def _detect_image_type(body, declared):
    if body.startswith(b"\xff\xd8\xff"):
        return "image/jpeg"
    if body.startswith(b"\x89PNG\r\n\x1a\n"):
        return "image/png"
    if body.startswith(b"RIFF") and body[8:12] == b"WEBP":
        return "image/webp"
    return clean_text(declared).split(";", 1)[0].lower()
