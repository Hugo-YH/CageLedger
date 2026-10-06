"""Validated screenshots, immutable local files, and authenticated downloads."""

import hashlib
import io
import os
from pathlib import Path
from uuid import uuid4

from PIL import Image, UnidentifiedImageError

from server_app.shared import now_iso

from . import repository as repo
from . import service

MAX_BYTES = 10 * 1024 * 1024
FORMATS = {"PNG": ("image/png", ".png"), "JPEG": ("image/jpeg", ".jpg"), "WEBP": ("image/webp", ".webp")}


def validate(content):
    if not content or len(content) > MAX_BYTES:
        raise ValueError("每张截图必须在 10MiB 以内")
    try:
        with Image.open(io.BytesIO(content)) as image:
            if (
                image.format not in FORMATS
                or image.width * image.height > 40_000_000
                or getattr(image, "n_frames", 1) != 1
            ):
                raise ValueError("仅支持单帧 PNG、JPEG、WebP 截图，尺寸过大或格式无效")
            detected = FORMATS[image.format]
            image.verify()
        # verify alone does not decode pixel data; decode to reject truncated screenshots.
        with Image.open(io.BytesIO(content)) as image:
            image.load()
        return detected
    except (UnidentifiedImageError, OSError, SyntaxError, Image.DecompressionBombError) as exc:
        raise ValueError("截图内容无效") from exc


def store(root, name, content):
    root = Path(root)
    root.mkdir(parents=True, exist_ok=True)
    temporary = root / (str(uuid4()) + ".tmp")
    try:
        temporary.write_bytes(content)
        os.replace(temporary, root / name)
    finally:
        temporary.unlink(missing_ok=True)


def upload(conn, user, feedback_id, params, name, content, root):
    identity = service.request_id(params)
    mime, suffix = validate(content)
    name = service.text(Path(name.replace("\\", "/")).name, 200, True)
    if any(ord(character) < 32 or ord(character) == 127 for character in name):
        raise ValueError("截图文件名无效")
    comment_id = params.get("commentId") or None
    signature = service.digest([feedback_id, comment_id, name, hashlib.sha256(content).hexdigest()])
    conn.execute("BEGIN IMMEDIATE")
    feedback = repo.get(conn, feedback_id)
    service.require_active(feedback)
    if comment_id:
        parent = conn.execute(
            "SELECT * FROM feedback_comments WHERE id=? AND feedback_id=?", (comment_id, feedback_id)
        ).fetchone()
        if not parent or parent["actor_id"] != user["id"] or parent["source"] != "local" or not parent["visible"]:
            raise PermissionError("只能为本人公开补充上传截图")
    elif feedback["actor_id"] != user["id"]:
        raise PermissionError("请通过追加补充上传截图")
    existing = conn.execute(
        "SELECT * FROM feedback_attachments WHERE actor_id=? AND request_id=?", (user["id"], identity)
    ).fetchone()
    if existing:
        if existing["request_hash"] != signature:
            raise ValueError("同一请求标识不能用于不同附件")
        return service.attachment(existing)
    count = conn.execute(
        "SELECT COUNT(*) FROM feedback_attachments WHERE feedback_id=? AND comment_id IS ? AND source='local'",
        (feedback_id, comment_id),
    ).fetchone()[0]
    if count >= 5:
        raise ValueError("每次反馈或补充最多上传五张截图")
    attachment_id = str(uuid4())
    storage = attachment_id + suffix
    store(root, storage, content)
    try:
        conn.execute(
            """INSERT INTO feedback_attachments(id,feedback_id,comment_id,actor_id,request_id,request_hash,
               name,mime,size,storage_name,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)""",
            (
                attachment_id,
                feedback_id,
                comment_id,
                user["id"],
                identity,
                signature,
                name,
                mime,
                len(content),
                storage,
                now_iso(),
            ),
        )
        repo.enqueue(conn, feedback_id, "asset", attachment_id)
        service.audit(
            conn, user, "attachment.created", feedback_id, after={"attachmentId": attachment_id, "name": name}
        )
    except BaseException:
        (Path(root) / storage).unlink(missing_ok=True)
        raise
    return service.attachment(
        conn.execute("SELECT * FROM feedback_attachments WHERE id=?", (attachment_id,)).fetchone()
    )


def accessible(conn, attachment_id):
    row = conn.execute(
        """SELECT a.* FROM feedback_attachments a JOIN feedback f ON f.id=a.feedback_id
           LEFT JOIN feedback_comments c ON c.id=a.comment_id
           WHERE a.id=? AND f.status!='deleted' AND a.visible=1 AND (a.comment_id IS NULL OR c.visible=1)""",
        (attachment_id,),
    ).fetchone()
    if not row:
        raise LookupError("附件不存在或已隐藏")
    return dict(row)
