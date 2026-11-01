"""Certificate facts remain separate from appointments and project authority."""

import re
import unicodedata

from server_app.domains.intake.recognition_specification import normalize_specification
from server_app.domains.intake.strain_standard import standardize_strain, supplier_full_name

MAX_LINES = 200


def is_slash_quantity_note(note, slash_sexes):
    """Ignore only a slash-quantity note, preserving other uncertainty in a mixed note."""
    if (
        not slash_sexes
        or not re.search(r"数量|只数", note)
        or not re.search(r"(?<![\dA-Za-z])[/／](?![\dA-Za-z])|斜杠", note)
    ):
        return False
    if re.search(r"\d\s*[/／]\s*\d", note):
        return False
    if re.search(
        r"遮挡|模糊|看不清|不清|可能|疑似|不能确认|另一|另外|同时|品系|供应商|出售单位|日期|体重|日龄|规格|证号|许可证|备注|性别",
        note,
    ):
        return False
    return not any(char in note and sex not in slash_sexes for char, sex in (("雄", "雄性"), ("雌", "雌性")))


TEXT_FIELDS = (
    "certificateNo",
    "certificateStrain",
    "grade",
    "supplier",
    "sex",
    "weightRaw",
    "ageRaw",
    "specification",
    "experimentCertificateNo",
    "notes",
)


def text(value, maximum=500):
    if value is None:
        return ""
    if (
        not isinstance(value, str)
        or len(value) > maximum
        or any(ord(char) < 32 and char not in "\n\t" for char in value)
    ):
        raise ValueError("合格证字段格式或长度无效")
    return value.strip()


def certificate_number(value):
    value = text(value, 160)
    return re.sub(r"^(?:No\.?\s*[:：]?|合格证编号\s*[:：]?)\s*", "", value, flags=re.IGNORECASE).strip()


def gender(value):
    value = text(value, 30)
    if value.casefold() in ("雄", "雄性", "male", "m", "♂"):
        return "雄性"
    if value.casefold() in ("雌", "雌性", "female", "f", "♀"):
        return "雌性"
    if "雄" in value and "雌" in value:
        return "雌雄"
    return "未知"


def grade(value):
    value = text(value, 80)
    return "SPF" if value.upper() in ("SPF", "SPF级") else value


def default_grade(batch):
    species = str(batch.get("species") or "").strip().lower()
    return "SPF" if species in ("mouse", "rat", "小鼠", "大鼠") else "普通级" if species else ""


def specification(line):
    raw = " / ".join(value for key in ("weightRaw", "ageRaw") if (value := text(line.get(key), 300)))
    return normalize_specification(raw)


def comparable(value):
    return re.sub(r"[\s,，、()（）]", "", unicodedata.normalize("NFKC", str(value or ""))).casefold()


def differences(batch, lines):
    warnings = []
    quantity = batch.get("quantity")
    if type(quantity) is int and all(type(line.get("quantity")) is int for line in lines):
        total = sum(line["quantity"] for line in lines)
        if quantity != total:
            warnings.append(f"合格证明细合计{total}只，与预约预填{quantity}只不同，请核对实际接收数量")
    expected_supplier, _ = supplier_full_name(str(batch.get("supplier") or ""))
    if expected_supplier and any(comparable(line.get("supplier")) != comparable(expected_supplier) for line in lines):
        warnings.append("合格证出售单位与预约购买单位不同或尚未识别，请对照原图核对，不以质量检测单位代替")
    actual_sexes = {line["sex"] for line in lines if line.get("quantity")}
    expected_sex = gender(str(batch.get("sex") or ""))
    if (expected_sex in ("雄性", "雌性") and actual_sexes != {expected_sex}) or (
        expected_sex == "雌雄" and actual_sexes != {"雄性", "雌性"}
    ):
        warnings.append("合格证性别与预约预填不一致，请核对雌雄字形及对应只数")
    expected_spec, _ = normalize_specification(batch.get("specification"))
    if expected_spec and any(line.get("specification") != expected_spec for line in lines):
        warnings.append("合格证体重／日龄与预约规格不同或不完整，请核对证载原文")
    expected_strain = str(batch.get("strainStandard") or "") or standardize_strain(str(batch.get("strainRaw") or ""))
    if expected_strain and any(
        comparable(standardize_strain(line.get("certificateStrain")) or line.get("certificateStrain"))
        != comparable(expected_strain)
        for line in lines
    ):
        warnings.append("证载品系与预约标准品系有差异；两者分别保存，请对照原图核对")
    if any(line.get("grade") and line["grade"] != default_grade(batch) for line in lines):
        warnings.append("证载等级与物种默认等级不同，请核对后确认")
    return warnings
