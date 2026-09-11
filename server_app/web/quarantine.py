"""Authenticated quarantine HTTP boundary; authorization is intentionally centralized."""

import sqlite3
from urllib.parse import parse_qs, urlparse

from server_app.config import QUARANTINE_FILES_PATH
from server_app.db import connect_db
from server_app.domains.quarantine import attachment_metadata, files, service, workflow
from server_app.domains.quarantine import repository as repo
from server_app.domains.quarantine.catalog import PROJECTS, TEMPLATE_VERSION
from server_app.domains.quarantine.documents import generate
from server_app.domains.quarantine.history import supplier_history
from server_app.shared.concurrency import StaleWriteError
from server_app.web.multipart import parse_multipart_upload
from server_app.web.request_body import read_body


def handle(handler, method, path):
    if not path.startswith("/api/quarantine/"):
        return False
    user = handler.require_user()
    if not user:
        return True
    parts = path.removeprefix("/api/quarantine/").split("/")
    params = {key: values[0] for key, values in parse_qs(urlparse(handler.path).query).items()}
    try:
        service.authorize(user)
        with connect_db() as conn:
            if method == "GET":
                payload = get(handler, conn, parts, params)
            else:
                payload = write(handler, conn, user, method, parts, params)
        if payload is not None:
            handler.send_json(payload)
    except StaleWriteError as exc:
        handler.send_json({"error": str(exc)}, 409)
    except LookupError as exc:
        handler.send_json({"error": str(exc)}, 404)
    except PermissionError as exc:
        handler.send_json({"error": str(exc)}, 403)
    except sqlite3.IntegrityError:
        handler.send_json({"error": "记录已存在，请刷新后查看"}, 409)
    except (ValueError, TypeError, KeyError) as exc:
        handler.send_json({"error": str(exc) or "检疫数据格式无效"}, 400)
    except OSError:
        handler.send_json({"error": "文件处理失败，未完成出具，请稍后重试"}, 500)
    return True


def get(handler, conn, parts, params):
    if parts == ["catalog"]:
        return {"projects": PROJECTS, "templateVersion": TEMPLATE_VERSION}
    if parts == ["supplier-options"]:
        return {"items": repo.supplier_options(conn)}
    if parts == ["batch-number"]:
        return {"batchNo": service.next_batch_number(conn, params.get("businessDate", ""))}
    if parts in (["sources"], ["batches"]):
        return repo.list_page(conn, parts[0], params)
    if len(parts) == 2 and parts[0] == "batches":
        return service.batch_detail(conn, parts[1])
    if parts == ["suppliers"]:
        return {"items": supplier_history(conn, params)}
    if len(parts) == 2 and parts[0] in {"attachments", "reports"}:
        item = repo.get(conn, parts[0], parts[1])
        if parts[0] == "attachments" and params.get("preview") == "1" and item["mime"].startswith("image/"):
            content, mime = files.preview(item, QUARANTINE_FILES_PATH)
            handler.send_download(content, "preview.png" if mime == "image/png" else item["name"], mime)
            return None
        name = item["name"] if parts[0] == "attachments" else item["number"] + ".docx"
        handler.send_download(
            (QUARANTINE_FILES_PATH / item["storageName"]).read_bytes(), name, item.get("mime", files.DOCX_MIME)
        )
        return None
    if len(parts) == 3 and parts[0] == "tests" and parts[2] == "preview":
        test = repo.get(conn, "tests", parts[1])
        data = generate(files.snapshot(conn, test), QUARANTINE_FILES_PATH, draft=True)
        handler.send_download(data, "检疫报告-草稿.docx", files.DOCX_MIME)
        return None
    raise LookupError("接口不存在")


def write(handler, conn, user, method, parts, params):
    if method == "POST" and len(parts) == 3 and parts[0] == "tests" and parts[2] == "attachments":
        name, content = parse_multipart_upload(
            handler.headers.get("Content-Type", ""), read_body(handler.headers, handler.rfile)
        )
        return files.upload(conn, user, parts[1], params, name, content, QUARANTINE_FILES_PATH)
    body = handler.read_json_body()
    if method == "PUT" and len(parts) == 2 and parts[0] == "attachments":
        return attachment_metadata.update(conn, user, parts[1], body)
    if method == "DELETE" and len(parts) == 2 and parts[0] == "batches":
        return {"item": service.delete_batch(conn, user, parts[1], body)}
    if method == "POST" and len(parts) == 3 and parts[0] == "batches" and parts[2] == "complete":
        return {"item": workflow.complete(conn, user, parts[1], body)}
    if parts[0] in {"batches", "tests"} and (
        (method == "POST" and len(parts) == 1) or (method == "PUT" and len(parts) == 2)
    ):
        operation = service.save_batch if parts[0] == "batches" else service.save_test
        return {"item": operation(conn, user, body, parts[1] if len(parts) == 2 else None)}
    if method == "POST" and len(parts) == 3 and parts[0] == "tests":
        if parts[2] == "issue":
            return {"item": files.issue(conn, user, parts[1], body, QUARANTINE_FILES_PATH)}
        if parts[2] in {"correction", "retest"}:
            return {"item": service.clone_test(conn, user, parts[1], body, retest=parts[2] == "retest")}
    raise LookupError("接口不存在")
