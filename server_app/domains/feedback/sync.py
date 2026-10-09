"""Remote state projection and idempotent outbox operations."""

import json
import re
from pathlib import Path
from uuid import uuid4

from server_app.domains.administration.audit import audit_event, write_audit_events
from server_app.shared import now_iso

from . import repository as repo
from .diagnostics import markdown as diagnostics_markdown
from .gitea import RemoteError

LABELS = {
    "反馈/待处理": "pending",
    "反馈/处理中": "in_progress",
    "反馈/待验证": "verification",
    "反馈/已解决": "resolved",
}


def status(issue):
    labels = {item.get("name") for item in issue.get("labels", [])}
    if issue.get("state") == "closed":
        return "resolved" if "反馈/已解决" in labels else "closed"
    workflow = labels.intersection(LABELS)
    if len(workflow) > 1:
        return "conflict"
    label = next(iter(workflow), "反馈/待处理")
    return "pending" if label == "反馈/已解决" else LABELS[label]


def marker(kind, entity_id):
    return f"<!-- cageledger-{kind}:{entity_id} -->"


def without_markers(body):
    return re.sub(r"<!-- cageledger-(?:feedback|comment|encounters):[A-Za-z0-9-]+ -->", "", body).strip()


def unique_match(items, token):
    found = [item for item in items if item.get("body", "").split("\n", 1)[0].strip() == token]
    if len(found) > 1:
        raise RemoteError("远端存在多个相同反馈标识，请管理员检查", permanent=True, uncertain=True)
    return found[0] if found else None


def issue_body(feedback):
    user = json.loads(feedback["author"])
    environment = json.loads(feedback["environment"])
    context = "\n".join(f"- {key}: {value}" for key, value in environment.items() if key != "diagnostics")
    return (
        f"{marker('feedback', feedback['id'])}\n"
        f"CageLedger 反馈 #{feedback['number']}\n\n"
        f"提交人：{user['name']}\n类型：{feedback['kind']}\n模块：{feedback['module']}\n"
        f"提交时间：{feedback['created_at']}\n\n{feedback['description']}\n\n环境信息\n{context}"
        f"{diagnostics_markdown(environment.get('diagnostics'))}"
    )


def asset_path(feedback, comment=None):
    if comment:
        return f"/issues/comments/{comment['remote_id']}/assets"
    return f"/issues/{feedback['issue_number']}/assets"


def perform(client, task, feedback, entity, root):
    """Return a remote result without touching SQLite. Ambiguous POSTs only reconcile."""
    kind = task["kind"]
    if feedback["status"] == "deleted":
        return {"deleted": True}
    if kind == "create":
        if feedback["issue_number"]:
            return {"number": feedback["issue_number"], "html_url": feedback["issue_url"]}
        if task["uncertain"]:
            found = unique_match(client.pages("/issues?state=all&type=issues"), marker("feedback", feedback["id"]))
            if found:
                return found
            raise RemoteError(
                "建单结果不确定，未找到远端标识；请管理员核实，系统不会重复建单", permanent=True, uncertain=True
            )
        return client.request("POST", "/issues", {"title": feedback["title"], "body": issue_body(feedback)})
    if not feedback["issue_number"]:
        raise RemoteError("等待工单创建")
    if kind == "comment":
        if entity["remote_id"]:
            return {"id": entity["remote_id"]}
        if task["uncertain"]:
            found = unique_match(
                client.pages(f"/issues/{feedback['issue_number']}/comments"), marker("comment", entity["id"])
            )
            if found:
                return found
            raise RemoteError("补充同步结果不确定，请管理员核实远端标识", permanent=True, uncertain=True)
        body = f"{marker('comment', entity['id'])}\n{json.loads(entity['author'])['name']} 补充：\n\n{entity['body']}"
        return client.request("POST", f"/issues/{feedback['issue_number']}/comments", {"body": body})
    if kind == "encounters":
        body = f"{marker('encounters', feedback['id'])}\n我也遇到了：{entity['count']} 人（CageLedger 统计）"
        remote_id = task["remote_id"]
        if not remote_id:
            found = unique_match(
                client.pages(f"/issues/{feedback['issue_number']}/comments"), marker("encounters", feedback["id"])
            )
            remote_id = found["id"] if found else None
        if remote_id:
            result = client.request("PATCH", f"/issues/comments/{remote_id}", {"body": body})
            return {**result, "id": remote_id}
        if task["uncertain"]:
            raise RemoteError("统计评论同步结果不确定，请管理员核实", permanent=True, uncertain=True)
        return client.request("POST", f"/issues/{feedback['issue_number']}/comments", {"body": body})
    if kind == "asset":
        if entity["remote_id"]:
            return {"id": entity["remote_id"]}
        comment = entity.get("comment")
        if comment and not comment["remote_id"]:
            raise RemoteError("等待补充同步")
        path = asset_path(feedback, comment)
        filename = entity["id"] + Path(entity["storage_name"]).suffix
        if task["uncertain"]:
            found = [item for item in client.pages(path) if item.get("name") == filename]
            if len(found) == 1:
                return found[0]
            raise RemoteError("附件同步结果不确定，请管理员核实", permanent=True, uncertain=True)
        return client.upload(path, filename, (Path(root) / entity["storage_name"]).read_bytes(), entity["mime"])
    if kind == "refresh":
        return read_remote(client, feedback)
    raise RemoteError("未知反馈同步任务", permanent=True)


def confirmed_deleted(client, feedback):
    """A resource 404 alone is insufficient: repository and issue listing must remain accessible."""
    try:
        client.request("GET", f"/issues/{feedback['issue_number']}")
        return False
    except RemoteError as exc:
        if exc.http_status != 404:
            raise
    repository = client.request("GET", "")
    if repository.get("has_issues") is False:
        raise RemoteError("仓库工单功能不可访问，请管理员检查", permanent=True)
    issues = client.pages("/issues?state=all&type=issues")
    return not any(issue.get("number") == feedback["issue_number"] for issue in issues)


def read_remote(client, feedback, *, issue=None):
    if issue is None:
        issue = client.request("GET", f"/issues/{feedback['issue_number']}")
    comments = client.pages(f"/issues/{feedback['issue_number']}/comments")
    public = []
    for item in comments:
        body = item.get("body", "")
        if body.lstrip().startswith("【内部】") or marker("encounters", feedback["id"]) in body:
            continue
        # Do not fetch internal attachment metadata or bodies into the system projection.
        item = {**item, "assets": client.pages(f"/issues/comments/{item['id']}/assets")}
        public.append(item)
    assets = []
    if feedback.get("source") == "gitea" and not (issue.get("body") or "").lstrip().startswith("【内部】"):
        assets = client.pages(f"/issues/{feedback['issue_number']}/assets")
    return {"issue": issue, "comments": public, "assets": assets}


def apply(conn, task, feedback, result):
    before = {key: feedback[key] for key in ("status", "issue_number", "assignees", "fix_version")}
    kind = task["kind"]
    if result.get("deleted"):
        conn.execute(
            "UPDATE feedback SET status='deleted',last_synced_at=?,updated_at=?,version=version+1 WHERE id=?",
            (now_iso(), now_iso(), feedback["id"]),
        )
        # Retain deletion/idempotency metadata. No feedback content remains accessible through the API.
        conn.execute(
            "UPDATE feedback_comments SET remote_body=NULL WHERE feedback_id=? AND source='local'",
            (feedback["id"],),
        )
        conn.execute("UPDATE feedback_comments SET visible=0 WHERE feedback_id=?", (feedback["id"],))
        conn.execute("UPDATE feedback_attachments SET visible=0 WHERE feedback_id=?", (feedback["id"],))
        conn.execute(
            "UPDATE feedback_tasks SET state='done',error='',uncertain=0,attempts=0 WHERE feedback_id=?",
            (feedback["id"],),
        )
    elif kind == "create":
        if not isinstance(result.get("number"), int):
            raise RemoteError("Gitea 建单响应无效", permanent=True, uncertain=True)
        conn.execute(
            "UPDATE feedback SET issue_number=?,issue_url=? WHERE id=?",
            (result["number"], f"{feedback['repository']}/issues/{result['number']}", feedback["id"]),
        )
        repo.enqueue(conn, feedback["id"], "refresh")
    elif kind in {"comment", "asset", "encounters"}:
        if not isinstance(result.get("id"), int):
            raise RemoteError("Gitea 写入响应无效", permanent=True, uncertain=True)
        if kind == "comment":
            conn.execute("UPDATE feedback_comments SET remote_id=? WHERE id=?", (result["id"], task["entity_id"]))
        elif kind == "asset":
            conn.execute("UPDATE feedback_attachments SET remote_id=? WHERE id=?", (result["id"], task["entity_id"]))
        else:
            conn.execute("UPDATE feedback_tasks SET remote_id=? WHERE id=?", (result["id"], task["id"]))
        repo.enqueue(conn, feedback["id"], "refresh")
    elif kind == "refresh":
        project_remote(conn, feedback, result)
    after = repo.get(conn, feedback["id"])
    summary = {key: after[key] for key in before}
    if before != summary:
        actor = {"id": "feedback-sync", "username": "feedback-sync", "displayName": "反馈同步服务"}
        write_audit_events(
            conn,
            [
                audit_event(
                    actor,
                    "feedback.deleted" if result.get("deleted") else "feedback.synchronized",
                    "feedback",
                    feedback["id"],
                    "远端工单删除，同步移除反馈" if result.get("deleted") else "同步反馈工单进展",
                    [],
                    now_iso(),
                    before,
                    summary,
                )
            ],
        )


def project_remote(conn, feedback, remote):
    issue = remote["issue"]
    assigned = [user.get("full_name") or user.get("login", "") for user in issue.get("assignees") or []]
    milestone = issue.get("milestone") or {}
    conn.execute(
        "UPDATE feedback SET status=?,assignees=?,fix_version=?,last_synced_at=?,version=version+1 WHERE id=?",
        (status(issue), repo.encode(assigned), milestone.get("title", ""), now_iso(), feedback["id"]),
    )
    if feedback.get("source") == "gitea":
        project_assets(conn, feedback["id"], None, remote.get("assets", []))
    conn.execute(
        "UPDATE feedback_comments SET visible=0 WHERE feedback_id=? AND remote_id IS NOT NULL", (feedback["id"],)
    )
    for item in remote["comments"]:
        row = conn.execute(
            "SELECT id FROM feedback_comments WHERE feedback_id=? AND remote_id=?", (feedback["id"], item["id"])
        ).fetchone()
        comment_id = row["id"] if row else str(uuid4())
        body = without_markers(item.get("body", ""))
        user = item.get("user") or {}
        if row:
            conn.execute(
                "UPDATE feedback_comments SET remote_body=?,updated_at=?,visible=1 WHERE id=?",
                (body, item.get("updated_at", ""), comment_id),
            )
        else:
            conn.execute(
                """INSERT INTO feedback_comments(id,feedback_id,body,author,source,created_at,updated_at,remote_id)
                   VALUES(?,?,?,?,'gitea',?,?,?)""",
                (
                    comment_id,
                    feedback["id"],
                    body,
                    repo.encode({"name": user.get("full_name") or user.get("login", "开发团队")}),
                    item.get("created_at", ""),
                    item.get("updated_at", ""),
                    item["id"],
                ),
            )
        project_assets(conn, feedback["id"], comment_id, item.get("assets", []))


def project_assets(conn, feedback_id, comment_id, assets):
    conn.execute(
        "UPDATE feedback_attachments SET visible=0 WHERE feedback_id=? AND comment_id IS ? AND source='gitea'",
        (feedback_id, comment_id),
    )
    for asset in assets:
        size, name = asset.get("size", 0), asset.get("name", "")
        if (
            not isinstance(size, int)
            or not 0 < size <= 10 * 1024 * 1024
            or Path(name).suffix.lower() not in {".png", ".jpg", ".jpeg", ".webp"}
        ):
            continue
        attachment = conn.execute(
            "SELECT id FROM feedback_attachments WHERE feedback_id=? AND comment_id IS ? AND remote_id=?",
            (feedback_id, comment_id, asset["id"]),
        ).fetchone()
        if attachment:
            conn.execute("UPDATE feedback_attachments SET visible=1 WHERE id=?", (attachment["id"],))
        else:
            attachment_id = str(uuid4())
            conn.execute(
                """INSERT INTO feedback_attachments(id,feedback_id,comment_id,actor_id,request_id,request_hash,
                       name,mime,size,storage_name,remote_id,remote_url,source,created_at)
                       VALUES(?,?,?,'',?,? ,?,'image/png',?,'',?,?,'gitea',?)""",
                (
                    attachment_id,
                    feedback_id,
                    comment_id,
                    attachment_id,
                    attachment_id,
                    "".join(character for character in name[:200] if ord(character) >= 32 and ord(character) != 127),
                    size,
                    asset["id"],
                    asset.get("browser_download_url", ""),
                    now_iso(),
                ),
            )
