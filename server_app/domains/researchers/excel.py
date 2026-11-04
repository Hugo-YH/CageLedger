"""Bounded, read-only import of directory spreadsheets, including incorrect A1 dimensions."""

import base64
import binascii
import hashlib
from collections import Counter
from io import BytesIO
from pathlib import Path
from zipfile import BadZipFile, ZipFile

from openpyxl import load_workbook

from .fields import normalize_fields, string_value

MAX_BYTES = 10 * 1024 * 1024
MAX_ROWS = 5000
HEADERS = {
    "姓名": "name",
    "姓名(人员)": "name",
    "账号": "account",
    "别名": "alias",
    "部门": "department",
    "职务": "position",
    "性别": "gender",
    "手机": "mobile",
    "手机号": "mobile",
    "联系电话": "mobile",
    "座机": "telephone",
    "邮箱": "email",
    "企业邮箱": "enterpriseEmail",
    "英文名": "englishName",
    "禁用状态": "sourceDisabled",
    "激活状态": "activationStatus",
}


def decode_file(body):
    if not isinstance(body, dict):
        raise ValueError("导入请求格式无效")
    filename, data = body.get("filename"), body.get("data")
    if not isinstance(filename, str) or len(filename) > 255 or Path(filename).suffix.lower() != ".xlsx":
        raise ValueError("请选择.xlsx格式的实验人员通讯录")
    if not isinstance(data, str) or len(data) > (MAX_BYTES + 2) // 3 * 4:
        raise ValueError("Excel文件不能超过10 MiB")
    try:
        content = base64.b64decode(data, validate=True)
    except (ValueError, binascii.Error) as exc:
        raise ValueError("Excel文件编码无效") from exc
    if not content or len(content) > MAX_BYTES:
        raise ValueError("Excel文件为空或超过10 MiB")
    try:
        with ZipFile(BytesIO(content)) as archive:
            entries = archive.infolist()
            if len(entries) > 500 or sum(entry.file_size for entry in entries) > 50 * 1024 * 1024:
                raise ValueError("Excel展开内容过大，请拆分后上传")
            if any(entry.flag_bits & 1 for entry in entries):
                raise ValueError("不支持加密Excel")
            if any(entry.filename.lower().endswith("vbaproject.bin") for entry in entries):
                raise ValueError("不支持含宏的Excel")
    except BadZipFile as exc:
        raise ValueError("无法读取Excel文件") from exc
    return filename.replace("\\", "/").split("/")[-1], content, hashlib.sha256(content).hexdigest()


def _header(cells):
    columns = {}
    # Prefer the actual 姓名 column over its duplicated 姓名(人员) presentation.
    for index, cell in enumerate(cells):
        label = string_value(cell.value).strip("*＊ ")
        field = HEADERS.get(label)
        if field and (field not in columns or label == "姓名"):
            columns[field] = index
    return columns if "account" in columns and "name" in columns else None


def _row(cells, columns, sheet, number):
    errors, values = [], {}
    for field, index in columns.items():
        cell = cells[index]
        value = string_value(cell.value)
        if cell.data_type == "f":
            errors.append(f"{cell.coordinate}含公式，请转换为实际文本后导入")
        if field == "sourceDisabled":
            if not value:
                continue
            if value not in ("", "否", "是", "0", "1", "已禁用", "未禁用", "禁用", "启用", "False", "True"):
                errors.append("禁用状态无效")
            values[field] = value in ("是", "1", "已禁用", "禁用", "True")
        elif value:
            values[field] = value
    account = values.pop("account", "")
    if not account or len(account) > 128 or any(ord(char) < 33 for char in account):
        errors.append("账号不能为空、包含空白或超过128字符")
    if not values.get("name"):
        errors.append("姓名不能为空")
    try:
        values = normalize_fields(values)
    except ValueError as exc:
        errors.append(str(exc))
    return {
        "row": number,
        "sheet": sheet,
        "account": account,
        "name": values.get("name", ""),
        "values": values,
        "errors": errors,
        "warnings": [],
    }


def parse(content):
    rows = []
    try:
        workbook = load_workbook(BytesIO(content), read_only=True, data_only=False, keep_links=False)
        try:
            if len(workbook.worksheets) > 20:
                raise ValueError("工作表过多，请拆分后上传")
            for sheet in workbook:
                sheet.reset_dimensions()
                columns = None
                has_content = False
                for number, cells in enumerate(sheet.iter_rows(max_col=64), 1):
                    has_content = has_content or any(string_value(cell.value) for cell in cells)
                    if number > MAX_ROWS + 20:
                        raise ValueError("每个工作表最多5000条记录，请拆分后上传")
                    if not columns:
                        columns = _header(cells)
                        if not columns and number >= 20:
                            break
                        continue
                    if any(cell.value is not None and string_value(cell.value) for cell in cells):
                        rows.append(_row(cells, columns, sheet.title, number))
                    if len(rows) > MAX_ROWS:
                        raise ValueError("每次最多导入5000名人员，请拆分后上传")
                if has_content and not columns:
                    raise ValueError(f"工作表“{sheet.title}”前20行缺少姓名或账号表头，请保留人员数据表后上传")
        finally:
            workbook.close()
    except ValueError:
        raise
    except Exception as exc:
        raise ValueError("无法读取Excel，请确认文件完整且未加密") from exc
    if not rows:
        raise ValueError("未找到人员资料，请确认前20行内有“姓名”和“账号”表头")
    accounts = Counter(row["account"].casefold() for row in rows if row["account"])
    names = Counter(row["name"] for row in rows if row["name"])
    mobiles = Counter(row["values"].get("mobile") for row in rows if row["values"].get("mobile"))
    for row in rows:
        if accounts[row["account"].casefold()] > 1:
            row["errors"].append("同一文件中账号重复，请核对后重新上传")
        if names[row["name"]] > 1:
            row["warnings"].append("存在同名人员，按账号分别保存")
        if mobile := row["values"].get("mobile"):
            if mobiles[mobile] > 1:
                row["warnings"].append("手机号被多个账号使用，按账号分别保存")
        elif not row["values"].get("email") and not row["values"].get("enterpriseEmail"):
            row["warnings"].append("未提供手机或邮箱，可导入后补充")
    return rows
