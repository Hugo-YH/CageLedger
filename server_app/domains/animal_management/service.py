"""Inspection use-case orchestration; persistence and permission rules are explicit dependencies."""

import json
from collections import Counter

from server_app.config import ANIMAL_INSPECTION_ATTACHMENTS_PATH
from server_app.domains.administration import audit_event, merge_audit_logs, write_audit_events
from server_app.pdf.animal_inspection import render_animal_inspection_pdf
from server_app.shared import clean_text, new_id, now_iso

from .catalog import CATALOG_VERSION, ensure_catalog_rows
from .catalog import catalog_payload as read_catalog_payload
from .catalog_payload import prepare_catalog_payload
from .inspection_repository import _attachment_payload as _attachment_payload
from .inspection_repository import _attachment_values as _attachment_values
from .inspection_repository import _distinct as _distinct
from .inspection_repository import _finding_payload as _finding_payload
from .inspection_repository import _finding_row as _finding_row
from .inspection_repository import _insert_answers as _insert_answers
from .inspection_repository import _insert_finding_event as _insert_finding_event
from .inspection_repository import _inspection_list_item as _inspection_list_item
from .inspection_repository import _inspection_payload as _inspection_payload
from .inspection_repository import _inspection_row as _inspection_row
from .inspection_repository import _inspection_values as _inspection_values
from .inspection_repository import _room_snapshot as _room_snapshot
from .inspection_repository import _upsert_finding as _upsert_finding
from .inspection_rules import _answer_outcome as _answer_outcome
from .inspection_rules import _detect_image_type as _detect_image_type
from .inspection_rules import _finding_visibility_clause as _finding_visibility_clause
from .inspection_rules import _inspection_visibility_clause as _inspection_visibility_clause
from .inspection_rules import _require_actor as _require_actor
from .inspection_rules import _require_draft_write as _require_draft_write
from .inspection_rules import _require_room_manager as _require_room_manager
from .inspection_rules import _require_view as _require_view
from .inspection_rules import _validate_submission as _validate_submission
from .normalization import clean_answers, clean_modules


def ensure_catalog(conn):
    return ensure_catalog_rows(conn)


def catalog_payload(conn, actor):
    _require_actor(actor)
    payload = prepare_catalog_payload(read_catalog_payload(conn))
    payload["reviewNotice"] = "巡检标准、图例和建议处置为内部参考资料；医疗与安乐死建议需经兽医和伦理流程确认。"
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
    finding_counts = {}
    if rows:
        inspection_ids = [row["id"] for row in rows]
        placeholders = ", ".join("?" for _ in inspection_ids)
        for count_row in conn.execute(
            f"""SELECT inspection_id, status, COUNT(*) AS count
                FROM animal_inspection_findings
                WHERE inspection_id IN ({placeholders})
                GROUP BY inspection_id, status""",
            inspection_ids,
        ).fetchall():
            finding_counts.setdefault(count_row["inspection_id"], Counter())[count_row["status"]] = count_row["count"]
    items = [_inspection_list_item(conn, row, finding_counts.get(row["id"])) for row in rows]
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
            "SELECT * FROM animal_inspection_findings WHERE inspection_id = ? ORDER BY updated_at DESC",
            (inspection_id,),
        )
    ]
    return {"item": item, "answers": answers, "findings": findings, "catalog": catalog_payload(conn, actor)}


def create_or_update_inspection(conn, actor, inspection_id, body):
    _require_actor(actor)
    room_id = clean_text(body.get("roomId"))
    modules = clean_modules(body.get("moduleCodes"))
    answers = clean_answers(body.get("answers"))
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
        answer_payload = json.loads(answer["payload"])
        if _answer_outcome(answer_payload, answer["score"]) != "abnormal":
            continue
        finding = {
            "id": new_id("finding"),
            "inspectionId": inspection_id,
            "roomId": item["roomId"],
            "moduleCode": answer["module_code"],
            "nodeCode": answer["node_code"],
            # The legacy column remains required by historical SQLite schemas.
            "severity": 2,
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
        _insert_finding_event(conn, finding["id"], "created", "已登记异常，等待处置", actor, now)
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
    if status:
        where.append("f.status = ?")
        params.append(status)
    if room:
        where.append("i.room_name = ?")
        params.append(room)
    clause = " AND ".join(where)
    limit = max(1, min(int(filters.get("limit") or 50), 100))
    offset = max(0, int(filters.get("offset") or 0))
    rows = conn.execute(
        f"""SELECT f.* FROM animal_inspection_findings f
            JOIN animal_inspections i ON i.id = f.inspection_id
            WHERE {clause} ORDER BY CASE f.status WHEN 'pending' THEN 0 WHEN 'in_progress' THEN 1 WHEN 'pending_recheck' THEN 2 ELSE 3 END,
            f.recheck_due_at ASC, f.updated_at DESC LIMIT ? OFFSET ?""",
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


ALLOWED_IMAGE_TYPES = {"image/jpeg", "image/png", "image/webp"}


MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024


FINDING_STATUSES = {"pending", "in_progress", "pending_recheck", "resolved"}
