"""Structured fields from husbandry requests and purchase documents."""

import re

from server_app.domains.intake.husbandry_period import husbandry_month_values, parse_husbandry_months
from server_app.domains.intake.recognition_quantity import merge_purchase_quantities, sanitize_quantity_facts
from server_app.domains.intake.recognition_specification import is_missing_specification, normalize_specification
from server_app.domains.intake.strain_standard import standardize_strain
from server_app.shared.intake_identifiers import intake_identifier_key

NUMBER_FIELDS = frozenset(
    (
        "approvedQuantity",
        "remainingQuantity",
        "quantity",
        "maleQuantity",
        "femaleQuantity",
        "husbandryDays",
        "finalCardCount",
    )
)
TEXT_FIELDS = frozenset(
    (
        "iacuc",
        "batchNo",
        "project",
        "reviewNotes",
        "husbandryPeriodRaw",
        "roomName",
        "purchaseOrderNo",
        "productName",
        "specification",
        "supplier",
        "strainRaw",
        "sex",
        "intakeDate",
        "endDate",
    )
)
LABELS = {
    "batchNo": "批次号",
    "iacuc": "伦理号",
    "purchaseOrderNo": "采购单号",
    "supplier": "供应商",
    "strainRaw": "品系",
    "productName": "商品名称",
    "husbandryDays": "饲养周期",
    "husbandryMonths": "饲养周期（月）",
    "roomName": "饲养间",
    "finalCardCount": "笼数",
    "quantity": "本批数量",
    "maleQuantity": "雄性数量",
    "femaleQuantity": "雌性数量",
    "intakePurpose": "接收用途",
    "reviewNotes": "审核备注",
}


def integer(value):
    text = str(value).strip()
    return int(text) if re.fullmatch(r"\d{1,7}", text) else None


def image_batch_number(value):
    """Remove screenshot layout spaces only for the known ethics/serial format."""
    text = str(value or "").strip()
    match = re.fullmatch(r"[（(]\s*([A-Za-z]{1,6}\d{4,})\s*[）)]\s*(\d{6,})", text)
    return f"（{match[1].upper()}）{match[2]}" if match else text


def strain_key(value):
    text = str(value or "").strip()
    shortened = re.sub(r"(?:小鼠|大鼠|mouse|mice|rat)$", "", text, flags=re.IGNORECASE).strip()
    return (standardize_strain(text) or standardize_strain(shortened) or shortened).casefold()


def specification_key(value):
    return normalize_specification(value)[0]


def sanitize_sources(raw):
    if not isinstance(raw, list):
        return []
    result = []
    for index, source in enumerate(raw[:4]):
        if not isinstance(source, dict):
            continue
        number = integer(source.get("imageIndex"))
        item = {
            "imageIndex": number if number and number <= 4 else index + 1,
            "kind": source.get("kind") if source.get("kind") in ("husbandry", "purchase") else "unknown",
        }
        item.update(
            {key: value[:2000] for key, value in source.items() if key in TEXT_FIELDS and isinstance(value, str)}
        )
        if item["kind"] == "husbandry":
            # Only the original review text can establish a calendar-month period.
            notes = item.get("reviewNotes", "")
            months = parse_husbandry_months(notes)
            if months is not None:
                item["husbandryMonths"] = months
                item["husbandryPeriodRaw"] = notes
            else:
                item.pop("husbandryPeriodRaw", None)
        else:
            item.pop("husbandryPeriodRaw", None)
        if item.get("batchNo"):
            item["batchNo"] = image_batch_number(item["batchNo"])
        item.update({key: integer(value) for key, value in source.items() if key in NUMBER_FIELDS})
        if source.get("intakePurpose") in ("housing", "direct_sampling"):
            item["intakePurpose"] = source["intakePurpose"]
        if source.get("age") and not item.get("specification"):
            item["specification"] = str(source["age"])[:500]
        facts = sanitize_quantity_facts(source.get("quantityFacts"))
        if facts is not None:
            item["quantityFacts"] = facts
        result.append(item)
    return result


def merge_sources(payload, evidence, sources):
    result = dict(payload)
    result.pop("husbandryMonths", None)
    evidence["sources"] = sources
    notices = evidence["warnings"]
    conflicts = set()
    purchase_conflicts = set()
    husbandry = [source for source in sources if source["kind"] == "husbandry"]
    purchases = [source for source in sources if source["kind"] == "purchase"]

    def one(rows, field):
        values = {}
        for row in rows:
            value = row.get(field)
            if value in (None, "") or (field == "specification" and is_missing_specification(value)):
                continue
            key = (
                intake_identifier_key(value, batch=field == "batchNo")
                if field in ("batchNo", "iacuc", "purchaseOrderNo")
                else specification_key(value)
                if field == "specification"
                else value
            )
            values.setdefault(key, value)
        if len(values) > 1:
            conflicts.add(field)
            if rows and rows[0]["kind"] == "purchase":
                purchase_conflicts.add(field)
            notices.append(f"同类图片中的{LABELS.get(field, field)}信息不一致，请核对原图。")
            return None
        return next(iter(values.values()), None)

    for field in ("batchNo", "iacuc"):
        value = one(sources, field)
        if value is not None:
            result[field] = value
    for field in ("purchaseOrderNo", "supplier", "strainRaw"):
        value = one(purchases, field)
        if field in conflicts:
            result[field] = ""
            if field == "strainRaw":
                result["strainStandard"] = ""
        elif value is not None:
            result[field] = value
    purchase_strain = one(purchases, "strainRaw") or one(purchases, "productName")
    husbandry_strain = one(husbandry, "strainRaw")
    if purchase_strain and "strainRaw" not in purchase_conflicts and "productName" not in purchase_conflicts:
        result["strainRaw"] = purchase_strain
        result["strainStandard"] = standardize_strain(purchase_strain) or purchase_strain
        evidence["fieldSources"]["strainRaw"] = f"采用采购信息的动物品系/商品名称：{purchase_strain}"
        if husbandry_strain and strain_key(husbandry_strain) != strain_key(purchase_strain):
            notices.append(
                f"动物品系差异：饲养需求为“{husbandry_strain}”，采购信息为“{purchase_strain}”，已采用采购信息。"
            )
    elif husbandry_strain and not purchases:
        result["strainRaw"] = husbandry_strain
    purchase_spec, husbandry_spec = one(purchases, "specification"), one(husbandry, "specification")
    if "specification" in purchase_conflicts or ("specification" in conflicts and purchase_spec is None):
        result["specification"] = ""
    elif purchase_spec is not None or husbandry_spec is not None:
        selected_spec = purchase_spec if purchase_spec is not None else husbandry_spec
        result["specification"], needs_review = normalize_specification(selected_spec)
        origin = "采购信息" if purchase_spec is not None else "饲养需求"
        evidence["fieldSources"]["specification"] = (
            f"{origin}原规格：{selected_spec}；规范规格：{result['specification'] or '待核对'}"
        )
        if needs_review:
            notices.append("原规格中未找到唯一明确的动物年龄/体重，请核对；等级、赠送和饲养周期不填入规格。")
        if (
            specification_key(purchase_spec)
            and specification_key(husbandry_spec)
            and specification_key(purchase_spec) != specification_key(husbandry_spec)
        ):
            notices.append(
                f"体重/日龄（规格）差异：饲养需求为“{husbandry_spec}”，采购信息为“{purchase_spec}”，已采用采购信息。"
            )
    if husbandry:
        month_values = set().union(*(husbandry_month_values(row.get("reviewNotes")) for row in husbandry))
        other_periods = any(
            re.search(
                r"(?:饲养(?:周期|时间|期限)?|周期)\s*(?:为|是|共|:|：)?\s*\d+\s*(?:天|日|周|星期)",
                row.get("reviewNotes", ""),
            )
            for row in husbandry
        )
        period_conflict = len(month_values) > 1 or bool(month_values and other_periods)
        if period_conflict:
            conflicts.add("husbandryMonths")
            notices.append("饲养周期原文存在不同月数或月与天/周的冲突，请人工核对，不自动换算。")
        months = one(husbandry, "husbandryMonths")
        if months is not None and not period_conflict:
            result["husbandryMonths"] = months
            evidence["fieldSources"]["husbandryMonths"] = "饲养需求审核备注：" + next(
                row["reviewNotes"] for row in husbandry if row.get("husbandryMonths") == months
            )
        elif "husbandryMonths" in conflicts:
            result["husbandryDays"] = None
            result["endDate"] = ""
        for field in ("husbandryDays", "roomName", "intakePurpose", "finalCardCount", "maleQuantity", "femaleQuantity"):
            value = one(husbandry, field)
            if field in conflicts:
                result[field] = {"roomName": "", "intakePurpose": "housing", "finalCardCount": 0}.get(field)
                if field == "husbandryDays":
                    result["endDate"] = ""
            elif value is not None:
                result[field] = value
        if "husbandryMonths" in conflicts:
            result.pop("husbandryMonths", None)
            evidence["fieldSources"].pop("husbandryMonths", None)
            result["husbandryDays"] = None
            result["endDate"] = ""
        count = one(husbandry, "finalCardCount")
        if count:
            notes = one(husbandry, "reviewNotes")
            if notes:
                evidence["fieldSources"]["finalCardCount"] = "饲养需求审核备注：" + notes
            elif not evidence["fieldSources"].get("finalCardCount"):
                result["finalCardCount"] = 0
                notices.append("饲养需求中的笼数缺少可核对的原文依据，请对照原图确认最终笼卡张数。")
        male, female = result.get("maleQuantity"), result.get("femaleQuantity")
        if conflicts.intersection(("maleQuantity", "femaleQuantity")):
            result["sex"] = "雌性/雄性"
        elif isinstance(male, int) and isinstance(female, int) and male + female > 0:
            result["sex"] = "雌性" if male == 0 else "雄性" if female == 0 else "雌性/雄性"
    husbandry_quantity = one(husbandry, "quantity")
    calculation = merge_purchase_quantities(purchases, evidence)
    if calculation is not None:
        result["quantity"] = calculation["actualQuantity"]
        evidence["fieldSources"]["quantity"] = (
            f"采购明细与赠送：{calculation['formula'] or '待核对'}；{calculation['reason']}"
        )
        if (
            result["quantity"] is not None
            and husbandry_quantity is not None
            and husbandry_quantity != result["quantity"]
        ):
            notices.append(
                f"本批数量差异：饲养需求为{husbandry_quantity}只，本次采购实际数量为{result['quantity']}只，已按采购信息回填；需求可能包含后续批次，请核对笼数及性别适用范围。"
            )
    elif "quantity" in conflicts:
        result["quantity"] = None
    elif husbandry_quantity is not None:
        result["quantity"] = husbandry_quantity
    result["recognition"] = evidence
    result["imageSources"] = sources
    return result
