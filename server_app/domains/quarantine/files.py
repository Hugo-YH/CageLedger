import copy
import hashlib
import re
from datetime import datetime
from io import BytesIO
from pathlib import Path
from uuid import uuid4
from zipfile import BadZipFile, ZipFile

from docx.image.image import Image
from PIL import Image as PillowImage

from . import repository as repo
from .attachment_metadata import validate as validate_attachment
from .catalog import TEMPLATE_VERSION
from .documents import generate
from .service import audit, authorize, check_version, now

MIME = {
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".tif": "image/tiff",
    ".tiff": "image/tiff",
    ".pdf": "application/pdf",
    ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ".xls": "application/vnd.ms-excel",
}
DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
METHOD_CODES = {"parasite": "M", "elisa_mouse": "E", "elisa_rat": "E", "pcr": "P"}


def next_report_number(conn, batch, method):
    batch_no = str(batch.get("batchNo") or batch.get("name", "")).upper()
    if not re.fullmatch(r"B\d{8}", batch_no):
        return ""
    issued_date = datetime.now().astimezone().strftime("%y%m%d")
    method_code = METHOD_CODES[method]
    scope = f"report:{batch_no}:{method_code}:{issued_date}"
    sequence = repo.sequence_value(conn, scope) + 1
    if sequence > 99:
        raise ValueError("该批次、检测方法和日期的报告编号已达到99份")
    repo.reserve_sequence(conn, scope, sequence)
    return f"{batch_no}{method_code}{issued_date}{sequence:02d}"


def upload(conn, user, test_id, params, name, content, root):
    authorize(user)
    conn.execute("BEGIN IMMEDIATE")
    test = repo.get(conn, "tests", test_id)
    check_version(test, params)
    if test["state"] != "draft":
        raise ValueError("已出具记录不能追加附件，请创建更正草稿")
    suffix = Path(name).suffix.lower()
    if suffix not in MIME or not 0 < len(content) <= 30 * 1024 * 1024:
        raise ValueError("支持 PNG、JPEG、TIF、PDF、Excel，单文件不超过30MB")
    if suffix in {".png", ".jpg", ".jpeg", ".tif", ".tiff"}:
        try:
            if suffix in {".tif", ".tiff"}:
                with PillowImage.open(BytesIO(content)) as parsed:
                    width, height, image_format = parsed.width, parsed.height, parsed.format
                valid = image_format == "TIFF"
            else:
                parsed = Image.from_blob(content)
                width, height, valid = parsed.px_width, parsed.px_height, parsed.content_type == MIME[suffix]
            if width * height > 40_000_000 or not valid:
                raise ValueError("图片格式或尺寸不受支持")
        except Exception as exc:
            raise ValueError("图片格式无效，请上传PNG、JPEG或TIF") from exc
    elif suffix == ".pdf" and not content.startswith(b"%PDF-"):
        raise ValueError("PDF文件无效")
    elif suffix == ".xls" and not content.startswith(bytes.fromhex("D0CF11E0A1B11AE1")):
        raise ValueError("Excel文件无效")
    elif suffix == ".xlsx":
        try:
            with ZipFile(BytesIO(content)) as archive:
                if "xl/workbook.xml" not in archive.namelist():
                    raise ValueError("Excel文件无效")
        except BadZipFile as exc:
            raise ValueError("Excel文件无效") from exc
    for field, collection in (("sampleId", "samples"), ("projectId", "projects")):
        if params.get(field) and params[field] not in {item["id"] for item in test[collection]}:
            raise ValueError("附件关联对象不存在")
    category = params.get("category", "原始记录")
    if category not in {"体内", "体外", "原始记录"}:
        raise ValueError("附件分类无效")
    if (
        test["method"] == "parasite"
        and MIME[suffix].startswith("image/")
        and (not params.get("sampleId") or category not in {"体内", "体外"})
    ):
        raise ValueError("寄生虫图片请选择样本及体内或体外分类，以对应原报告图片区")
    item = {
        "id": uuid4().hex,
        "testId": test_id,
        "name": Path(name).name[:240],
        "mime": MIME[suffix],
        "storageName": uuid4().hex + suffix,
        "size": len(content),
        "sha256": hashlib.sha256(content).hexdigest(),
        "sampleId": params.get("sampleId", ""),
        "projectId": params.get("projectId", ""),
        "category": category,
        "uploadedBy": {"id": user["id"], "name": user["displayName"]},
        "updatedAt": now(),
    }
    preview_content = None
    if suffix in {".tif", ".tiff"}:
        with PillowImage.open(BytesIO(content)) as source:
            source.seek(0)
            preview = source.copy()
        preview.thumbnail((3000, 3000))
        if preview.mode not in {"1", "L", "P", "RGB", "RGBA", "I", "I;16"}:
            preview = preview.convert("RGB")
        converted = BytesIO()
        preview.save(converted, format="PNG", optimize=True)
        preview_content = converted.getvalue()
        item["previewStorageName"] = uuid4().hex + ".png"
    item.update(validate_attachment(test, params, item["mime"]))
    item["uploadedAt"] = item["updatedAt"]
    root.mkdir(parents=True, exist_ok=True)
    target = root / item["storageName"]
    preview_target = root / item["previewStorageName"] if item.get("previewStorageName") else None
    try:
        target.write_bytes(content)
        if preview_target and preview_content is not None:
            preview_target.write_bytes(preview_content)
        repo.save(conn, "attachments", item, create=True)
        test["updatedAt"] = now()
        repo.save(conn, "tests", test)
        audit(conn, user, "attachment_uploaded", None, item)
    except BaseException:
        target.unlink(missing_ok=True)
        if preview_target:
            preview_target.unlink(missing_ok=True)
        raise
    return {"item": item, "test": test}


def preview(item, root):
    storage_name = item.get("previewStorageName") or item["storageName"]
    mime = "image/png" if item.get("previewStorageName") else item["mime"]
    return (root / storage_name).read_bytes(), mime


def snapshot(conn, test):
    return {
        "test": copy.deepcopy(test),
        "batch": repo.get(conn, "batches", test["batchId"]),
        "attachments": repo.all_items(conn, "attachments", test["id"]),
        "templateVersion": TEMPLATE_VERSION,
    }


def validate_issue(test):
    if (
        not test["samples"]
        or not test["projects"]
        or not test["samplingDate"]
        or not test["testDate"]
        or (test.get("reportFormVersion") != 2 and not test["conclusion"])
    ):
        raise ValueError("出具前请完善日期、样本、检测项目和结果结论")
    covered = set()
    for p in test["projects"]:
        covered.update(p["sampleIds"])
        if any(not p["results"].get(sid) for sid in p["sampleIds"]):
            raise ValueError("适用项目判定未填写完整，空白不视为阴性")
        if (
            test["method"] != "parasite"
            and p["sampleIds"]
            and (not p.get("nc") or not p.get("pc") or not p.get("kit") or not p.get("lot"))
        ):
            raise ValueError("请填写试剂盒、批号及NC/PC判定")
    if covered != {s["id"] for s in test["samples"]} or any(not s["material"].strip() for s in test["samples"]):
        raise ValueError("每个样本需填写材料并配置适用项目")


def issue(conn, user, test_id, body, root):
    authorize(user)
    conn.execute("BEGIN IMMEDIATE")
    test = repo.get(conn, "tests", test_id)
    if test["state"] == "issued":
        return repo.all_items(conn, "reports", test_id)[0]
    check_version(test, body)
    batch = repo.get(conn, "batches", test["batchId"])
    if body.get("expectedBatchUpdatedAt") != batch["updatedAt"]:
        raise ValueError("检疫覆盖来源已变更，请刷新后再出具")
    validate_issue(test)
    document = snapshot(conn, test)
    report_id = uuid4().hex
    version = 1
    if test.get("correctionOf"):
        previous = repo.all_items(conn, "reports", test["correctionOf"])
        version = previous[0]["version"] + 1
        number = previous[0]["number"]
    else:
        number = next_report_number(conn, batch, test["method"])
        if not number:
            number = f"Q-{now()[:10].replace('-', '')}-{report_id[:12].upper()}"
    document["number"] = number
    content = generate(document, root)
    item = {
        "id": report_id,
        "testId": test_id,
        "version": version,
        "number": number,
        "templateVersion": TEMPLATE_VERSION,
        "snapshot": document,
        "storageName": report_id + ".docx",
        "updatedAt": now(),
        "issuedDate": datetime.now().astimezone().date().isoformat(),
        "issuedBy": {"id": user["id"], "name": user["displayName"]},
    }
    root.mkdir(parents=True, exist_ok=True)
    target = root / item["storageName"]
    try:
        target.write_bytes(content)
        repo.save(conn, "reports", item, create=True)
        before = copy.deepcopy(test)
        test.update(state="issued", updatedAt=now())
        repo.save(conn, "tests", test)
        audit(conn, user, "report_issued", before, item)
    except BaseException:
        target.unlink(missing_ok=True)
        raise
    return item
