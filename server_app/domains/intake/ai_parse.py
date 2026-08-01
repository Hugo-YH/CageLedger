"""DeepSeek-powered intake message recognition.

The browser sends the raw reservation text; this module asks DeepSeek to
extract and normalize the same fields the local parser understands, so the
frontend can keep the identical review-and-save flow afterwards.
"""

from datetime import date
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
  "sex": "性别",
  "quantity": "数量，整数",
  "roomName": "饲养房间号，如 8101",
  "intakeDate": "接收/进驻日期，统一为 YYYY-MM-DD",
  "husbandryDays": "饲养周期（天），整数"
}

规则：
- 字段值缺失时输出 null 或空字符串，不要编造
- 供应商截断到“品系/数量/饲养房间”之前
- 供应商名称标准化为常用简称：广东南模生物科技有限公司 -> 广东南模、江苏集萃药康 -> 江苏集萃、上海南方模式/上海南模 -> 上海南模、广东药康 -> 广东药康、珠海百试通 -> 珠海百试通
- 品系标准化：c57/c57bl/6 -> C57BL/6、balb/c -> BALB/c、icr -> ICR、km -> KM、裸鼠/nude -> 裸鼠；无法识别时保留原文
- 日期支持 2026-05-13、5月13日、2026年5月13日；只有月日时用当前年份 2026
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


def _parse_husbandry_days(value: Any) -> int | None:
    try:
        number = int(str(value or "").strip())
        return number if number > 0 else None
    except (TypeError, ValueError):
        return None


def _parse_date(value: Any) -> str:
    raw = clean_text(str(value or ""))
    if not raw:
        return ""
    if len(raw) >= 10 and raw[:4].isdigit():
        year = int(raw[:4])
        month = int(raw[5:7])
        day = int(raw[8:10])
        try:
            parsed = date(year, month, day)
            return parsed.isoformat()
        except ValueError:
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
    return {
        "purchaseOrderNo": clean_text(str(payload.get("purchaseOrderNo") or "")),
        "batchNo": batch_no,
        "iacuc": iacuc.upper(),
        "supplier": supplier,
        "strainRaw": strain_raw,
        "strainStandard": deterministic_strain or strain_standard or strain_raw,
        "species": clean_text(str(payload.get("species") or "")),
        "sex": clean_text(str(payload.get("sex") or "")),
        "quantity": _parse_quantity(payload.get("quantity")),
        "roomName": clean_text(str(payload.get("roomName") or "")),
        "intakeDate": _parse_date(payload.get("intakeDate")),
        "husbandryDays": _parse_husbandry_days(payload.get("husbandryDays")),
    }


def ai_parse_intake_message(raw_message: str, room_names: list[str] | None = None) -> dict[str, Any]:
    text = clean_text(str(raw_message or ""))
    if not text:
        raise ValueError("请先粘贴预约接收文本。")
    user_prompt = f"预约接收文本：\n{text}"
    if room_names:
        user_prompt += f"\n\n可选饲养房间号：{', '.join(sorted(room_names))}"
    payload, usage = deepseek_chat_json(SYSTEM_RULES, user_prompt)
    return _normalize_payload(payload), usage
