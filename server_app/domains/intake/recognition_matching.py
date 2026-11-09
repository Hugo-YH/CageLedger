"""Deterministic comparisons: missing facts never establish a duplicate."""

import re
import unicodedata

from .identifier_matching import identifier_match_keys
from .recognition_merge import NUMBER_FIELDS, TEXT_FIELDS
from .recognition_sex import confirmed_sex, placeholder, sex_source_issues
from .recognition_specification import normalize_specification
from .strain_standard import standardize_strain

IDENTIFIERS = ("purchaseOrderNo", "orderNo", "batchNo")
CORE = ("iacuc", "quantity", "strainStandard", "specification")
OPTIONAL = ("intakePurpose", "species", "sex", "intakeDate", "roomName", "endDate", "husbandryMonths", "husbandryDays")
EMPTY = {"", "-", "--", "未知", "未填", "不详", "n/a", "null"}


def missing(value):
    return value is None or isinstance(value, str) and value.strip().casefold() in EMPTY


def value(item, field):
    return item.get("strainStandard") or item.get("strainRaw", "") if field == "strainStandard" else item.get(field)


def key(field, raw):
    if missing(raw):
        return None
    if field == "quantity":
        return raw if type(raw) is int and raw > 0 else None
    if field == "specification":
        normalized, uncertain = normalize_specification(raw)
        return normalized if not uncertain else None
    if field == "strainStandard":
        standard = standardize_strain(str(raw))
        return standard.casefold() if standard else None
    if field == "iacuc":
        return str(raw).strip().upper()
    return raw.strip() if isinstance(raw, str) else raw


def identifier_relation(existing, incoming):
    old, new = identifier_match_keys(existing), identifier_match_keys(incoming)
    conflicts = [
        field
        for field in IDENTIFIERS
        if old.searchable_members[field]
        and new.searchable_members[field]
        and set(old.searchable_members[field]) != set(new.searchable_members[field])
    ]
    shared = [field for field in IDENTIFIERS if set(old.searchable_members[field]) & set(new.searchable_members[field])]
    # A shared C number can describe several distinct full DC orders/deliveries.
    distinct = any(field in shared for field in ("orderNo", "batchNo"))
    complete = all(set(old.searchable_members[field]) == set(new.searchable_members[field]) for field in IDENTIFIERS)
    return {"conflicts": conflicts, "shared": shared, "distinct": distinct and not conflicts, "complete": complete}


def comparisons(existing, incoming):
    relation = identifier_relation(existing, incoming)
    result = []
    for field in (*IDENTIFIERS, *CORE, *OPTIONAL):
        before, proposed = value(existing, field), value(incoming, field)
        a, b = key(field, before), key(field, proposed)
        if field == "sex":
            a, b = confirmed_sex(existing), confirmed_sex(incoming)
            unknown_before = a is None and not missing(before) and not placeholder(existing)
            unknown_incoming = b is None and not missing(proposed) and not placeholder(incoming)
            status = (
                "unknown"
                if unknown_before or unknown_incoming
                else "missing"
                if b is None
                else "supplement"
                if a is None
                else "same"
                if a == b
                else "different"
            )
        elif field in IDENTIFIERS:
            a = identifier_match_keys(existing).searchable_members[field]
            b = identifier_match_keys(incoming).searchable_members[field]
            status = (
                "different"
                if field in relation["conflicts"]
                else "same"
                if a and b
                else "supplement"
                if b
                else "missing"
            )
        elif missing(before):
            status = "supplement" if not missing(proposed) and b is not None else "missing"
        elif missing(proposed):
            status = "missing"
        elif a is None or b is None:
            status = "unknown"
        else:
            status = "same" if a == b else "different"
        row = {"field": field, "before": before, "incoming": proposed, "status": status}
        if field == "sex" and (placeholder(existing) or placeholder(incoming)):
            row["placeholder"] = {"before": placeholder(existing), "incoming": placeholder(incoming)}
        result.append(row)
    return result


def incoming_values(raw):
    """Bound fields without requiring text or accepting saved image references."""
    from .recognition_evidence import sanitize_evidence
    from .recognition_merge import incoming_values as legacy_values

    if not isinstance(raw, dict):
        raise ValueError("请提供本次预约核对内容")
    # Reuse the established number/date/identifier validator; its text guard is v1 only.
    item = legacy_values({**raw, "rawMessage": raw.get("rawMessage") or "预约图文核对"})
    item["rawMessage"] = str(raw.get("rawMessage") or "").strip()[:20000]
    item["intakePurpose"] = str(raw.get("intakePurpose") or "housing")
    if item["intakePurpose"] not in ("housing", "direct_sampling"):
        raise ValueError("接收用途无效")
    evidence = sanitize_evidence(raw.get("recognition"))
    if evidence:
        evidence.pop("recognitionRounds", None)
        evidence.pop("textSupplements", None)
        item["recognition"] = evidence
    return item


def text_facts(raw):
    """Only explicit labelled facts: never infer totals, date or supplier defaults."""
    from server_app.shared.intake_identifiers import batch_identifiers_in_text, normalize_intake_order_identifiers

    result = {"batchNo": "、".join(batch_identifiers_in_text(raw))}
    text = unicodedata.normalize("NFKC", raw)
    result["purchaseOrderNo"] = "、".join(dict.fromkeys(re.findall(r"(?<![A-Z0-9])C\d{13}(?!\d)", text, re.I)))
    result["orderNo"] = "、".join(dict.fromkeys(re.findall(r"(?<![A-Z0-9])DC\d{15}(?!\d)", text, re.I)))
    for field, labels in (("strainRaw", "品系|商品名称"), ("specification", "规格|体重/日龄|体重|日龄")):
        match = re.search(rf"(?:^|[\n;；，])\s*(?:{labels})\s*[:：]\s*([^\n;；，]+)", text)
        if match:
            result[field] = re.split(r"\s+(?:数量|规格|性别|房间)\s*[:：]", match[1])[0].strip()
    quantities = re.findall(
        r"(?:^|[\n;；，])\s*(?:本次动物数量|本次数量|动物数量|数量)\s*[:：]?\s*(\d+)\s*只?\s*(?=$|[\n;；，])", text
    )
    if len(set(quantities)) == 1:
        result["quantity"] = int(quantities[0])
    return normalize_intake_order_identifiers(result)


def source_issues(incoming, images):
    """Recompute source comparisons; don't use Chinese warning text as a protocol."""
    import hashlib

    from .recognition_pipeline import prepare_image_sources
    from .recognition_quantity import calculate_purchase_quantity

    evidence = incoming.get("recognition") or {}
    issues = []
    actual = [hashlib.sha256(image.body).hexdigest() for image in images]
    inputs = [entry["sha256"] for entry in evidence.get("inputImages", [])]
    if actual and actual != inputs:
        issues.append(
            {"field": "recognition", "message": "所选图片未全部参与本轮识别，请AI识别或移除未识别图片后核对。"}
        )
    reference = incoming
    labels = {
        "iacuc": "IACUC",
        "quantity": "动物数量",
        "strainStandard": "标准品系",
        "specification": "规格",
        "purchaseOrderNo": "采购单号",
        "orderNo": "订单编号",
        "batchNo": "饲养需求编号",
    }
    if evidence.get("sources"):
        try:
            context = prepare_image_sources(incoming)
            review = context.review.build(context.evidence, context.sources)
            issues.extend(
                {"field": row["key"], "message": f"本轮饲养需求与采购信息的{row['label']}存在差异，请核对原图。"}
                for row in review["comparisons"]
            )
            calculation = context.evidence.get("quantityCalculation") or {}
            if calculation.get("status") == "review_required":
                issues.append({"field": "quantity", "message": calculation["reason"]})
            reference = context.payload
            for kind in {row["kind"] for row in context.sources}:
                same_kind = [row for row in context.sources if row["kind"] == kind]
                for field in CORE:
                    values = []
                    for source in same_kind:
                        raw = value(source, field)
                        if field == "strainStandard":
                            raw = raw or source.get("productName")
                        if field == "quantity" and kind == "purchase":
                            raw = calculate_purchase_quantity(source).get("actualQuantity")
                        if not missing(raw):
                            values.append(key(field, raw))
                    if None in values or len(set(values)) > 1:
                        issues.append(
                            {
                                "field": field,
                                "message": f"本轮同类图片的{labels[field]}不一致或无法可靠规范化，请逐图核对。",
                            }
                        )
        except ValueError as exc:
            issues.append({"field": "identifiers", "message": str(exc)})
    try:
        facts = text_facts(incoming.get("rawMessage", ""))
        # Explicit text must agree even when an older AI returned no sources.
        for reference_item in (incoming, reference):
            for row in comparisons(reference_item, facts):
                if row["field"] in (*IDENTIFIERS, *CORE) and (
                    row["status"] == "different" or row["status"] == "unknown" and not missing(row["incoming"])
                ):
                    issues.append(
                        {
                            "field": row["field"],
                            "message": f"本次预约文字与图片或回填内容的{labels[row['field']]}不一致或无法确认，请核对双方原文。",
                        }
                    )
    except ValueError as exc:
        issues.append({"field": "identifiers", "message": str(exc)})
    issues.extend(sex_source_issues(incoming))
    return list({(row["field"], row["message"]): row for row in issues}.values())


def supplement(existing, incoming, image_fields=frozenset(), resolutions=None, explicit_resolutions=None):
    """Fill gaps or apply bound images; preserve identity, cards, status and sources."""
    import copy

    from .recognition_period import PERIOD_FIELDS, supplement_period

    resolutions = resolutions or {}
    image_fields = (set(image_fields) - resolutions.keys()) | {
        field for field, choice in resolutions.items() if choice == "incoming"
    }
    if "strainStandard" in resolutions:
        if resolutions["strainStandard"] == "incoming":
            image_fields.add("strainRaw")
        else:
            image_fields.discard("strainRaw")
    merged = copy.deepcopy(existing)
    period_saved = (
        bool(existing.get("endDate") or existing.get("husbandryMonths")) or existing.get("husbandryDays") is not None
    )
    excluded = set()
    if existing.get("intakePurpose") == "direct_sampling":
        excluded.update(("roomName", "endDate", "husbandryMonths", "husbandryDays", "finalCardCount"))
    if period_saved and not image_fields.intersection(PERIOD_FIELDS):
        excluded.update(("endDate", "husbandryMonths", "husbandryDays"))
    for field in (*TEXT_FIELDS, *NUMBER_FIELDS):
        if field == "sex":
            if confirmed_sex(incoming) and (
                missing(existing.get(field)) or placeholder(existing) or field in image_fields
            ):
                merged[field] = incoming[field]
        elif (
            field not in excluded
            and (missing(merged.get(field)) or field in image_fields)
            and not missing(incoming.get(field))
        ):
            merged[field] = incoming[field]
    calculation = supplement_period(existing, incoming, merged, image_fields, explicit_resolutions)
    raw = incoming.get("rawMessage", "")
    if raw and raw not in (existing.get("rawMessage") or ""):
        merged["rawMessage"] = (existing.get("rawMessage") or "") + "\n\n补充预约内容：\n" + raw
    changes = [
        {
            "field": field,
            "before": existing.get(field),
            "incoming": incoming.get(field),
            "after": merged.get(field),
            "source": "image"
            if field != "rawMessage" and (incoming.get("recognition") or {}).get("inputImages")
            else "text",
            **({"calculation": calculation} if calculation and field in ("intakeDate", *PERIOD_FIELDS) else {}),
        }
        for field in (*TEXT_FIELDS, *NUMBER_FIELDS, "rawMessage")
        if existing.get(field) != merged.get(field)
    ]
    return merged, changes
