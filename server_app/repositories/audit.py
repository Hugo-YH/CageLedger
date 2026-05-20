from .payload import dump_json


def insert_audit_events(conn, events):
    for event in events:
        conn.execute(
            """
            INSERT INTO audit_events (
                id, actor_user_id, actor_username, actor_display_name, action,
                entity_type, entity_id, message, slot_ids, at, payload
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                event["id"],
                event["actorUserId"],
                event["actorUsername"],
                event["actorDisplayName"],
                event["action"],
                event["entityType"],
                event["entityId"],
                event["message"],
                dump_json(event["slotIds"]),
                event["at"],
                dump_json(event),
            ),
        )
