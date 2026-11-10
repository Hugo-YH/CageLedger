"""Persist attachments and recognition attempts without holding locks over AI calls."""

import hashlib
import json
import re
from datetime import UTC, datetime
from threading import BoundedSemaphore
from urllib.parse import quote
from uuid import uuid4

from server_app.config import DEEPSEEK_TIMEOUT_SECONDS, DEEPSEEK_VISION_MODEL
from server_app.db import connect_db
from server_app.domains.administration.audit import audit_event, write_audit_events
from server_app.runtime_logging import log_stage
from server_app.shared.concurrency import StaleWriteError, begin_write, require_exact_version
from server_app.shared.time import now_iso

from . import certificate_ai, certificate_files, certificate_pages, certificate_review, repository, service
from . import certificate_repository as repo

_AI_SLOTS = BoundedSemaphore(2)
_AUDIT_LABELS = {
    "reception.certificate_uploaded": "上传接收合格证原件",
    "reception.certificate_recognition_started": "开始识别接收合格证",
    "reception.certificate_recognized": "完成接收合格证识别",
    "reception.certificate_recognition_failed": "接收合格证识别失败",
    "reception.certificate_recognition_interrupted": "标记已中断的合格证识别",
    "reception.registration_confirmed": "确认接收登记",
}


def authorize(actor, *, write=False):
    service.authorize(actor)
    if actor.get("active") is False or (write and actor.get("role") not in ("admin", "room_admin")):
        raise PermissionError("当前账号无权维护接收登记")


def load_batch(conn, batch_id, *, expected=None, writing=False):
    row = repo.batch(conn, batch_id)
    if not row:
        raise LookupError("接收批次不存在")
    if row["status"] != "received":
        raise StaleWriteError("该批次不再处于已接收状态，请刷新列表")
    if writing:
        require_exact_version(row["updated_at"], expected, "接收批次已变更，请刷新后重新核对")
    return row, json.loads(row["payload"])


def request_id(body):
    identity = body.get("requestId") if isinstance(body, dict) else None
    if not isinstance(identity, str) or not re.fullmatch(r"[A-Za-z0-9_-]{8,100}", identity):
        raise ValueError("请提供有效的接收操作请求编号")
    return identity


def audit(conn, actor, action, batch_id, before, after):
    write_audit_events(
        conn,
        [
            audit_event(
                actor,
                action,
                "reception_register",
                batch_id,
                f"{actor['displayName']} {_AUDIT_LABELS[action]}",
                [],
                now_iso(),
                before,
                after,
            )
        ],
    )


def attachment_view(item):
    base = f"/api/receptions/{quote(item['batch_id'], safe='')}/certificates/{item['id']}"
    return {
        "id": item["id"],
        "batchId": item["batch_id"],
        "name": item["name"],
        "size": item["size"],
        "sha256": item["sha256"],
        "pageCount": item["page_count"],
        "createdAt": item["created_at"],
        "createdBy": item["created_by"],
        "fileUrl": base + "/file",
        "previewUrl": base + "/preview",
    }


def run_view(item):
    return {
        "id": item["id"],
        "batchId": item["batch_id"],
        "attachmentId": item["attachment_id"],
        "status": item["status"],
        "sourceBatchUpdatedAt": item["source_batch_version"],
        "model": item["model"],
        "result": certificate_review.current_result(json.loads(item["result_json"])) if item["result_json"] else None,
        "error": item["error_message"],
        "createdAt": item["created_at"],
        "updatedAt": item["updated_at"],
    }


def detail(conn, actor, batch_id):
    authorize(actor)
    row, _ = load_batch(conn, batch_id)
    context = repository.context(conn)
    selected = repository.selected(conn, context, [batch_id])[0]
    batch = service.record(selected, context, complete=True)
    registration = repo.registration(conn, batch_id)
    attached = repo.attachments(conn, batch_id)
    batch.update(
        registrationUpdatedAt=registration["updatedAt"] if registration else None,
        registeredQuantity=registration["totalQuantity"] if registration else None,
        certificateCount=len(attached),
        registrationStatus=(
            "stale"
            if registration and registration["sourceBatchUpdatedAt"] != row["updated_at"]
            else "confirmed"
            if registration
            else "unconfirmed"
        ),
    )
    return {
        "batch": batch,
        "applicationVersion": context["version"],
        "registration": registration,
        "attachments": [attachment_view(item) for item in attached],
        "runs": [run_view(item) for item in repo.runs(conn, batch_id)],
        "canWrite": actor.get("role") in ("admin", "room_admin") and actor.get("active") is not False,
    }


def upload(actor, batch_id, expected, name, content):
    authorize(actor, write=True)
    certificate_files.validate(name, content)
    with log_stage("reception_certificate_upload", "lookup", component="reception"):
        digest = hashlib.sha256(content).hexdigest()
        with connect_db() as conn:
            load_batch(conn, batch_id, expected=expected, writing=True)
            if identical := repo.identical_attachment(conn, batch_id, digest):
                return {"attachment": attachment_view(identical), "reused": True}
    metadata, preview = certificate_files.prepare(name, content)
    item = {
        **metadata,
        "id": uuid4().hex,
        "batch_id": batch_id,
        "created_by": actor["id"],
        "created_at": now_iso(),
        "preview_sha256": hashlib.sha256(preview).hexdigest(),
        "preview_size": len(preview),
    }
    with certificate_files.store(item["id"], content, preview, name=item["name"]) as commit_files:
        with log_stage("reception_certificate_upload", "save", component="reception"):
            with connect_db() as conn:
                begin_write(conn)
                load_batch(conn, batch_id, expected=expected, writing=True)
                if identical := repo.identical_attachment(conn, batch_id, digest):
                    return {"attachment": attachment_view(identical), "reused": True}
                if len(repo.attachments(conn, batch_id)) >= certificate_files.MAX_ATTACHMENTS:
                    raise ValueError("单个接收批次最多保存20份合格证附件")
                repo.insert_attachment(conn, item)
                audit(conn, actor, "reception.certificate_uploaded", batch_id, None, attachment_view(item))
                conn.commit()
                commit_files()
    return {"attachment": attachment_view(item), "reused": False}


def download(conn, actor, batch_id, attachment_id, *, preview=False):
    authorize(actor)
    load_batch(conn, batch_id)
    item = repo.attachment(conn, batch_id, attachment_id)
    if not item:
        raise LookupError("合格证附件不存在或不属于此批次")
    return verified_file(item, preview=preview), "合格证首页.png" if preview else item["name"]


def verified_file(item, *, preview=False):
    content = certificate_files.read(item["id"], preview=preview, name=item["name"])
    digest = item["preview_sha256"] if preview else item["sha256"]
    size = item["preview_size"] if preview else item["size"]
    if not digest or size != len(content) or hashlib.sha256(content).hexdigest() != digest:
        raise certificate_files.CertificateUnavailableError("合格证文件校验失败，请联系管理员核对备份")
    return content


def _expire_or_reject(conn, actor, batch_id, attachment_id):
    rows = repo.running_runs(conn, attachment_id)
    for item in rows:
        age = (datetime.now(UTC) - datetime.fromisoformat(item["created_at"])).total_seconds()
        if age <= DEEPSEEK_TIMEOUT_SECONDS + certificate_pages.MAX_RENDER_SECONDS + 60:
            raise certificate_files.CertificateUnavailableError("该附件正在识别，请稍后刷新查看结果")
        error = "上次识别已中断或超时，请重新识别"
        repo.finish_run(conn, item["id"], now_iso(), error=error)
        audit(
            conn,
            actor,
            "reception.certificate_recognition_interrupted",
            batch_id,
            None,
            {"runId": item["id"], "attachmentId": attachment_id, "error": error},
        )


def recognize(actor, batch_id, attachment_id, body):
    authorize(actor, write=True)
    identity = request_id(body)
    include_all = body.get("includeAllPages", False)
    if type(include_all) is not bool:
        raise ValueError("识别页面范围格式无效")
    mode = "all" if include_all else "auto"
    if not _AI_SLOTS.acquire(blocking=False):
        raise certificate_files.CertificateUnavailableError("合格证识别繁忙，请稍后重试")
    try:
        with log_stage("reception_certificate_recognition", "start", component="reception"):
            with connect_db() as conn:
                begin_write(conn)
                row, batch = load_batch(conn, batch_id, expected=body.get("expectedBatchUpdatedAt"), writing=True)
                attached = repo.attachment(conn, batch_id, attachment_id)
                if not attached:
                    raise LookupError("合格证附件不存在或不属于此批次")
                if existing := repo.requested_run(conn, actor["id"], identity):
                    if (existing["batch_id"], existing["attachment_id"], existing["source_batch_version"]) != (
                        batch_id,
                        attachment_id,
                        row["updated_at"],
                    ):
                        raise StaleWriteError("识别请求编号已用于其他内容，请重新发起")
                    if (existing.get("selection_mode") or "auto") != mode:
                        raise StaleWriteError("识别请求编号已用于不同页面范围，请重新发起")
                    return {"run": run_view(existing)}
                _expire_or_reject(conn, actor, batch_id, attachment_id)
                at = now_iso()
                attempt = {
                    "id": uuid4().hex,
                    "batch_id": batch_id,
                    "attachment_id": attachment_id,
                    "actor_id": actor["id"],
                    "request_id": identity,
                    "source_batch_version": row["updated_at"],
                    "status": "running",
                    "model": DEEPSEEK_VISION_MODEL,
                    "created_at": at,
                    "updated_at": at,
                    "selection_mode": mode,
                }
                repo.insert_run(conn, attempt)
                audit(
                    conn,
                    actor,
                    "reception.certificate_recognition_started",
                    batch_id,
                    None,
                    {
                        "runId": attempt["id"],
                        "attachmentId": attachment_id,
                        "sourceBatchUpdatedAt": row["updated_at"],
                        "pageSelectionMode": mode,
                    },
                )
                conn.commit()
        result, raw, error = None, {"pageSelectionMode": mode}, ""
        try:
            with log_stage("reception_certificate_recognition", "verify_files", component="reception"):
                first_preview = verified_file(attached, preview=True)
                original = verified_file(attached)
            if certificate_files.content_type(attached["name"]) == "application/pdf":
                images, selection = certificate_pages.prepare(
                    original, attached["page_count"], first_preview, include_all=include_all
                )
            else:
                images = [{"pageNumber": 1, "image": first_preview}]
                selection = {
                    "totalPages": 1,
                    "selectedPages": [1],
                    "skippedPhotoPages": [],
                    "mode": mode,
                    "version": "single-image-v1",
                }
            raw["pageSelection"] = selection
            result, evidence, _usage = certificate_ai.recognize(images, attachment_id, attempt["id"], batch)
            result["pageSelection"] = {
                key: selection[key] for key in ("totalPages", "selectedPages", "skippedPhotoPages", "mode")
            }
            raw.update(evidence, pageSelection=selection)
        except Exception as exc:
            error = (
                str(exc)
                if isinstance(exc, ValueError | certificate_files.CertificateUnavailableError)
                else "合格证识别暂不可用，请稍后重试"
            )
        with log_stage("reception_certificate_recognition", "save", component="reception"):
            with connect_db() as conn:
                begin_write(conn)
                repo.finish_run(conn, attempt["id"], now_iso(), result=result, raw=raw, error=error)
                saved = repo.run(conn, attempt["id"])
                audit(
                    conn,
                    actor,
                    "reception.certificate_recognition_failed" if error else "reception.certificate_recognized",
                    batch_id,
                    None,
                    run_view(saved),
                )
                conn.commit()
        return {"run": run_view(saved)}
    finally:
        _AI_SLOTS.release()
