"""Versioned, explicitly confirmed reception facts; appointment records are immutable here."""

import hashlib
import json
import re
from uuid import uuid4

from server_app.shared.concurrency import StaleWriteError, begin_write
from server_app.shared.time import now_iso

from . import certificate_repository as repo
from . import certificate_rules as rules
from . import certificate_service, repository


def _clean_lines(conn, batch_id, batch, inputs):
    if not isinstance(inputs, list) or not 1 <= len(inputs) <= rules.MAX_LINES:
        raise ValueError("接收登记须包含1至200条合格证明细")
    if any(not isinstance(line, dict) for line in inputs):
        raise ValueError("合格证明细格式无效")
    attachments = {item["id"] for item in repo.attachments(conn, batch_id)}
    run_ids = {line.get("runId") for line in inputs if isinstance(line.get("runId"), str) and line["runId"]}
    runs = repo.runs_by_ids(conn, sorted(run_ids))
    receipts = {item.get("id"): item for item in batch.get("receipts", []) if isinstance(item, dict) and item.get("id")}
    rows, identities = [], set()
    for value in inputs:
        identity = value.get("id")
        if (
            not isinstance(identity, str)
            or not re.fullmatch(r"[A-Za-z0-9_-]{1,120}", identity)
            or identity in identities
        ):
            raise ValueError("合格证明细编号无效或重复")
        identities.add(identity)
        attachment_id = value.get("attachmentId")
        if not isinstance(attachment_id, str) or attachment_id not in attachments:
            raise ValueError("合格证明细必须关联当前批次已上传的原件")
        if value.get("runId") is not None and not isinstance(value.get("runId"), str):
            raise ValueError("识别来源编号无效")
        row = {key: rules.text(value.get(key), 1000 if key == "notes" else 500) for key in rules.TEXT_FIELDS}
        row.update(id=identity, attachmentId=attachment_id, runId=value.get("runId") or None)
        row["certificateNo"] = rules.certificate_number(row["certificateNo"])
        row["grade"] = rules.grade(row["grade"])
        if any(not row[key] for key in ("certificateNo", "certificateStrain", "grade", "supplier")):
            raise ValueError("请补全合格证号、证载品系、等级和出售单位后确认保存")
        if row["sex"] not in ("雄性", "雌性", "雌雄", "未知"):
            raise ValueError("请明确选择每条明细的性别")
        quantity = value.get("quantity")
        if type(quantity) is not int or not 1 <= quantity <= 1_000_000:
            raise ValueError("每条合格证明细的数量须为正整数，空数量须核对，零数量行请移除")
        row["quantity"] = quantity
        for key in ("certificateIndex", "certificateLineIndex"):
            index = value.get(key)
            if type(index) is not int or not 1 <= index <= rules.MAX_LINES:
                raise ValueError("合格证来源行索引无效")
            row[key] = index
        source = None
        if row["runId"]:
            attempt = runs.get(row["runId"])
            if not attempt or (attempt["batch_id"], attempt["attachment_id"], attempt["status"]) != (
                batch_id,
                attachment_id,
                "completed",
            ):
                raise ValueError("识别来源不存在、未完成或不属于此合格证")
            row["recognitionBatchUpdatedAt"] = attempt["source_batch_version"]
            source = next(
                (
                    line
                    for line in json.loads(attempt["result_json"])["lines"]
                    if (line["certificateIndex"], line["certificateLineIndex"])
                    == (row["certificateIndex"], row["certificateLineIndex"])
                ),
                None,
            )
            if not source:
                raise ValueError("识别来源行不存在，请重新核对")
        explicit_spec = row["specification"]
        if explicit_spec:
            row["specification"], review = rules.normalize_specification(explicit_spec)
            if review:
                raise ValueError("规格须填写带单位的动物体重或日龄，例如18-22g、6-8w")
        else:
            row["specification"], _ = rules.specification(row)
        receipt_id = value.get("receiptId") or None
        if receipt_id is not None and (not isinstance(receipt_id, str) or receipt_id not in receipts):
            raise ValueError("接收日期关联不属于当前批次")
        if receipt_id is None and len(receipts) == 1:
            receipt_id = next(iter(receipts))
        row["receiptId"] = receipt_id
        row["fieldOrigins"] = {
            key: "ai_verified" if source and source.get(key) == row.get(key) else "manual"
            for key in (*rules.TEXT_FIELDS, "quantity")
        }
        rows.append(row)
    return rows


def save(conn, actor, batch_id, body):
    certificate_service.authorize(actor, write=True)
    request_id = certificate_service.request_id(body)
    if body.get("acknowledged") is not True:
        raise ValueError("请确认已核对原图、性别数量及与预约的差异")
    signature = hashlib.sha256(repo.encode(body).encode()).hexdigest()
    begin_write(conn)
    row, batch = certificate_service.load_batch(
        conn, batch_id, expected=body.get("expectedBatchUpdatedAt"), writing=True
    )
    if replay := repo.saved_request(conn, actor["id"], request_id):
        if replay["batch_id"] != batch_id or replay["signature"] != signature:
            raise StaleWriteError("保存请求编号已用于不同内容，请重新确认")
        return {"registration": json.loads(replay["result_json"])}
    existing = repo.registration(conn, batch_id)
    if "expectedRegistrationUpdatedAt" not in body or body["expectedRegistrationUpdatedAt"] != (
        existing["updatedAt"] if existing else None
    ):
        raise StaleWriteError("接收登记已被其他人更新，请刷新后重新核对，当前输入不会自动覆盖")
    source = repository.context(conn)
    if body.get("expectedApplicationVersion") != source["version"]:
        raise StaleWriteError("实验申请汇总资料已更新，请刷新后重新核对")
    batch["updatedAt"] = row["updated_at"]
    lines = _clean_lines(conn, batch_id, batch, body.get("lines"))
    warnings = rules.differences(batch, lines)
    if any(line.get("recognitionBatchUpdatedAt") not in (None, row["updated_at"]) for line in lines):
        warnings.append("部分识别来自较早的批次版本，本次已人工对照原件及当前预约确认")
    if any(not line["specification"] for line in lines):
        warnings.append("部分合格证明细未提供可规范化的规格，导出时标记待补充")
    if len(batch.get("receipts", [])) > 1 and any(not line["receiptId"] for line in lines):
        warnings.append("部分明细尚未选择对应的实际接收记录，导出日期标记待补充")
    at = now_iso()
    item = {
        "id": existing["id"] if existing else uuid4().hex,
        "batchId": batch_id,
        "updatedAt": at,
        "sourceBatchUpdatedAt": row["updated_at"],
        "applicationVersion": source["version"],
        "confirmedAt": at,
        "confirmedBy": actor["displayName"],
        "confirmedById": actor["id"],
        "lines": lines,
        "warnings": warnings,
        "totalQuantity": sum(line["quantity"] for line in lines),
    }
    repo.save_registration(conn, item)
    certificate_service.audit(conn, actor, "reception.registration_confirmed", batch_id, existing, item)
    repo.record_request(conn, actor["id"], request_id, batch_id, signature, item, at)
    return {"registration": item}
