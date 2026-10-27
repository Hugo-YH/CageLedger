"""Deterministic current-delivery quantities from quoted purchase facts."""

import re
import unicodedata

_NUMBER_FIELDS = ("lineQuantity", "giftQuantity", "currentDeliveryQuantity", "deferredQuantity")
_TEXT_FIELDS = ("lineQuantityEvidence", "giftEvidence", "currentDeliveryEvidence", "deferredEvidence", "purchaseNotes")


def integer(value):
    text = str(value).strip()
    return int(text) if re.fullmatch(r"\d{1,7}", text) else None


def sanitize_quantity_facts(raw):
    if not isinstance(raw, dict):
        return None
    return {
        **{field: integer(raw.get(field)) for field in _NUMBER_FIELDS},
        **{field: str(raw.get(field) or "")[:2000] for field in _TEXT_FIELDS},
        "giftInclusion": raw.get("giftInclusion")
        if raw.get("giftInclusion") in ("extra", "included", "none")
        else "unknown",
        "giftScope": raw.get("giftScope") if raw.get("giftScope") in ("current_item", "other") else "unknown",
    }


def _quoted_number(evidence, quantity):
    text = unicodedata.normalize("NFKC", str(evidence or "")).replace(",", "")
    return quantity is not None and str(quantity) in re.findall(r"(?<![\d.])\d+(?![\d.])", text)


def _uncertain(text):
    return bool(re.search(r"待确认|待核对|待定|不确定|不明确|未确认|不清|不详|模糊|暂定|预计|可能|大约|约\d", text))


def _table_evidence(text, quantity):
    if not _quoted_number(text, quantity) or _uncertain(text):
        return False
    normalized = unicodedata.normalize("NFKC", text).strip()
    if re.search(r"不是|并非|不为|负|[-−]\s*\d|\d\s*(?:至|到|~)\s*\d", normalized):
        return False
    if re.fullmatch(r"\d+", normalized):
        return True
    matches = re.findall(r"(?:数量|明细|下单)[^\d，,；;。]{0,8}(\d+)", normalized)
    if matches:
        return {int(value) for value in matches} == {quantity}
    return bool(re.fullmatch(r"\s*\d+\s*只\s*", normalized))


def _gift_numbers(text):
    normalized = unicodedata.normalize("NFKC", text)
    numbers = re.findall(r"(?:赠送?|加送|送)\s*(?:数量|动物|雄性|雌性|总共|共|为|的|[:：])?\s*(\d+)", normalized)
    return {int(value) for value in numbers}


def _gift_evidence(text, quantity):
    return _gift_numbers(text) == {quantity}


def _delivery_evidence(text, quantity):
    if not _quoted_number(text, quantity) or _uncertain(text):
        return False
    numbers = re.findall(r"(?:本次|本批|此次|到货|合计|总计|总共|共计)[^\d，,；;。]{0,12}(\d+)", text)
    return bool(numbers) and {int(value) for value in numbers} == {quantity}


def _calculation(base, gift, added, actual, reason):
    return {
        "baseQuantity": base,
        "giftQuantity": gift,
        "addedGiftQuantity": added,
        "actualQuantity": actual,
        "formula": f"{base} + {added} = {actual}" if actual is not None else "",
        "status": "calculated" if actual is not None else "review_required",
        "reason": reason,
    }


def sanitize_calculation(raw):
    """Retain bounded provenance on save; it never overrides the user's reviewed quantity."""
    if not isinstance(raw, dict):
        return None
    return {
        "baseQuantity": integer(raw.get("baseQuantity")),
        "giftQuantity": integer(raw.get("giftQuantity")),
        "addedGiftQuantity": integer(raw.get("addedGiftQuantity")) or 0,
        "actualQuantity": integer(raw.get("actualQuantity")),
        "formula": str(raw.get("formula") or "")[:200],
        "status": "calculated" if raw.get("status") == "calculated" else "review_required",
        "reason": str(raw.get("reason") or "")[:1000],
    }


def calculate_purchase_quantity(source):
    facts = source.get("quantityFacts")
    if facts is None:
        # Compatibility for already recognized sources before structured quantity facts existed.
        base = integer(source.get("quantity"))
        if re.search(r"赠|买.+送", source.get("specification", "")):
            return _calculation(base, None, 0, None, "原规格提到赠送但未返回独立数量事实，请核对，避免漏计或重复计算。")
        return _calculation(base, None, 0, base if base else None, "采用采购明细数量；未提供独立赠送事实。")
    base, gift = facts["lineQuantity"], facts["giftQuantity"]

    def review(reason):
        return _calculation(base, gift, 0, None, reason)

    if not _table_evidence(facts["lineQuantityEvidence"], base):
        return review("采购明细数量缺少可核对的数量列原文，请核对。")
    if source.get("quantity") is not None and source["quantity"] != base:
        return review("采购明细数量与逐图数量不一致，请核对数量列。")
    inclusion, scope = facts["giftInclusion"], facts["giftScope"]
    quote = facts["giftEvidence"]
    gift_mentioned = bool(re.search(r"赠|买.+送", quote + source.get("specification", "") + facts["purchaseNotes"]))
    added = 0
    if gift is not None and gift > 0:
        if not _gift_evidence(quote, gift) or _uncertain(quote):
            return review("赠送数量缺少可核对的赠送原文，请核对。")
        if re.search(r"不[再额外另]*赠|无赠|未赠|取消|可能|预计|视情况|如(?:果|满)|买满|可赠", quote):
            return review("赠送原文含否定、条件或预计措辞，尚不能确认本次额外数量，请核对。")
        if inclusion == "included":
            if gift > base:
                return review("已包含的赠送数量超过采购明细总数，请核对。")
            if re.search(r"不含|未含|不包含|未包含|不包括|未包括|未计入|不计入", quote) or not re.search(
                r"含|其中|计入|计在|包括", quote
            ):
                return review("无法确认赠送是否已包含在采购明细数量中，请核对，避免重复计算。")
        elif scope == "other":
            if not re.search(r"下次|后续|下批|其他|另批|另一个|另件|下一", quote):
                return review("无法确认赠送是否属于其他批次或商品，请核对。")
        elif inclusion == "extra" and scope == "current_item":
            raw_spec = source.get("specification", "")
            if (_gift_numbers(raw_spec) - {gift}) or re.search(r"(?<!不)含[^，,；;。]{0,8}赠", raw_spec):
                return review("原规格与额外赠送事实的数量或包含关系不一致，请核对。")
            if re.search(r"已含|包含|其中|内含|含赠|下次|后续|下批|其他|另批|下一", quote):
                return review("赠送的包含关系或本次到货范围存在矛盾，请核对，避免重复计算。")
            if not re.search(r"额外|另[外赠送]|加赠|多赠|买\s*\d+\s*(?:只)?\s*送", quote):
                return review("赠送未明确为采购明细之外的额外赠送，请核对，避免重复计算。")
            added = gift
        else:
            return review("赠送是否额外、是否属于本次商品尚不明确，请核对，避免重复计算。")
    elif gift_mentioned or inclusion not in ("none", "unknown"):
        return review("图片提到了赠送但缺少明确的赠送数量或包含关系，请核对。")
    actual = base + added
    if actual <= 0 or actual > 9999999:
        return review("本批实际动物数量无效，请核对。")
    current = facts["currentDeliveryQuantity"]
    if current is not None:
        if not _delivery_evidence(facts["currentDeliveryEvidence"], current):
            return review("本次到货备注数量缺少原文依据，请核对。")
        if current != actual:
            return review(f"采购明细与赠送计算为{actual}只，但本次到货备注为{current}只，请核对。")
    reason = "采购明细数量加明确的本次额外赠送；备注本次数量仅用于校验，后续数量不计入。"
    if inclusion == "included":
        reason = "赠送已包含在采购明细数量中，不重复增加。"
    elif scope == "other" and gift:
        reason = "赠送属于其他批次或商品，不计入本次数量。"
    return _calculation(base, gift, added, actual, reason)


def merge_purchase_quantities(purchases, evidence):
    """Repeated screenshots of the same item never add the gift more than once."""
    calculations = [calculate_purchase_quantity(source) for source in purchases]
    if not calculations:
        return None
    # A second screenshot may repeat a table without its explanatory notes. Prefer facts,
    # but require all table bases and every complete calculation to agree.
    detailed = [calc for source, calc in zip(purchases, calculations, strict=False) if "quantityFacts" in source]
    chosen = (detailed or calculations)[0]
    bases = {calc["baseQuantity"] for calc in calculations if calc["baseQuantity"] is not None}
    totals = {calc["actualQuantity"] for calc in (detailed or calculations)}
    additions = {calc["addedGiftQuantity"] for calc in (detailed or calculations)}
    if len(bases) > 1 or len(totals) > 1 or len(additions) > 1:
        chosen = _calculation(None, None, 0, None, "同类采购图片的明细或赠送信息不一致，请核对，不合并累加。")
    evidence["quantityCalculation"] = chosen
    if chosen["status"] == "review_required":
        evidence["warnings"].append(chosen["reason"])
    return chosen
