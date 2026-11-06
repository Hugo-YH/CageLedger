import copy
import hashlib
import os
import re
import tempfile
from datetime import datetime
from io import BytesIO
from pathlib import Path
from uuid import uuid4
from zipfile import BadZipFile, ZipFile

from docx.image.image import Image
from PIL import Image as PillowImage

from server_app.runtime_logging import log_operation

from . import pdf
from . import repository as repo
from .attachment_metadata import validate as validate_attachment
from .catalog import TEMPLATE_VERSION
from .service import StaleWriteError, audit, authorize, check_version, now

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
PDF_MIME = "application/pdf"
METHOD_CODES = {"parasite": "M", "elisa_mouse": "E", "elisa_rat": "E", "pcr": "P"}
METHOD_FILENAMES = {
    "parasite": "寄生虫",
    "elisa_mouse": "ELISA小鼠",
    "elisa_rat": "ELISA大鼠",
    "pcr": "PCR",
}
_UNSAFE_FILENAME_CHARS = re.compile(r'[\\/:*?"<>|\x00-\x1f]+')
generate = pdf.generate


def next_report_number(conn, batch, method):
    number, reservation = _next_report_number(conn, batch, method, datetime.now().astimezone().strftime("%y%m%d"))
    if reservation:
        repo.reserve_sequence(conn, *reservation)
    return number


def _next_report_number(conn, batch, method, issued_date):
    batch_no = str(batch.get("batchNo") or batch.get("name", "")).upper()
    if not re.fullmatch(r"B\d{8}", batch_no):
        return "", None
    method_code = METHOD_CODES[method]
    scope = f"report:{batch_no}:{method_code}:{issued_date}"
    sequence = repo.sequence_value(conn, scope) + 1
    if sequence > 99:
        raise ValueError("该批次、检测方法和日期的报告编号已达到99份")
    return f"{batch_no}{method_code}{issued_date}{sequence:02d}", (scope, sequence)


def summary_download_filename(batch, title):
    return f"{title}_{_filename_part(batch.get('batchNo') or batch.get('name'), '未编号批次')}.pdf"


def report_download_filename(test, batch, *, number="", version=None, draft=False):
    """Return the one safe, descriptive filename used by preview and report downloads."""
    method = METHOD_FILENAMES.get(test.get("method"), "未知检测")
    test_date = _filename_part(test.get("testDate"), "未填写实验日期", date=True)
    batch_no = _filename_part(batch.get("batchNo") or batch.get("name"), "未填写批次号")
    suffix = "草稿" if draft else f"{_filename_part(number, '未编号报告')}_{_report_version(version)}"
    return f"{method}_{test_date}_{batch_no}_{suffix}.pdf"


def _filename_part(value, fallback, *, date=False):
    text = _UNSAFE_FILENAME_CHARS.sub("-", str(value or "").strip())
    text = re.sub(r"\s+", " ", text).strip(" .-")[:80]
    if date and not re.fullmatch(r"\d{4}-\d{2}-\d{2}", text):
        return fallback
    return text or fallback


def _report_version(value):
    try:
        version = int(value)
    except (TypeError, ValueError):
        return "v未知版本"
    return f"v{version}" if version > 0 else "v未知版本"


@log_operation("quarantine_upload", component="files")
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
                with PillowImage.open(BytesIO(content), formats=["TIFF"]) as parsed:
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
        with PillowImage.open(BytesIO(content), formats=["TIFF"]) as source:
            source.seek(0)
            preview = source.copy()
        preview.thumbnail((3000, 3000))
        if preview.mode not in {"1", "L", "P", "RGB", "RGBA", "I", "I;16"}:
            preview = preview.convert("RGB")
        if preview.mode == "I":
            # Pillow 13 removed implicit clipping of 32-bit TIFF pixels to PNG.
            # Keep the existing 16-bit preview and retain the original TIFF.
            preview = preview.convert("I;16")
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


@log_operation("quarantine_issue", component="files")
def issue(conn, user, test_id, body, root):
    authorize(user)
    if conn.in_transaction:
        raise ValueError("出具报告不能嵌入其他写事务")
    issued_date = datetime.now().astimezone()
    report_id = uuid4().hex
    with repo.read_snapshot(conn):
        test = repo.get(conn, "tests", test_id)
        if test["state"] == "issued":
            return repo.all_items(conn, "reports", test_id)[0]
        check_version(test, body)
        batch = repo.get(conn, "batches", test["batchId"])
        if body.get("expectedBatchUpdatedAt") != batch["updatedAt"]:
            raise StaleWriteError("检疫覆盖来源已变更，请刷新后再出具")
        validate_issue(test)
        document = snapshot(conn, test)
        number, version, reservation = _issue_identity(conn, test, batch, report_id, issued_date)
    document["number"] = number
    # Writer startup, queue waiting, conversion and file writes own no SQLite
    # transaction. The tentative number is consumed only after revalidation.
    content = generate(document, root)
    item = {
        "id": report_id,
        "testId": test_id,
        "version": version,
        "number": number,
        "templateVersion": TEMPLATE_VERSION,
        "snapshot": document,
        "storageName": report_id + ".pdf",
        "mime": PDF_MIME,
        "updatedAt": now(),
        "issuedDate": issued_date.date().isoformat(),
        "issuedBy": {"id": user["id"], "name": user["displayName"]},
    }
    root.mkdir(parents=True, exist_ok=True)
    target = root / item["storageName"]
    staged = None
    try:
        with tempfile.NamedTemporaryFile(dir=root, prefix=".issue-", suffix=".pdf", delete=False) as stream:
            staged = Path(stream.name)
            stream.write(content)
        conn.execute("BEGIN IMMEDIATE")
        current = repo.get(conn, "tests", test_id)
        if current["state"] == "issued":
            existing = repo.all_items(conn, "reports", test_id)[0]
            conn.rollback()
            return existing
        current_batch = repo.get(conn, "batches", test["batchId"])
        current_attachments = repo.all_items(conn, "attachments", test_id)
        if current != test or current_batch != batch or current_attachments != document["attachments"]:
            raise StaleWriteError("检测记录、覆盖来源或附件已变化，请刷新后重新出具")
        if (number, version, reservation) != _issue_identity(conn, current, current_batch, report_id, issued_date):
            raise StaleWriteError("报告编号或原报告版本已变化，请重试出具")
        if reservation:
            repo.reserve_sequence(conn, *reservation)
        repo.save(conn, "reports", item, create=True)
        current.update(state="issued", updatedAt=now())
        repo.save(conn, "tests", current)
        audit(conn, user, "report_issued", test, item)
        os.replace(staged, target)
        conn.commit()
        return item
    except BaseException:
        _remove_uncommitted_report(conn, item, target)
        raise
    finally:
        if staged:
            staged.unlink(missing_ok=True)


def _issue_identity(conn, test, batch, report_id, issued_date):
    version = 1
    reservation = None
    if test.get("correctionOf"):
        previous = repo.related_by_test_ids(conn, "reports", [test["correctionOf"]], metadata=True)[
            test["correctionOf"]
        ]
        version = previous[0]["version"] + 1
        number = previous[0]["number"]
    else:
        number, reservation = _next_report_number(conn, batch, test["method"], issued_date.strftime("%y%m%d"))
        if not number:
            number = f"Q-{issued_date.strftime('%Y%m%d')}-{report_id[:12].upper()}"
    return number, version, reservation


def _remove_uncommitted_report(conn, item, target):
    """Preserve a file if commit acknowledgement failed after a real commit."""
    try:
        conn.rollback()
        referenced = conn.execute("SELECT 1 FROM quarantine_reports WHERE id=?", (item["id"],)).fetchone()
    except Exception:
        # An unknown outcome is not evidence that a published file is disposable.
        return
    if not referenced:
        target.unlink(missing_ok=True)
