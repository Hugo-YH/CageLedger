"""Bounded recognition provenance and deterministic multi-image consistency checks."""

import re

from server_app.domains.intake.recognition_quantity import sanitize_calculation
from server_app.domains.intake.recognition_sources import merge_sources, sanitize_sources
from server_app.domains.intake.recognition_specification import normalize_specification
from server_app.shared.intake_identifiers import intake_identifier_values

FIELDS = frozenset(
    (
        "purchaseOrderNo",
        "batchNo",
        "iacuc",
        "supplier",
        "strainRaw",
        "strainStandard",
        "species",
        "sex",
        "quantity",
        "roomName",
        "intakePurpose",
        "intakeDate",
        "endDate",
        "husbandryDays",
        "husbandryMonths",
        "finalCardCount",
        "age",
        "specification",
    )
)


def sanitize_evidence(raw):
    if raw is None:
        return None
    if not isinstance(raw, dict):
        raise ValueError("预约识别依据格式无效")
    sources = raw.get("fieldSources")
    sources = sources if isinstance(sources, dict) else {}
    notices = raw.get("warnings")
    notices = notices if isinstance(notices, list) else []
    result = {
        "extractedText": str(raw.get("extractedText") or "")[:20000],
        "warnings": list(
            dict.fromkeys(item.strip()[:1000] for item in notices if isinstance(item, str) and item.strip())
        )[:20],
        "fieldSources": {
            key: value[:2000] for key, value in sources.items() if key in FIELDS and isinstance(value, str)
        },
        "model": str(raw.get("model") or "")[:128],
    }
    if raw.get("sources"):
        result["sources"] = sanitize_sources(raw["sources"])
    calculation = sanitize_calculation(raw.get("quantityCalculation"))
    if calculation is not None:
        result["quantityCalculation"] = calculation
    inputs = raw.get("inputImages")
    if isinstance(inputs, list):
        result["inputImages"] = [
            {"name": item["name"][:160], "sha256": item["sha256"]}
            for item in inputs[:4]
            if isinstance(item, dict)
            and isinstance(item.get("name"), str)
            and re.fullmatch(r"[a-f0-9]{64}", str(item.get("sha256") or ""))
        ]
    return result


def structure_image_sources(payload):
    evidence = sanitize_evidence(payload.get("recognition") or {})
    sources = sanitize_sources(payload.get("imageSources") or evidence.get("sources"))
    _check_image_identifiers(sources)
    return merge_sources(payload, evidence, sources)


def _positive_integer(raw):
    value = str(raw).strip()
    return int(value) if re.fullmatch(r"[1-9]\d{0,6}", value) else None


def _nonnegative_integer(raw):
    value = str(raw).strip()
    return int(value) if re.fullmatch(r"\d{1,7}", value) else None


def has_explicit_intake_date(evidence):
    date_source = evidence.get("fieldSources", {}).get("intakeDate", "")
    return bool(re.search(r"接收|到货|收货|进驻|入驻", date_source)) and not (
        "申请日期" in date_source and not re.search(r"(?:接收|到货|进驻|入驻)日期\s*[:：]", date_source)
    )


def normalize_image_result(payload, item, model):
    evidence = sanitize_evidence(payload.get("recognition") or {})
    evidence["model"] = model
    notices = evidence["warnings"]
    sources = evidence["fieldSources"]
    image_sources = payload.get("imageSources")
    image_sources = image_sources if isinstance(image_sources, list) else []
    _check_image_identifiers(image_sources)
    if not image_sources:
        notices.append("未返回逐图编号核对信息，请对照原图确认采购单号、批次号和本次申请数量。")
    explicit_date = has_explicit_intake_date(evidence)
    if not explicit_date or not item.get("intakeDate"):
        item["intakeDate"] = ""
        if item.get("husbandryMonths"):
            item["husbandryDays"] = None
        # An end date calculated from an application date is not valid evidence either.
        if not sources.get("endDate"):
            item["endDate"] = ""
        notices.append("图片中未提供明确的接收/进驻日期，请手动补充；采购申请日期不能代替接收日期。")
    male = _nonnegative_integer(payload.get("maleQuantity"))
    female = _nonnegative_integer(payload.get("femaleQuantity"))
    if (
        male is not None
        and female is not None
        and male + female > 0
        and item.get("quantity") is not None
        and item.get("quantity") != male + female
    ):
        purchase_quantities = {
            source.get("quantity")
            for source in image_sources
            if source.get("kind") == "purchase" and source.get("quantity") is not None
        }
        calculation = evidence.get("quantityCalculation")
        if calculation is not None:
            # Husbandry's sex totals may describe the full application, not this partial delivery.
            notices.append(
                "饲养需求的雌雄分配属于申请范围；本次采购数量已独立计算，请核对本次性别及笼数，不按申请总量改写本次数量。"
            )
        elif len(purchase_quantities) == 1 and item["quantity"] in purchase_quantities:
            notices.append(
                f"饲养需求雌雄数量合计{male + female}只，与采购数量{item['quantity']}只不一致；数量已采用采购信息，请核对性别分配。"
            )
        else:
            item["quantity"] = None
            notices.append("本次申请总数与雌雄数量之和不一致，请对照原图填写实际动物数量。")
    count = _positive_integer(payload.get("finalCardCount"))
    count_source = sources.get("finalCardCount", "") or evidence["extractedText"]
    if count and any(int(value) == count for value in re.findall(r"(\d+)\s*(?:笼|张笼卡)", count_source)):
        if item.get("intakePurpose") != "direct_sampling":
            item["finalCardCount"] = count
    elif payload.get("finalCardCount") == 0 and item.get("intakePurpose") != "direct_sampling":
        # Conflicting explicit cage counts must not become a new default count.
        item["finalCardCount"] = 0
    elif payload.get("finalCardCount") not in (None, ""):
        notices.append("笼数缺少明确原文依据，请核对最终笼卡张数。")
    ages = {
        normalize_specification(source.get("specification") or source.get("age"))[0]
        for source in image_sources
        if isinstance(source, dict) and (source.get("specification") or source.get("age"))
    } - {""}
    if "specification" in payload:
        item["specification"] = normalize_specification(payload.get("specification"))[0]
    if len(ages) > 1 and not any(
        "规格" in text and ("差异" in text or "冲突" in text or "不一致" in text) for text in notices
    ):
        notices.append("不同图片中的规格/日龄不一致，请核对原图。")
    evidence["warnings"] = list(dict.fromkeys(notices))[:20]
    return item, evidence


def _check_image_identifiers(sources):
    identifiers = {"purchaseOrderNo": set(), "batchNo": set(), "iacuc": set()}
    for source in sources[:4]:
        if not isinstance(source, dict):
            continue
        _, purchase, batch = intake_identifier_values(source)
        for field, value in (
            ("purchaseOrderNo", purchase),
            ("batchNo", batch),
            ("iacuc", str(source.get("iacuc") or "").strip().upper()),
        ):
            if value:
                identifiers[field].add(value)
    if any(len(values) > 1 for values in identifiers.values()):
        raise ValueError("图片中的采购单号、批次号或伦理号不一致，请拆分不同预约后重新识别。")
