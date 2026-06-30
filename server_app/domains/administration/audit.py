from server_app.cache import invalidate_data_cache_prefixes
from server_app.repositories.audit import insert_audit_events
from server_app.shared import new_id


def action_label(action):
    if action.endswith(".created"):
        return "新增"
    if action.endswith(".deleted"):
        return "删除"
    return "更新"


def audit_event(actor, action, entity_type, entity_id, message, slot_ids, at, before, after):
    return {
        "id": new_id("audit"),
        "actorUserId": actor["id"],
        "actorUsername": actor["username"],
        "actorDisplayName": actor["displayName"],
        "action": action,
        "entityType": entity_type,
        "entityId": entity_id,
        "message": message,
        "slotIds": slot_ids,
        "at": at,
        "before": before,
        "after": after,
    }


def write_audit_events(conn, events):
    insert_audit_events(conn, events)
    if events:
        invalidate_data_cache_prefixes("audit_events::")


def merge_audit_logs(client_logs, events):
    normalized_events = [
        {
            "id": event["id"],
            "message": event["message"],
            "at": event["at"],
            "actorUsername": event["actorUsername"],
            "actorDisplayName": event["actorDisplayName"],
            "action": event["action"],
            "slotIds": event["slotIds"],
        }
        for event in events
    ]
    seen = set()
    merged = []
    for item in normalized_events + list(client_logs):
        item_id = item.get("id")
        if item_id in seen:
            continue
        seen.add(item_id)
        merged.append(item)
    return merged[:500]
