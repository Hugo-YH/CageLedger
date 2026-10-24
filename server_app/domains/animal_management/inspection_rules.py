"""Inspection visibility, mutation permissions and submission/evidence validation."""

from server_app.shared import clean_text


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
        raise ValueError(f"仍有 {len(missing)} 项巡检结论未确认")


def _answer_outcome(payload, legacy_score):
    outcome = clean_text(payload.get("outcome"))
    if outcome in {"normal", "abnormal"}:
        return outcome
    return "abnormal" if int(legacy_score or 3) < 3 else "normal"


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


def _detect_image_type(body, declared):
    if body.startswith(b"\xff\xd8\xff"):
        return "image/jpeg"
    if body.startswith(b"\x89PNG\r\n\x1a\n"):
        return "image/png"
    if body.startswith(b"RIFF") and body[8:12] == b"WEBP":
        return "image/webp"
    return clean_text(declared).split(";", 1)[0].lower()
