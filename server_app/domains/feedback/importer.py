"""Administrator-controlled historical import; never writes to Gitea.

Remote reads precede each short write transaction. Repository/issue identity and
durable per-request results make retries and concurrent administrators safe.
"""

import json
import re
from datetime import datetime
from urllib.parse import urlencode
from uuid import uuid4

from server_app.shared import now_iso

from . import repository as repo
from . import service, sync
from .gitea import Client, RemoteError


def configured(user):
    service.admin(user)
    if not service.CAGELEDGER_GITEA_TOKEN:
        raise ValueError("请先配置检查更新共用的 Gitea Token")
    return Client(service.CAGELEDGER_REPOSITORY_URL, service.CAGELEDGER_GITEA_TOKEN)


def field(body, name):
    match = re.search(rf"(?m)^\s*(?:-\s*)?{name}[：:]\s*([^\n]+)", body)
    return match.group(1).strip() if match else ""


def summary(issue):
    body = issue.get("body") or ""
    title = issue.get("title") or ""
    remote_user = issue.get("user") or {}
    reporter = field(body, "提出人")
    if not reporter and (match := re.search(r"[@＠]\s*([^@＠\s]+)", title)):
        reporter = match.group(1)
    reporter_source = "record" if reporter else "gitea"
    if not reporter:
        reporter = remote_user.get("full_name") or remote_user.get("login") or "未注明"
    labels = {item.get("name") for item in issue.get("labels") or []}
    kind_text = field(body, "类型")
    kind = (
        "bug"
        if "故障" in labels or "故障" in kind_text
        else "question"
        if "使用疑问" in labels or "使用疑问" in kind_text
        else "suggestion"
    )
    module = field(body, "涉及模块") or field(body, "模块")
    if not module and (match := re.match(r"\[([^\]]+)\]", title)):
        module = match.group(1)
    return {
        "number": issue["number"],
        "title": title,
        "kind": kind,
        "module": module or "未分类",
        "reporter": reporter,
        "reporterSource": reporter_source,
        "state": issue.get("state", "open"),
        "status": sync.status(issue),
        "createdAt": issue.get("created_at", ""),
    }


def exclusion(issue):
    if issue.get("pull_request") is not None:
        return "合并请求不能导入"
    body = issue.get("body") or ""
    if body.lstrip().startswith("【内部】"):
        return "内部工单不能导入"
    if re.search(r"<!--\s*cageledger-feedback:", body):
        return "由系统创建的工单请使用原反馈同步，不能重复导入"
    return ""


def preview(conn, user, params):
    client = configured(user)
    state = params.get("state", "all")
    page = int(params.get("page", 1))
    if state not in {"all", "open", "closed"} or not 1 <= page <= 10000:
        raise ValueError("工单预览范围无效")
    issues = client.request(
        "GET", "/issues?" + urlencode({"state": state, "type": "issues", "limit": 20, "page": page})
    )
    if not isinstance(issues, list):
        raise RemoteError("Gitea 工单列表响应无效", permanent=True)
    items = []
    for issue in issues:
        if not isinstance(issue, dict) or type(issue.get("number")) is not int:
            raise RemoteError("Gitea 工单响应无效", permanent=True)
        reason = exclusion(issue)
        item = (
            summary(issue)
            if reason != "内部工单不能导入"
            else {
                "number": issue["number"],
                "title": "内部工单",
                "kind": "suggestion",
                "module": "",
                "reporter": "",
                "reporterSource": "gitea",
                "status": "pending",
                "createdAt": "",
                "state": issue.get("state", "open"),
            }
        )
        if existing := repo.linked_issue(conn, client.repository, issue["number"]):
            reason = "已从系统删除，不能重新导入" if existing["status"] == "deleted" else "已关联到系统反馈"
        items.append({**item, "importable": not reason, "reason": reason})
    return {"repository": client.repository, "items": items, "page": page, "hasMore": len(issues) == 20}


def timestamp(value):
    if not isinstance(value, str) or not value:
        raise ValueError("工单缺少原始时间，无法导入")
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00")).isoformat()
    except ValueError as exc:
        raise ValueError("工单时间格式无效") from exc


def import_one(conn, user, client, number):
    # Re-check after fetching: preview data never authorizes stale or different objects.
    if existing := repo.linked_issue(conn, client.repository, number):
        return {
            "number": number,
            "outcome": "skipped",
            "feedbackId": existing["id"] if existing["status"] != "deleted" else "",
            "message": "已关联或已删除，未重复导入",
        }
    feedback_id = str(uuid4())
    issue = client.request("GET", f"/issues/{number}")
    if type(issue.get("number")) is not int or issue["number"] != number:
        raise ValueError("远端工单编号不匹配")
    if reason := exclusion(issue):
        return {"number": number, "outcome": "skipped", "message": reason}
    remote = sync.read_remote(client, {"id": feedback_id, "issue_number": number, "source": "gitea"}, issue=issue)
    item = summary(issue)
    title = service.text(item["title"], 200, True)
    description = service.text(issue.get("body") or "（原工单未填写描述，请查看讨论记录）", 20000, True)
    reporter = service.text(item["reporter"], 200, True)
    module = service.text(item["module"], 100, True)
    created_at = timestamp(issue.get("created_at"))
    updated_at = timestamp(issue.get("updated_at"))
    actor = "gitea:" + service.digest([client.repository, reporter])[:32]
    metadata = {
        "importedBy": service.author(user),
        "importedAt": now_iso(),
        "reporterSource": item["reporterSource"],
        "giteaAuthor": (issue.get("user") or {}).get("login", ""),
    }
    conn.execute("BEGIN IMMEDIATE")
    try:
        # Serializes concurrent import requests without holding a lock during HTTP calls.
        if existing := repo.linked_issue(conn, client.repository, number):
            conn.commit()
            return {"number": number, "outcome": "skipped", "message": "已关联或已删除，未重复导入"}
        repo.insert_imported(
            conn,
            (
                feedback_id,
                actor,
                f"import-{number}",
                service.digest([client.repository, number]),
                title,
                item["kind"],
                module,
                description,
                repo.encode({"id": actor, "name": reporter}),
                repo.encode({"appVersion": "", "build": "", "page": "", "browser": ""}),
                created_at,
                updated_at,
                client.repository,
                number,
                f"{client.repository}/issues/{number}",
                repo.encode(metadata),
            ),
        )
        sync.project_remote(conn, repo.get(conn, feedback_id), remote)
        service.audit(
            conn,
            user,
            "imported",
            feedback_id,
            after={"repository": client.repository, "issueNumber": number, "reporter": reporter},
        )
        conn.commit()
    except BaseException:
        conn.rollback()
        raise
    return {"number": number, "outcome": "imported", "feedbackId": feedback_id, "message": "已导入并关联原工单"}


def import_selected(conn, user, body):
    client = configured(user)
    identity = service.request_id(body)
    numbers = body.get("numbers")
    if (
        not isinstance(numbers, list)
        or not 1 <= len(numbers) <= 10
        or any(type(number) is not int or not 1 <= number <= 2147483647 for number in numbers)
        or len(set(numbers)) != len(numbers)
    ):
        raise ValueError("每次请选择 1 至 10 个不同工单")
    if body.get("repository") != client.repository:
        raise ValueError("共享仓库已变化，请重新预览工单")
    signature = service.digest([client.repository, sorted(numbers)])
    conn.execute("BEGIN IMMEDIATE")
    previous = repo.import_request(conn, user["id"], identity)
    if previous and previous["request_hash"] != signature:
        conn.rollback()
        raise ValueError("同一请求标识不能用于不同导入范围")
    if not previous:
        repo.create_import_request(conn, user["id"], identity, signature, now_iso())
    conn.commit()
    results = json.loads(previous["results"]) if previous else {}
    for number in numbers:
        key = str(number)
        if key in results:
            continue
        try:
            if client.auth_blocked:
                raise RemoteError("Gitea 凭据或工单权限不足，请处理后重试", permanent=True)
            result = import_one(conn, user, client, number)
        except (RemoteError, ValueError) as exc:
            result = {"number": number, "outcome": "failed", "message": str(exc)}
        # Merge, rather than overwrite, results of simultaneous replay requests.
        conn.execute("BEGIN IMMEDIATE")
        stored = repo.merge_import_result(conn, user["id"], identity, number, result)
        conn.commit()
        results.update(stored)
    return {"items": [results[str(number)] for number in numbers]}
