"""Versioned, image/text-neutral appointment review and explicit supplementation."""

import copy
import hashlib
import json

from server_app.shared.concurrency import StaleWriteError, require_exact_version

from . import recognition_matching as rules
from .recognition_image_authority import incoming_image_fields
from .recognition_merge import identifier_matches, match_classification
from .recognition_period import calculated_comparisons
from .recognition_resolutions import field_resolutions, read_resolutions


def image_inputs(images):
    return [{"name": image.name, "sha256": hashlib.sha256(image.body).hexdigest()} for image in images]


def _identifier_row(row):
    return {"purchaseOrderNo": row["purchase_order_no"], "orderNo": row["order_no"], "batchNo": row["batch_no"]}


def _saved_image_first(existing, incoming, images):
    """Only a saved image appointment can retain its values over later text."""
    evidence = incoming.get("recognition") or {}
    return bool(
        (existing.get("recognition") or {}).get("images")
        and incoming.get("rawMessage")
        and not images
        and not evidence.get("inputImages")
        and not evidence.get("sources")
    )


def _candidate(existing, incoming, matches, unique_id, images, issues, resolutions):
    relation = rules.identifier_relation(existing, incoming)
    rows = rules.comparisons(existing, incoming)
    classification, fields = match_classification(existing, incoming)
    differences = [row for row in rows if row["status"] == "different"]
    image_first = _saved_image_first(existing, incoming, images)
    image_fields = incoming_image_fields(existing, incoming, images) if not issues else set()
    uncertain = [row for row in rows if row["field"] in rules.CORE and row["status"] == "unknown"]
    core_same = all(row["status"] == "same" for row in rows if row["field"] in rules.CORE)
    known = existing["id"] == unique_id and relation["distinct"]
    protected = existing.get("status") == "received" or bool(existing.get("receipts"))
    identity_conflict = any(row["field"] in (*rules.IDENTIFIERS, "iacuc", "intakePurpose") for row in differences)
    resolution_fields, choices = field_resolutions(
        rows,
        resolutions,
        eligible=known and not identity_conflict and not issues and not uncertain and not protected,
        saved_image_first=image_first,
        image_fields=image_fields,
    )
    blocking = [row for row in differences if row["field"] not in choices]
    merged, changes, merge_error = None, [], ""
    if known and not blocking and not issues and not protected and not uncertain:
        try:
            merged, changes = rules.supplement(
                existing,
                incoming,
                image_fields,
                choices,
                {field: choice for field, choice in resolutions.items() if field in resolution_fields},
            )
        except (ValueError, OverflowError) as exc:
            merge_error = str(exc)
    compared_fields = {row["field"] for row in rows}
    field_changes = any(change["field"] in compared_fields for change in changes)
    old_hashes = {entry.get("sha256") for entry in (existing.get("recognition") or {}).get("images", [])}
    new_material = bool({entry["sha256"] for entry in image_inputs(images)} - old_hashes)
    text = incoming.get("rawMessage", "")
    new_material |= bool(text and text not in (existing.get("rawMessage") or ""))
    if issues:
        status, reason = "conflict", "本次材料之间存在差异，请先核对文字和原图。"
    elif not known:
        status, reason = "related", "编号仅部分关联或有多个同等候选，请核对完整订单及饲养需求，不能自动合并。"
        if relation["conflicts"] and any(field in fields for field in ("batchNo", "orderNo")):
            status, reason = "conflict", "命中的订单或饲养需求对应其他编号，请核对是否错配或分批。"
    elif merge_error:
        status, reason = "conflict", merge_error
    elif blocking:
        status, reason = (
            "conflict",
            "编号相同，但已有信息与本次内容存在差异；可选择各差异字段的取值后合并。"
            if resolution_fields
            else "编号相同，但已有信息与本次内容存在差异，请核对双方依据。",
        )
    elif uncertain:
        status, reason = "insufficient", "部分动物信息不能可靠规范化，请核对原值。"
    elif resolutions and choices:
        status, reason = "supplement", "已按核对结果列的选择生成合并结果，请核对字段和日期计算依据后确认。"
    elif image_first and differences:
        status, reason = "supplement", "原预约已有留档图片；差异项保留原预约值，文字仅补齐空缺并留档，请核对合并结果。"
    elif image_fields and differences:
        status, reason = (
            "supplement",
            "本次图片补充原文字预约；有明确图片依据的动物信息采用本次图片，文字补齐空缺，请核对合并结果。",
        )
    elif field_changes:
        status, reason = "supplement", "找到对应预约；本次可补充字段或联动日期，请核对合并结果后确认。"
    elif core_same and relation["complete"]:
        status, reason = "registered", "这条预约已登记；可确认后结束本次录入，无需再保存一条。"
    else:
        status, reason = "supplement", "找到对应预约，但仍有缺失信息，请核对后决定是否补充。"
    can_merge = bool(
        known
        and not blocking
        and not uncertain
        and not issues
        and not protected
        and not merge_error
        and (changes or new_material or resolutions and choices)
    )
    if protected and known and not blocking and not issues:
        reason += " 原记录已接收或有接收记录，仅供核对，不能在此补充。"
    digest = json.dumps(
        [2, existing, incoming, matches, image_inputs(images), choices, resolutions], sort_keys=True, ensure_ascii=False
    )
    return {
        "item": existing,
        "matchedFields": fields,
        "classification": classification,
        "reviewStatus": status,
        "comparisons": calculated_comparisons(rows, merged, changes) if can_merge else rows,
        "canAcknowledge": bool(
            known
            and relation["complete"]
            and core_same
            and not differences
            and not issues
            and not field_changes
            and not merge_error
        ),
        "canMerge": can_merge,
        "resolutionFields": resolution_fields,
        "resolutions": choices,
        **(
            {"mergeStrategy": "saved_image_first" if image_first else "incoming_image_first"}
            if can_merge and (image_first or image_fields)
            else {}
        ),
        "reason": reason,
        "mergedItem": merged if can_merge else None,
        "changes": changes,
        "confirmationToken": hashlib.sha256(digest.encode()).hexdigest(),
    }


def preview(conn, actor, body, *, images=None):
    from .recognition_uploads import request_images

    if not actor or not actor.get("id"):
        raise PermissionError("请先登录")
    if not isinstance(body, dict):
        raise ValueError("预约核对请求格式无效")
    incoming = rules.incoming_values(body.get("item"))
    resolutions = read_resolutions(body.get("resolutions"))
    exclude = body.get("excludeId", "")
    if not isinstance(exclude, str) or len(exclude) > 200:
        raise ValueError("排除的预约编号格式无效")
    if images is None:
        images = request_images(body, actor["id"], raw_key="recognitionImages", refs_key="recognitionImageRefs")
    issues = rules.source_issues(incoming, images)
    # Only display excludes the edited record; tokens bind the complete set.
    matches = identifier_matches(conn, incoming)
    qualified = [row["id"] for row in matches if rules.identifier_relation(_identifier_row(row), incoming)["distinct"]]
    unique_id = qualified[0] if len(qualified) == 1 else ""
    # Keep the unique precise candidate visible even when many records share a C number.
    display = [row for row in matches if row["id"] != exclude]
    visible = sorted(display, key=lambda row: row["id"] != unique_id)[:20]
    ids = [row["id"] for row in visible]
    payloads = {
        row["id"]: json.loads(row["payload"])
        for row in conn.execute(
            "SELECT id,payload FROM intake_batches WHERE id IN (SELECT value FROM json_each(?))", (json.dumps(ids),)
        )
    }
    items = []
    for row in visible:
        try:
            items.append(_candidate(payloads[row["id"]], incoming, matches, unique_id, images, issues, resolutions))
        except (ValueError, OverflowError) as exc:
            item = _candidate(payloads[row["id"]], incoming, matches, "", images, issues, resolutions)
            item.update(reviewStatus="conflict", reason=str(exc))
            items.append(item)
    chosen = next((item for item in items if item["item"]["id"] == unique_id), None)
    has_keys = any(rules.identifier_match_keys(incoming).searchable_members.values())
    outcome = (
        chosen["reviewStatus"] if chosen else "related" if display else "unmatched" if has_keys else "insufficient"
    )
    if issues:
        outcome = "conflict"
    return {
        "reviewVersion": 2,
        "outcome": outcome,
        "items": items,
        "total": len(display),
        "sourceIssues": issues,
        "incoming": incoming,
    }


def confirmed_supplement(conn, actor, existing, raw, expected_version, images):
    if not isinstance(raw, dict) or raw.get("reviewVersion") != 2:
        raise ValueError("请先核对预约补充预览")
    require_exact_version((existing or {}).get("updatedAt"), expected_version, "已有预约已更新，请重新核对。")
    result = preview(conn, actor, {"item": raw.get("incoming"), "resolutions": raw.get("resolutions")}, images=images)
    candidate = next((row for row in result["items"] if row["item"]["id"] == (existing or {}).get("id")), None)
    if not candidate or candidate["confirmationToken"] != raw.get("confirmationToken"):
        raise StaleWriteError("预约或匹配结果已变化，请重新核对。")
    if not candidate["canMerge"]:
        raise ValueError(candidate["reason"] or "没有可补充的新内容")
    return candidate["mergedItem"], candidate["changes"], result["incoming"]


def append_round(candidate, incoming, images, metadata, changes, at):
    """Each recognition round owns its image numbering; the old top-level round stays intact."""
    from .recognition_evidence import sanitize_evidence

    evidence = copy.deepcopy(candidate.get("recognition") or sanitize_evidence({}))
    evidence["images"] = metadata
    current = copy.deepcopy(incoming.get("recognition") or sanitize_evidence({}))
    current.pop("recognitionRounds", None)
    ids = [next(meta["id"] for meta in metadata if meta["sha256"] == image["sha256"]) for image in image_inputs(images)]
    current["inputImages"] = image_inputs(images)
    rounds = evidence.get("recognitionRounds", [])
    if len(rounds) >= 20:
        raise ValueError("该预约的补充依据已达20轮，请从原记录核对处理。")
    evidence["recognitionRounds"] = [
        *rounds,
        {
            "at": at,
            "rawMessage": incoming.get("rawMessage", ""),
            "appliedFields": [row["field"] for row in changes],
            "imageIds": ids,
            "evidence": current,
        },
    ]
    candidate["recognition"] = evidence
