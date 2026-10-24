"""Inspection, finding and attachment row persistence and projections."""

import json
from collections import Counter

from server_app.shared import clean_text, new_id


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


def _inspection_list_item(conn, row, finding_counts=None):
    item = _inspection_payload(row)
    counts = finding_counts
    if counts is None:
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


def _distinct(conn, sql, params):
    return [row[0] for row in conn.execute(sql, tuple(params)).fetchall() if clean_text(row[0])]
