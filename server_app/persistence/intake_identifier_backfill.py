"""One-time, audited supplementation of missing identifiers from preserved source text."""

import hashlib
import json
import re

from server_app.domains.intake.identifier_recognition import identifier_candidates, recognized_identifiers
from server_app.repositories.audit import insert_audit_events
from server_app.repositories.audit_storage import payloads_for_rows
from server_app.repositories.payload import dump_json, read_setting, set_setting
from server_app.shared import new_id, now_iso
from server_app.shared.concurrency import begin_write
from server_app.shared.intake_identifiers import intake_identifier_values, intake_order_identifier_values

MIGRATION_KEY = "intakeIdentifierBackfillV1"
_FIELDS = ("purchaseOrderNo", "orderNo")


def _cleared_fields(conn, identities):
    """Respect explicit historical clears, including compressed audit details."""
    result = {}
    cursor = conn.execute(
        f"SELECT id,entity_id,payload FROM audit_events WHERE entity_type='intake_batch' "
        f"AND entity_id IN ({','.join('?' for _ in identities)})",
        identities,
    )
    while rows := cursor.fetchmany(100):
        decoded = payloads_for_rows(conn, [(row["id"], row["payload"]) for row in rows])
        for row, raw in zip(rows, decoded, strict=True):
            event = json.loads(raw)
            before, after = event.get("before"), event.get("after")
            if not isinstance(before, dict) or not isinstance(after, dict):
                continue
            for field in _FIELDS:
                if str(before.get(field) or "").strip() and field in after and not str(after[field] or "").strip():
                    result.setdefault(row["entity_id"], set()).add(field)
    return result


def _plan(item, cleared):
    candidates = identifier_candidates(item.get("rawMessage"))
    if not any(candidates.values()):
        return {}, "", candidates
    if any(len(values) > 1 for values in candidates.values()):
        return {}, "multiple_identifiers", candidates
    values = recognized_identifiers(item.get("rawMessage"))
    purchase, order = values["purchaseOrderNo"], values["orderNo"]
    if purchase and order and purchase != order[1:-2]:
        return {}, "source_identifier_mismatch", candidates
    recognition = item.get("recognition")
    if isinstance(recognition, dict):
        sources = recognition.get("sources")
        sources = sources if isinstance(sources, list) else []
        fields = recognition.get("fieldSources")
        if isinstance(fields, dict):
            sources = [*sources, fields]
        evidence = identifier_candidates(
            "\n".join(str(source.get(key) or "") for source in sources if isinstance(source, dict) for key in _FIELDS)
        )
        if (
            any(len(numbers) > 1 for numbers in evidence.values())
            or any(number != purchase for number in evidence["purchaseOrderNo"])
            or any(number[1:-2] != purchase or (order and number != order) for number in evidence["orderNo"])
        ):
            return {}, "recognition_evidence_mismatch", candidates
    existing = {key: str(item.get(key) or "").strip() for key in _FIELDS}
    for key in _FIELDS:
        if existing[key] and values[key] and existing[key].upper() != values[key]:
            return {}, "existing_identifier_mismatch", candidates
    if existing["orderNo"]:
        if not re.fullmatch(r"DC[0-9]{15}", existing["orderNo"], re.IGNORECASE):
            return {}, "nonstandard_existing_order", candidates
        if purchase and existing["orderNo"].upper()[1:-2] != purchase:
            return {}, "existing_identifier_mismatch", candidates
    updates = {key: value for key, value in values.items() if value and not existing[key]}
    if updates.keys() & cleared:
        return {}, "explicitly_cleared", candidates
    return updates, "", candidates


def _event(item, now, *, identity, updates=None, reason="", candidates=None):
    before = {key: item[key] for key in (*_FIELDS, "updatedAt") if key in item}
    return {
        "id": new_id("audit"),
        "actorUserId": "system",
        "actorUsername": "system",
        "actorDisplayName": "系统数据兼容",
        "action": "intake_batch.identifier_backfill_skipped" if reason else "intake_batch.identifiers_backfilled",
        "entityType": "intake_batch",
        "entityId": identity,
        "slotIds": [],
        "at": now,
        "message": "预约编号补填待人工核对，保留原值" if reason else "从预约原文补齐空白采购单号或订单编号",
        "before": before,
        "after": before if reason else {**before, **updates, "updatedAt": now},
        "source": {
            "migration": MIGRATION_KEY,
            "rawMessageSha256": hashlib.sha256(str(item.get("rawMessage") or "").encode()).hexdigest(),
            "candidates": candidates,
            "reason": reason or "unique_source_identifier",
        },
    }


def backfill_intake_identifiers(conn):
    # Run once before serving requests. A durable setting also prevents a later
    # intentional clear/new record from being silently filled on another start.
    begin_write(conn)
    previous = read_setting(conn, MIGRATION_KEY, None)
    if previous is not None:
        return previous
    summary = {"scanned": 0, "changed": 0, "skipped": 0, "withoutEvidence": 0}
    now = now_iso()
    cursor = conn.execute("SELECT id,payload FROM intake_batches ORDER BY rowid")
    while rows := cursor.fetchmany(100):
        items = [json.loads(row["payload"]) for row in rows]
        cleared = _cleared_fields(conn, [row["id"] for row in rows])
        events = []
        for row, item in zip(rows, items, strict=True):
            summary["scanned"] += 1
            updates, reason, candidates = _plan(item, cleared.get(row["id"], set()))
            if updates and item.get("id") != row["id"]:
                updates, reason = {}, "source_identity_mismatch"
            if not any(candidates.values()):
                summary["withoutEvidence"] += 1
            if reason:
                summary["skipped"] += 1
                events.append(_event(item, now, identity=row["id"], reason=reason, candidates=candidates))
            elif updates:
                enriched = {**item, **updates, "updatedAt": now}
                values = (*intake_identifier_values(enriched), *intake_order_identifier_values(enriched))
                conn.execute(
                    "UPDATE intake_batches SET purchase_order_no=?,purchase_order_key=?,batch_no_key=?,"
                    "order_no=?,order_key=?,updated_at=?,payload=? WHERE id=?",
                    (*values, now, dump_json(enriched), row["id"]),
                )
                summary["changed"] += 1
                events.append(_event(item, now, identity=row["id"], updates=updates, candidates=candidates))
        if events:
            insert_audit_events(conn, events)
    set_setting(conn, MIGRATION_KEY, summary, now)
    return summary
