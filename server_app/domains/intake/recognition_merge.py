"""Read-only recognition matching and image-first, version-bound supplementation."""

import copy
import hashlib
import json
from datetime import date, timedelta

from server_app.domains.intake.husbandry_period import calendar_month_end, normalize_husbandry_months
from server_app.domains.intake.identifier_matching import identifier_match_keys, purchase_order_is_description
from server_app.domains.intake.recognition_evidence import sanitize_evidence
from server_app.domains.intake.repository import find_duplicate_identifiers, get_batch_payload
from server_app.shared.concurrency import StaleWriteError, require_exact_version
from server_app.shared.intake_identifiers import (
    intake_identifier_values,
    normalize_intake_order_identifiers,
)

TEXT_FIELDS = (
    "purchaseOrderNo",
    "orderNo",
    "batchNo",
    "iacuc",
    "supplier",
    "species",
    "strainRaw",
    "strainStandard",
    "specification",
    "sex",
    "roomName",
    "intakeDate",
    "endDate",
    "project",
    "pi",
    "owner",
    "notes",
)
NUMBER_FIELDS = ("quantity", "husbandryDays", "husbandryMonths", "finalCardCount")


def incoming_values(raw):
    if not isinstance(raw, dict):
        raise ValueError("请提供本次文字识别结果")
    item = {key: str(raw.get(key) or "").strip()[:2000] for key in TEXT_FIELDS}
    item["rawMessage"] = str(raw.get("rawMessage") or "").strip()[:20000]
    if not item["rawMessage"]:
        raise ValueError("请保留本次预约文字后再核对合并")
    for key in NUMBER_FIELDS:
        value = raw.get(key)
        if value is None or value == "":
            item[key] = None
        elif isinstance(value, bool) or not isinstance(value, int) or not 0 <= value <= 1000000:
            raise ValueError("本次文字识别的数量或周期格式无效")
        else:
            item[key] = value
    for key in ("intakeDate", "endDate"):
        if item[key]:
            try:
                if date.fromisoformat(item[key]).isoformat() != item[key]:
                    raise ValueError
            except ValueError as exc:
                raise ValueError("本次文字识别的日期格式无效") from exc
    return normalize_intake_order_identifiers(item)


def identifier_matches(conn, incoming):
    keys = identifier_match_keys(incoming)
    return find_duplicate_identifiers(
        conn, keys.purchase, keys.batch, order_no_key=keys.order, member_keys=keys.searchable_members
    )


def match_classification(existing, incoming):
    old, new = identifier_match_keys(existing), identifier_match_keys(incoming)
    pairs = (
        ("purchaseOrderNo", old.purchase, new.purchase),
        ("orderNo", old.order, new.order),
        ("batchNo", old.batch, new.batch),
    )
    matched = [name for name, a, b in pairs if a and b and set(old.members[name]) & set(new.members[name])]
    conflict = any(a and b and set(old.members[name]) != set(new.members[name]) for name, a, b in pairs)
    kind = (
        "association_conflict"
        if conflict
        else "same_pair"
        if "purchaseOrderNo" in matched and "batchNo" in matched
        else "batch_only"
        if "batchNo" in matched
        else "purchase_only"
        if "purchaseOrderNo" in matched
        else "order_only"
    )
    return kind, matched


def _has_value(value):
    return value is not None and value != "" and value != 0


def _supplement(existing, incoming):
    merged = copy.deepcopy(existing)
    old_evidence = sanitize_evidence(existing.get("recognition") or {})
    sources = old_evidence["fieldSources"]
    filled = []
    saved_period = (
        bool(existing.get("endDate") or existing.get("husbandryMonths")) or existing.get("husbandryDays") is not None
    )
    for field in (*TEXT_FIELDS, *NUMBER_FIELDS):
        if saved_period and field in {"endDate", "husbandryDays", "husbandryMonths"}:
            continue
        value = incoming.get(field)
        if merged.get(field) in (None, "") and _has_value(value):
            # An order description is not a new identifying number for an existing reservation.
            if field == "purchaseOrderNo" and purchase_order_is_description(intake_identifier_values(incoming)[1]):
                continue
            merged[field] = value
            filled.append(field)
            sources[field] = "补充预约文字：" + incoming["rawMessage"][:1800]
    if existing.get("intakePurpose") == "direct_sampling":
        for field in ("roomName", "endDate", "husbandryDays", "husbandryMonths", "finalCardCount"):
            merged[field] = existing.get(field)
            if field in filled:
                filled.remove(field)
                sources.pop(field, None)
    elif merged.get("intakeDate"):
        start = date.fromisoformat(merged["intakeDate"])
        months = normalize_husbandry_months(merged.get("husbandryMonths"))
        if months and not existing.get("endDate"):
            merged["endDate"] = calendar_month_end(merged["intakeDate"], months)
            merged["husbandryMonths"] = months
        elif not merged.get("endDate") and merged.get("husbandryDays") is not None:
            try:
                merged["endDate"] = (start + timedelta(days=merged["husbandryDays"])).isoformat()
            except (ValueError, OverflowError) as exc:
                raise ValueError("补充日期后饲养结束日期超出范围，请先核对周期") from exc
        if merged.get("endDate"):
            days = (date.fromisoformat(merged["endDate"]) - start).days
            if days < 0:
                raise ValueError("文字接收日期晚于已有结束日期，请先核对日期")
            merged["husbandryDays"] = days
            if existing.get("intakeDate") != merged.get("intakeDate"):
                sources["husbandryDays"] = "依据保留的饲养周期/结束日期与文字补充的接收日期计算"
                if existing.get("endDate") != merged.get("endDate"):
                    sources["endDate"] = sources["husbandryDays"]
    original_text = str(existing.get("rawMessage") or "")
    if incoming["rawMessage"] not in original_text:
        merged["rawMessage"] = (
            original_text + ("\n\n补充预约文字：\n" if original_text else "") + incoming["rawMessage"]
        )
    old_evidence["images"] = copy.deepcopy(existing["recognition"]["images"])
    if existing["recognition"].get("imageIds"):
        old_evidence["imageIds"] = copy.deepcopy(existing["recognition"]["imageIds"])
    history = copy.deepcopy(old_evidence.get("textSupplements") or [])
    if incoming["rawMessage"] not in [entry.get("rawMessage") for entry in history]:
        history.append({"rawMessage": incoming["rawMessage"], "appliedFields": filled})
    old_evidence["textSupplements"] = history[-10:]
    merged["recognition"] = old_evidence
    changes = []
    for field in (*TEXT_FIELDS, *NUMBER_FIELDS):
        before, proposed, after = existing.get(field), incoming.get(field), merged.get(field)
        if before != after or (_has_value(proposed) and proposed != before):
            changes.append(
                {
                    "field": field,
                    "before": before,
                    "incoming": proposed,
                    "after": after,
                    "source": "text" if before != after else "image",
                }
            )
    return merged, changes


def _token(existing, incoming, matches):
    data = json.dumps([existing, incoming, matches], ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(data.encode()).hexdigest()


def _candidate(existing, incoming, matches):
    classification, matched = match_classification(existing, incoming)
    reason = ""
    if len(matches) != 1:
        reason = "匹配到多条已有预约，请先核对需求与采购单的对应关系，暂不能合并。"
    elif (
        existing.get("iacuc")
        and incoming.get("iacuc")
        and str(existing["iacuc"]).strip().upper() != str(incoming["iacuc"]).strip().upper()
    ):
        reason = "已有预约与本次识别的IACUC不一致，请分开核对，暂不能自动合并。"
    elif classification == "association_conflict":
        reason = "饲养需求、采购单或订单已对应其他编号，请核对原图和预约文字，暂不能合并。"
    elif not (existing.get("recognition") or {}).get("images"):
        reason = "已有预约未留存图片，请核对后从待接收列表编辑。"
    elif existing.get("status") == "received" or existing.get("receipts"):
        reason = "已有预约已接收，请从接收记录核对处理。"
    merged, changes = (None, [])
    if not reason:
        try:
            merged, changes = _supplement(existing, incoming)
        except ValueError as exc:
            reason = str(exc)
        if merged == existing:
            reason = "本次文字已在预约中留存，没有可合并的新信息。"
    return {
        "item": existing,
        "matchedFields": matched,
        "classification": classification,
        "canMerge": not bool(reason),
        "reason": reason,
        "mergedItem": merged if not reason else None,
        "changes": changes,
        "confirmationToken": _token(existing, incoming, matches),
    }


def recognition_preview(conn, actor, body):
    if not actor or not actor.get("id"):
        raise PermissionError("请先登录")
    if not isinstance(body, dict):
        raise ValueError("预约核对请求格式无效")
    incoming = incoming_values(body.get("item"))
    exclude = body.get("excludeId", "")
    if not isinstance(exclude, str) or len(exclude) > 200:
        raise ValueError("排除的预约编号格式无效")
    matches = identifier_matches(conn, incoming)
    visible = [row for row in matches if row["id"] != exclude]
    items = [_candidate(get_batch_payload(conn, row["id"]), incoming, matches) for row in visible[:20]]
    return {"items": items, "total": len(visible)}


def confirmed_merge(conn, existing, raw, expected_version):
    if not isinstance(raw, dict):
        raise ValueError("请先核对预约合并预览")
    require_exact_version(
        (existing or {}).get("updatedAt"), expected_version, "已有预约已更新，请重新识别并核对合并预览。"
    )
    incoming = incoming_values(raw.get("incoming"))
    matches = identifier_matches(conn, incoming)
    if not existing or existing["id"] not in {row["id"] for row in matches}:
        raise StaleWriteError("已有预约的编号已变化，请重新核对合并预览。")
    candidate = _candidate(existing, incoming, matches)
    if candidate["confirmationToken"] != raw.get("confirmationToken"):
        raise StaleWriteError("已有预约或匹配结果已变化，请重新核对合并预览。")
    if not candidate["canMerge"]:
        raise ValueError(candidate["reason"])
    return candidate["mergedItem"], candidate["changes"]
