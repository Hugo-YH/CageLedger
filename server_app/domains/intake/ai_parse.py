"""DeepSeek-powered intake message recognition.

The browser sends the raw reservation text; this module asks DeepSeek to
extract and normalize the same fields the local parser understands, so the
frontend can keep the identical review-and-save flow afterwards.
"""

import re
from datetime import date, timedelta
from typing import Any

from server_app.domains.intake.strain_standard import abbreviate_supplier, standardize_strain
from server_app.services.ai import deepseek_chat_json
from server_app.shared import clean_text

SYSTEM_RULES = """你是实验动物接收预约消息解析器。请从用户粘贴的预约接收文本中提取以下字段，并输出严格的 JSON 对象（不要输出 JSON 外的任何内容）：
{
  "purchaseOrderNo": "采购单号，如 锐竞采购单号：C2026043035083",
  "batchNo": "饲养需求批次号，如 （Z2025050）2026042903",
  "iacuc": "IACUC 编号，通常从批次号括号内提取，如 Z2025050",
  "supplier": "供应商/购买单位",
  "strainRaw": "品系原文",
  "strainStandard": "品系标准名称，如 C57BL/6、BALB/c、ICR",
  "species": "物种，映射为 monkey/rabbit/pig/dog/guinea_pig/rat/mouse",
  "sex": "性别，仅雌性、雄性或雌性/雄性",
  "quantity": "数量，整数",
  "roomName": "饲养房间号，如 8101",
  "intakePurpose": "接收用途，仅 housing 或 direct_sampling",
  "intakeDate": "接收/进驻日期，统一为 YYYY-MM-DD",
  "endDate": "结束日期，统一为 YYYY-MM-DD",
  "husbandryDays": "饲养周期（天），整数"
}

规则：
- 字段值缺失时输出 null 或空字符串，不要编造
- sex 只输出“雌性”“雄性”“雌性/雄性”：母/雌/female/F/♀归为雌性，公/雄/male/M/♂归为雄性，雌雄混合或未识别到性别时默认“雌性/雄性”
- 只有明确写“到货直接取材”或“无需饲养”时，intakePurpose 才输出 direct_sampling；“饲养2周后取材”、否定“不是直接取材”及依据不足均输出 housing
- 供应商截断到“品系/数量/饲养房间”之前
- 供应商保留原文中的公司名称、地区和分公司信息，不自行简称，不把分公司改成母公司名称；系统会依据已维护的供应商映射统一简称
- 品系标准化：c57/c57bl/6 -> C57BL/6、balb/c -> BALB/c、icr -> ICR、km -> KM、裸鼠/nude -> 裸鼠；无法识别时保留原文
- 日期支持 2026-05-13、5月13日、2026年5月13日；只有月日时用当前年份 2026
- 结束日期 = 接收日期 + 饲养周期天数；饲养周期 = 结束日期 - 接收日期，不额外加 1 天（同日为 0 天）
- 明确写出周数时可按每周 7 天换算；不要把动物周龄当作饲养周期
- 两个日期都明确时，以日期差校验饲养周期；缺少日期或周期依据时不要编造
- 未提供接收日期时保持空值，不根据结束日期和周期反推接收日期
- 批次号括号内首字母序列加数字视为 IACUC（如 （Z2025050）2026042903 -> Z2025050）
- species 从品系和文本关键词推断：猴->monkey、兔->rabbit、猪->pig、犬/狗->dog、豚鼠->guinea_pig、大鼠/rat/sprague/wistar/lewis/sd->rat，默认 mouse
- 房间只保留 3-4 位数字
"""


def _parse_quantity(value: Any) -> int | None:
    try:
        number = int(str(value or "").strip().replace(",", ""))
        return number if number > 0 else None
    except (TypeError, ValueError):
        return None


def _normalize_sex(value: Any) -> str:
    text = value.strip().lower() if isinstance(value, str) else ""
    female = bool(re.search(r"雌|母|♀|\bfemale\b|^f$", text))
    male = bool(re.search(r"雄|公|♂|\bmale\b|^m$", text))
    if female == male:
        return "雌性/雄性"
    return "雌性" if female else "雄性"


def _parse_husbandry_days(value: Any) -> int | None:
    if value is None:
        return None
    try:
        number = int(str(value).strip())
        return number if number >= 0 else None
    except (TypeError, ValueError):
        return None


def _parse_date(value: Any) -> str:
    raw = clean_text(str(value or ""))
    if not raw:
        return ""
    if len(raw) >= 10 and raw[:4].isdigit():
        try:
            parsed = date(int(raw[:4]), int(raw[5:7]), int(raw[8:10]))
            return parsed.isoformat()
        except (ValueError, OverflowError):
            return ""
    return ""


def _normalize_payload(payload: dict[str, Any]) -> dict[str, Any]:
    strain_raw = clean_text(str(payload.get("strainRaw") or ""))
    strain_standard = clean_text(str(payload.get("strainStandard") or ""))
    batch_no = clean_text(str(payload.get("batchNo") or ""))
    iacuc = clean_text(str(payload.get("iacuc") or ""))
    if not iacuc and "（" in batch_no and "）" in batch_no:
        inner = batch_no.split("（", 1)[1].split("）", 1)[0]
        iacuc = clean_text(inner)
    deterministic_strain = standardize_strain(strain_raw)
    supplier = abbreviate_supplier(clean_text(str(payload.get("supplier") or "")))
    intake_date = _parse_date(payload.get("intakeDate"))
    end_date = _parse_date(payload.get("endDate"))
    husbandry_days = _parse_husbandry_days(payload.get("husbandryDays"))
    intake_purpose = "direct_sampling" if payload.get("intakePurpose") == "direct_sampling" else "housing"

    if intake_date and end_date:
        intake = date.fromisoformat(intake_date)
        end = date.fromisoformat(end_date)
        husbandry_days = (end - intake).days if end >= intake else None
    elif intake_date and husbandry_days is not None and not end_date:
        try:
            end_date = (date.fromisoformat(intake_date) + timedelta(days=husbandry_days)).isoformat()
        except OverflowError:
            pass

    result = {
        "purchaseOrderNo": clean_text(str(payload.get("purchaseOrderNo") or "")),
        "batchNo": batch_no,
        "iacuc": iacuc.upper(),
        "supplier": supplier,
        "strainRaw": strain_raw,
        "strainStandard": deterministic_strain or strain_standard or strain_raw,
        "species": clean_text(str(payload.get("species") or "")),
        "sex": _normalize_sex(payload.get("sex")),
        "quantity": _parse_quantity(payload.get("quantity")),
        "roomName": clean_text(str(payload.get("roomName") or "")),
        "intakePurpose": intake_purpose,
        "intakeDate": intake_date,
        "endDate": end_date,
        "husbandryDays": husbandry_days,
    }
    if intake_purpose == "direct_sampling":
        result.update({"roomName": "", "endDate": "", "husbandryDays": None})
    return result


def ai_parse_intake_message(raw_message: str, room_names: list[str] | None = None) -> dict[str, Any]:
    text = clean_text(str(raw_message or ""))
    if not text:
        raise ValueError("请先粘贴预约接收文本。")
    user_prompt = f"预约接收文本：\n{text}"
    if room_names:
        user_prompt += f"\n\n可选饲养房间号：{', '.join(sorted(room_names))}"
    payload, usage = deepseek_chat_json(SYSTEM_RULES, user_prompt)
    return _normalize_payload(payload), usage
