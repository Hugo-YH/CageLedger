import json
import re
from http import HTTPStatus
from urllib.error import HTTPError, URLError
from urllib.parse import urlparse
from urllib.request import Request, urlopen

from server_app.config import (
    CAGELEDGER_APP_VERSION,
    CAGELEDGER_BRANCH,
    CAGELEDGER_CONTACT_EMAIL,
    CAGELEDGER_COPYRIGHT,
    CAGELEDGER_DEPARTMENT,
    CAGELEDGER_DEVELOPER,
    CAGELEDGER_GITEA_TOKEN,
    CAGELEDGER_LICENSE,
    CAGELEDGER_ORGANIZATION,
    CAGELEDGER_REPOSITORY_URL,
    CAGELEDGER_REVISION,
    CAGELEDGER_UPDATE_CHECK_ENABLED,
    ROOT,
)
from server_app.shared import now_iso


def system_update_status():
    current = current_revision()
    current_version = normalize_release_version(app_version())
    if not CAGELEDGER_UPDATE_CHECK_ENABLED:
        return {
            "repository": CAGELEDGER_REPOSITORY_URL,
            "repositoryUrl": CAGELEDGER_REPOSITORY_URL,
            "branch": CAGELEDGER_BRANCH,
            "appVersion": app_version(),
            "current": current or None,
            "currentShort": short_revision(current),
            "currentVersion": current_version or None,
            "latest": None,
            "latestShort": "",
            "latestVersion": None,
            "latestUrl": None,
            "latestMessage": None,
            "latestDate": None,
            "updateAvailable": None,
            "checkedAt": now_iso(),
            "disabled": True,
        }

    latest = latest_remote_release()
    latest_sha = latest.get("sha") or ""
    latest_version = normalize_release_version(latest.get("version"))
    update_available = None
    if current_version and latest_version:
        update_available = compare_release_versions(current_version, latest_version) < 0

    return {
        "repository": CAGELEDGER_REPOSITORY_URL,
        "repositoryUrl": CAGELEDGER_REPOSITORY_URL,
        "branch": CAGELEDGER_BRANCH,
        "appVersion": app_version(),
        "current": current or None,
        "currentShort": short_revision(current),
        "currentVersion": current_version or None,
        "latest": latest_sha or None,
        "latestShort": short_revision(latest_sha),
        "latestVersion": latest_version or None,
        "latestUrl": latest.get("url"),
        "latestMessage": latest.get("message"),
        "latestDate": latest.get("date"),
        "updateAvailable": update_available,
        "checkedAt": now_iso(),
    }


def system_info():
    return {
        "name": "CageLedger",
        "title": "CageLedger 实验动物笼位管理与计费系统",
        "description": "实验动物笼位管理与计费系统",
        "version": app_version(),
        "organization": CAGELEDGER_ORGANIZATION,
        "department": CAGELEDGER_DEPARTMENT,
        "developer": CAGELEDGER_DEVELOPER,
        "contactEmail": CAGELEDGER_CONTACT_EMAIL,
        "license": CAGELEDGER_LICENSE,
        "copyright": CAGELEDGER_COPYRIGHT,
        "repository": CAGELEDGER_REPOSITORY_URL,
        "repositoryUrl": CAGELEDGER_REPOSITORY_URL,
        "branch": CAGELEDGER_BRANCH,
        "revision": current_revision() or None,
        "revisionShort": short_revision(current_revision()),
    }


def app_version():
    if CAGELEDGER_APP_VERSION:
        return CAGELEDGER_APP_VERSION
    package_path = ROOT / "package.json"
    try:
        return json.loads(package_path.read_text(encoding="utf-8")).get("version", "")
    except (OSError, json.JSONDecodeError):
        return ""


def current_revision():
    if CAGELEDGER_REVISION:
        return CAGELEDGER_REVISION
    return read_git_revision(ROOT)


def read_git_revision(root):
    git_dir = root / ".git"
    if git_dir.is_file():
        content = git_dir.read_text(encoding="utf-8", errors="replace").strip()
        if content.startswith("gitdir:"):
            git_dir = (git_dir.parent / content.split(":", 1)[1].strip()).resolve()
    if not git_dir.exists():
        return ""

    head_path = git_dir / "HEAD"
    if not head_path.exists():
        return ""
    head = head_path.read_text(encoding="utf-8", errors="replace").strip()
    if head.startswith("ref:"):
        ref = head.split(":", 1)[1].strip()
        ref_path = git_dir / ref
        if ref_path.exists():
            return ref_path.read_text(encoding="utf-8", errors="replace").strip()
        packed_refs = git_dir / "packed-refs"
        if packed_refs.exists():
            for line in packed_refs.read_text(encoding="utf-8", errors="replace").splitlines():
                if not line or line.startswith("#") or line.startswith("^"):
                    continue
                sha, _, packed_ref = line.partition(" ")
                if packed_ref == ref:
                    return sha.strip()
        return ""
    return head


def latest_remote_release():
    repository = parse_gitea_repository_url(CAGELEDGER_REPOSITORY_URL)
    url = f"{repository['baseUrl']}/api/v1/repos/{repository['owner']}/{repository['repo']}/releases/latest"
    headers = {"Accept": "application/json", "User-Agent": "CageLedger"}
    if CAGELEDGER_GITEA_TOKEN:
        headers["Authorization"] = f"token {CAGELEDGER_GITEA_TOKEN}"
    request = Request(url, headers=headers)
    try:
        with urlopen(request, timeout=8) as response:
            payload = json.loads(response.read().decode("utf-8"))
    except HTTPError as exc:
        if exc.code in (HTTPStatus.UNAUTHORIZED, HTTPStatus.FORBIDDEN, HTTPStatus.NOT_FOUND):
            raise ValueError("Gitea 更新检查失败：请确认仓库地址正确，并为私有仓库配置只读 token") from exc
        raise ValueError(f"Gitea 返回错误：HTTP {exc.code}") from exc
    except URLError as exc:
        raise ValueError(f"无法连接 Gitea：{exc.reason}") from exc
    except TimeoutError as exc:
        raise ValueError("连接 Gitea 超时") from exc

    tag_name = str(payload.get("tag_name") or "").strip()
    if not tag_name:
        raise ValueError("Gitea 未返回可用发布版本")

    return {
        "sha": payload.get("target_commitish", ""),
        "version": tag_name,
        "url": payload.get("html_url", ""),
        "message": first_line(payload.get("name", "") or payload.get("body", "")),
        "date": payload.get("published_at") or payload.get("created_at") or "",
    }


def parse_gitea_repository_url(value):
    parsed = urlparse(str(value or "").strip())
    path_parts = [part for part in parsed.path.strip("/").split("/") if part]
    if parsed.scheme not in ("http", "https") or not parsed.netloc or len(path_parts) < 2:
        raise ValueError("项目仓库地址无效")

    owner = path_parts[-2]
    repo = path_parts[-1]
    if repo.endswith(".git"):
        repo = repo[:-4]
    if not owner or not repo:
        raise ValueError("项目仓库地址无效")

    return {
        "baseUrl": f"{parsed.scheme}://{parsed.netloc}",
        "owner": owner,
        "repo": repo,
    }


def revisions_match(current, latest):
    current = str(current or "").strip()
    latest = str(latest or "").strip()
    return bool(current and latest and (current.startswith(latest) or latest.startswith(current)))


def normalize_release_version(value):
    return str(value or "").strip().removeprefix("v")


def release_version_key(value):
    version = normalize_release_version(value)
    match = re.fullmatch(r"(\d+)\.(\d+)\.(\d+)([A-Za-z]*)(\d*)", version)
    if not match:
        return None
    major, minor, patch, suffix, suffix_number = match.groups()
    return (
        int(major),
        int(minor),
        int(patch),
        suffix or "",
        int(suffix_number) if suffix_number else -1,
    )


def compare_release_versions(left, right):
    left_key = release_version_key(left)
    right_key = release_version_key(right)
    if left_key is None or right_key is None:
        return (normalize_release_version(left) > normalize_release_version(right)) - (
            normalize_release_version(left) < normalize_release_version(right)
        )
    return (left_key > right_key) - (left_key < right_key)


def short_revision(value):
    value = str(value or "").strip()
    return value[:7] if value else None


def first_line(value):
    return str(value or "").splitlines()[0] if value else ""
