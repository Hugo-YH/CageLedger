import copy
import hashlib
from io import BytesIO
from pathlib import Path
from uuid import uuid4
from zipfile import BadZipFile, ZipFile

from docx.image.image import Image

from . import repository as repo
from .attachment_metadata import validate as validate_attachment
from .catalog import TEMPLATE_VERSION
from .documents import generate
from .service import audit, authorize, check_version, now

MIME = {
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".pdf": "application/pdf",
    ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ".xls": "application/vnd.ms-excel",
}
DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"


def upload(conn, user, test_id, params, name, content, root):
    authorize(user)
    conn.execute("BEGIN IMMEDIATE")
    test = repo.get(conn, "tests", test_id)
    check_version(test, params)
    if test["state"] != "draft":
        raise ValueError("已出具记录不能追加附件，请创建更正草稿")
    suffix = Path(name).suffix.lower()
    if suffix not in MIME or not 0 < len(content) <= 30 * 1024 * 1024:
        raise ValueError("支持 PNG、JPEG、PDF、Excel，单文件不超过30MB")
    if suffix in {".png", ".jpg", ".jpeg"}:
        try:
            parsed = Image.from_blob(content)
            if parsed.px_width * parsed.px_height > 40_000_000 or parsed.content_type != MIME[suffix]:
                raise ValueError("图片格式或尺寸不受支持")
        except Exception as exc:
            raise ValueError("图片格式无效，请上传PNG或JPEG") from exc
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
    item.update(validate_attachment(test, params, item["mime"]))
    item["uploadedAt"] = item["updatedAt"]
    root.mkdir(parents=True, exist_ok=True)
    target = root / item["storageName"]
    try:
        target.write_bytes(content)
        repo.save(conn, "attachments", item, create=True)
        test["updatedAt"] = now()
        repo.save(conn, "tests", test)
        audit(conn, user, "attachment_uploaded", None, item)
    except BaseException:
        target.unlink(missing_ok=True)
        raise
    return {"item": item, "test": test}


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
