import csv
import io
import re
from datetime import date

from server_app.shared import clean_text

from .rules import normalize_iacuc_number


def parse_iacuc_csv(raw):
    text = decode_csv_bytes(raw)
    reader = csv.DictReader(io.StringIO(text))
    if not reader.fieldnames:
        raise ValueError("CSV 文件缺少表头")

    field_by_name = {clean_text(name): name for name in reader.fieldnames if clean_text(name)}
    field_by_compact = {compact_field_name(name): name for name in reader.fieldnames if compact_field_name(name)}
    required = {
        "iacuc": "动物伦理编号",
        "project": "动物实验名称",
        "pi": "项目负责人",
        "owner": "实验负责人",
    }
    required_fields = {
        key: field_name_for_labels(field_by_name, field_by_compact, [label]) for key, label in required.items()
    }
    missing = [required[key] for key, field_name in required_fields.items() if not field_name]
    if missing:
        raise ValueError(f"CSV 缺少必要列：{', '.join(missing)}")
    optional_fields = {
        "funding": field_name_for_labels(
            field_by_name, field_by_compact, ("项目来源", "支撑经费", "经费来源", "课题来源", "经费项目")
        ),
        "fundCode": field_name_for_labels(field_by_name, field_by_compact, ("经费号", "经费本编号", "经费编号")),
        "supportProjectPeriod": field_name_for_labels(
            field_by_name, field_by_compact, ("支撑科研项目起止时间", "科研项目起止时间", "项目起止时间")
        ),
        "experimentNo": field_name_for_labels(field_by_name, field_by_compact, ("动物实验编号", "实验编号")),
        "species": field_name_for_labels(field_by_name, field_by_compact, ("动物品系", "品系", "动物种类")),
        "facility": field_name_for_labels(field_by_name, field_by_compact, ("动物实验场所", "实验场所", "动物房")),
        "maxFeedingPeriod": field_name_for_labels(field_by_name, field_by_compact, ("最长饲养周期", "饲养周期")),
        "iacucApprovalDate": field_name_for_labels(
            field_by_name, field_by_compact, ("动物伦理通过日期", "伦理通过日期", "伦理批准日期")
        ),
        "applicationApprovalDate": field_name_for_labels(
            field_by_name, field_by_compact, ("实验申请通过日期", "申请通过日期", "实验批准日期")
        ),
        "projectStartDate": field_name_for_labels(
            field_by_name, field_by_compact, ("实验开始日期", "项目开始日期", "开始日期")
        ),
        "projectEndDate": field_name_for_labels(
            field_by_name, field_by_compact, ("实验结束日期", "项目结束日期", "结束日期", "有效期至")
        ),
        "approvedFeedingFee": field_name_for_labels(
            field_by_name, field_by_compact, ("实验审核通过饲养费（元）", "审核通过饲养费", "批准饲养费")
        ),
        "approvalLeader": field_name_for_labels(field_by_name, field_by_compact, ("中心审批领导", "审批领导")),
        "actualFeedingFee": field_name_for_labels(
            field_by_name, field_by_compact, ("实际产生饲养费（元）", "实际产生饲养费", "实际饲养费")
        ),
        "pendingReimbursementFee": field_name_for_labels(
            field_by_name, field_by_compact, ("待报销饲养费（元）", "待报销饲养费", "欠缴饲养费")
        ),
        "assistant": field_name_for_labels(field_by_name, field_by_compact, ("实验助手", "助手")),
        "notes": field_name_for_labels(field_by_name, field_by_compact, ("备注", "说明")),
        "applicationDate": field_name_for_labels(field_by_name, field_by_compact, ("申请日期", "提交日期")),
    }

    items = []
    duplicate_count = 0
    row_count = 0
    empty_iacuc_count = 0
    seen_iacucs = set()
    for row in reader:
        row_count += 1
        raw_iacuc = csv_value(row, required_fields["iacuc"])
        iacuc = normalize_iacuc_number(raw_iacuc)
        if not iacuc:
            empty_iacuc_count += 1
            continue
        if iacuc in seen_iacucs:
            duplicate_count += 1
        seen_iacucs.add(iacuc)
        items.append(
            {
                "id": f"app-{row_count:06d}",
                "iacuc": raw_iacuc,
                "rawIacuc": raw_iacuc,
                "project": csv_value(row, required_fields["project"]),
                "pi": csv_value(row, required_fields["pi"]),
                "owner": csv_value(row, required_fields["owner"]),
                "funding": csv_value(row, optional_fields["funding"]),
                "fundCode": csv_value(row, optional_fields["fundCode"]),
                "supportProjectPeriod": csv_value(row, optional_fields["supportProjectPeriod"]),
                "experimentNo": csv_value(row, optional_fields["experimentNo"]),
                "species": csv_value(row, optional_fields["species"]),
                "facility": csv_value(row, optional_fields["facility"]),
                "maxFeedingPeriod": csv_value(row, optional_fields["maxFeedingPeriod"]),
                "iacucApprovalDate": csv_value(row, optional_fields["iacucApprovalDate"]),
                "applicationApprovalDate": csv_value(row, optional_fields["applicationApprovalDate"]),
                "projectStartDate": csv_value(row, optional_fields["projectStartDate"]),
                "projectEndDate": csv_value(row, optional_fields["projectEndDate"]),
                "approvedFeedingFee": csv_value(row, optional_fields["approvedFeedingFee"]),
                "approvalLeader": csv_value(row, optional_fields["approvalLeader"]),
                "actualFeedingFee": csv_value(row, optional_fields["actualFeedingFee"]),
                "pendingReimbursementFee": csv_value(row, optional_fields["pendingReimbursementFee"]),
                "assistant": csv_value(row, optional_fields["assistant"]),
                "notes": csv_value(row, optional_fields["notes"]),
                "applicationDate": csv_value(row, optional_fields["applicationDate"]),
                "rawFields": clean_csv_raw_fields(row),
            }
        )

    return {
        "items": items,
        "summary": {
            "rowCount": row_count,
            "count": len(items),
            "emptyIacucCount": empty_iacuc_count,
            "duplicateCount": duplicate_count,
        },
    }


def decode_csv_bytes(raw):
    for encoding in ("utf-8-sig", "utf-8", "gb18030"):
        try:
            return raw.decode(encoding)
        except UnicodeDecodeError:
            continue
    raise ValueError("CSV 编码无法识别，请使用 UTF-8 或 GB18030")


def compact_field_name(value):
    return re.sub(r"\s+", "", clean_text(value))


def field_name_for_labels(field_by_name, field_by_compact, labels):
    for label in labels:
        clean_label = clean_text(label)
        if clean_label in field_by_name:
            return field_by_name[clean_label]
        compact_label = compact_field_name(label)
        if compact_label in field_by_compact:
            return field_by_compact[compact_label]
    return None


def clean_csv_raw_fields(row):
    raw_fields = {}
    for header, value in row.items():
        name = clean_text(header)
        if not name:
            continue
        raw_fields[name] = clean_text(value)
    return raw_fields


def csv_value(row, field_name):
    return clean_text(row.get(field_name, "")) if field_name else ""


def normalize_application_date(value):
    text = clean_text(value)
    if not text:
        return ""
    text = text.replace("年", "-").replace("月", "-").replace("日", "")
    text = re.sub(r"[./]", "-", text)
    text = re.sub(r"\s*-\s*", "-", text)
    text = re.sub(r"\s*00:00:00$", "", text)
    match = re.match(r"^(\d{4})-(\d{1,2})-(\d{1,2})$", text)
    if not match:
        return text
    year, month, day = (int(match.group(1)), int(match.group(2)), int(match.group(3)))
    try:
        return date(year, month, day).isoformat()
    except ValueError:
        return clean_text(value)


def normalize_application_amount(value):
    text = clean_text(value)
    if not text:
        return None
    normalized = re.sub(r"[,\s￥¥元]", "", text)
    try:
        return round(float(normalized), 2)
    except ValueError:
        return text
