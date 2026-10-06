"""Feedback HTTP boundary: every endpoint is authenticated; administration is role checked."""

import sqlite3
from pathlib import Path
from urllib.parse import parse_qs, urlparse

from server_app.config import CAGELEDGER_GITEA_TOKEN, CAGELEDGER_REPOSITORY_URL, FEEDBACK_FILES_PATH
from server_app.db import connect_db
from server_app.domains.feedback import files, importer, repository, service
from server_app.domains.feedback.gitea import Client, RemoteError
from server_app.web.multipart import parse_multipart_upload
from server_app.web.request_body import read_body


def handle(handler, method, path):
    if path != "/api/feedback" and not path.startswith("/api/feedback/"):
        return False
    user = handler.require_user()
    if not user:
        return True
    parts = path.removeprefix("/api/feedback").strip("/").split("/") if path != "/api/feedback" else []
    params = {key: value[0] for key, value in parse_qs(urlparse(handler.path).query).items()}
    try:
        if method == "GET" and len(parts) == 2 and parts[0] == "attachments":
            download(handler, parts[1])
            return True
        with connect_db() as conn:
            payload = dispatch(handler, conn, user, method, parts, params)
        handler.send_json(payload)
    except LookupError as exc:
        handler.send_json({"error": str(exc)}, 404)
    except PermissionError as exc:
        handler.send_json({"error": str(exc)}, 403)
    except sqlite3.IntegrityError:
        handler.send_json({"error": "请求已存在，请刷新后查看"}, 409)
    except (ValueError, TypeError, KeyError) as exc:
        handler.send_json({"error": str(exc) or "反馈数据无效"}, 400)
    except RemoteError as exc:
        handler.send_json({"error": str(exc)}, 503)
    except OSError:
        handler.send_json({"error": "截图文件处理失败，请稍后重试"}, 500)
    return True


def dispatch(handler, conn, user, method, parts, params):
    if method == "GET":
        if not parts:
            return service.list_page(conn, user, params)
        if parts == ["integration"]:
            return service.integration(conn, user)
        if parts == ["filter-options"]:
            return service.filter_options(conn, user, params)
        if parts == ["import", "preview"]:
            return importer.preview(conn, user, params)
        if len(parts) == 1:
            return service.detail(conn, user, parts[0])
    if method == "POST" and parts == ["import"]:
        return importer.import_selected(conn, user, handler.read_json_body())
    if method == "POST" and len(parts) == 2 and parts[1] == "attachments":
        name, content = parse_multipart_upload(
            handler.headers.get("Content-Type", ""), read_body(handler.headers, handler.rfile)
        )
        return {"item": files.upload(conn, user, parts[0], params, name, content, FEEDBACK_FILES_PATH)}
    if method == "POST" and not parts:
        return {"item": service.create(conn, user, handler.read_json_body())}
    if len(parts) == 2:
        feedback_id, operation = parts
        if method == "POST" and operation == "comments":
            return {"item": service.supplement(conn, user, feedback_id, handler.read_json_body())}
        if method == "PUT" and operation == "encounter":
            return {"item": service.encounter(conn, user, feedback_id, handler.read_json_body())}
        if method == "POST" and operation == "sync":
            return service.queue_refresh(conn, feedback_id)
        if method == "POST" and operation == "retry":
            return service.retry(conn, user, feedback_id)
    raise LookupError("反馈接口不存在")


def download(handler, attachment_id):
    with connect_db() as conn:
        item = files.accessible(conn, attachment_id)
        feedback = repository.get(conn, item["feedback_id"])
        comment = (
            conn.execute("SELECT * FROM feedback_comments WHERE id=?", (item["comment_id"],)).fetchone()
            if item["comment_id"]
            else None
        )
    if item["source"] == "gitea":
        if (
            feedback["repository"] != CAGELEDGER_REPOSITORY_URL.rstrip("/").removesuffix(".git")
            or not CAGELEDGER_GITEA_TOKEN
        ):
            raise RemoteError("共享仓库配置不可用于该历史附件", permanent=True)
        client = Client(CAGELEDGER_REPOSITORY_URL, CAGELEDGER_GITEA_TOKEN)
        # Recheck privacy even if the local projection is between periodic syncs.
        parent_path = f"/issues/comments/{comment['remote_id']}" if comment else f"/issues/{feedback['issue_number']}"
        parent = client.request("GET", parent_path)
        if parent.get("body", "").lstrip().startswith("【内部】"):
            with connect_db() as conn:
                if comment:
                    conn.execute("UPDATE feedback_comments SET visible=0 WHERE id=?", (comment["id"],))
                else:
                    conn.execute(
                        "UPDATE feedback_attachments SET visible=0 WHERE feedback_id=? AND comment_id IS NULL AND source='gitea'",
                        (feedback["id"],),
                    )
            raise LookupError("附件已隐藏")
        metadata = client.request("GET", f"{parent_path}/assets/{item['remote_id']}")
        content = client.download_asset(metadata.get("browser_download_url", ""))
        mime, suffix = files.validate(content)
        storage = attachment_id + suffix
        files.store(FEEDBACK_FILES_PATH, storage, content)
        with connect_db() as conn:
            files.accessible(conn, attachment_id)
            conn.execute(
                "UPDATE feedback_attachments SET storage_name=?,mime=?,size=? WHERE id=?",
                (storage, mime, len(content), attachment_id),
            )
    else:
        content = (Path(FEEDBACK_FILES_PATH) / item["storage_name"]).read_bytes()
        mime = item["mime"]
    handler.send_download(content, item["name"], mime)
