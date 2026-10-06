"""Bounded Gitea API client sharing update-check configuration. Never logs credentials."""

import errno
import json
import socket
import ssl
from urllib.error import HTTPError, URLError
from urllib.parse import quote, urlparse
from urllib.request import HTTPRedirectHandler, Request, build_opener
from uuid import uuid4

from server_app.domains.administration.system import parse_gitea_repository_url


class RemoteError(Exception):
    def __init__(self, message, *, permanent=False, uncertain=False, http_status=None):
        super().__init__(message)
        self.permanent = permanent
        self.uncertain = uncertain
        self.http_status = http_status


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


class Client:
    def __init__(self, repository, token):
        parsed = urlparse(repository)
        if (
            parsed.scheme not in {"http", "https"}
            or parsed.username
            or parsed.password
            or parsed.query
            or parsed.fragment
        ):
            raise ValueError("共享仓库地址无效")
        target = parse_gitea_repository_url(repository)
        base, owner, name = target["baseUrl"], target["owner"], target["repo"]
        if not base or not owner or not name:
            raise ValueError("共享仓库地址无效")
        self.repository = repository.rstrip("/").removesuffix(".git")
        self.base = base.rstrip("/")
        self.api = f"{self.base}/api/v1/repos/{quote(owner, safe='')}/{quote(name, safe='')}"
        self.token = token
        self.auth_blocked = False
        self.opener = build_opener(NoRedirect())

    def request(self, method, path, body=None, *, raw=None, content_type="application/json", binary=False):
        headers = {"Accept": "application/json", "Authorization": "token " + self.token}
        data = raw if raw is not None else json.dumps(body).encode() if body is not None else None
        if data is not None:
            headers["Content-Type"] = content_type
        request = Request(self.api + path, data=data, headers=headers, method=method)
        try:
            with self.opener.open(request, timeout=10) as response:
                limit = 10 * 1024 * 1024 if binary else 4 * 1024 * 1024
                payload = response.read(limit + 1)
                if len(payload) > limit:
                    raise RemoteError("Gitea 响应过大，请管理员检查", permanent=True)
                return payload if binary else json.loads(payload or b"{}")
        except HTTPError as exc:
            exc.close()
            if exc.code in (401, 403):
                self.auth_blocked = True
                raise RemoteError(
                    "Gitea 凭据或工单权限不足；需 read:repository、write:issue 及仓库访问权限", permanent=True
                ) from None
            if 300 <= exc.code < 400:
                raise RemoteError("Gitea 地址发生重定向，请检查共享仓库地址", permanent=True) from None
            if exc.code in (400, 404, 422):
                raise RemoteError(
                    "Gitea 工单或附件不可访问，请检查仓库、工单及权限", permanent=True, http_status=exc.code
                ) from None
            raise RemoteError("Gitea 服务暂不可用", uncertain=method == "POST" and exc.code >= 500) from None
        except (URLError, TimeoutError, OSError) as exc:
            reason = exc.reason if isinstance(exc, URLError) else exc
            not_connected = isinstance(
                reason, ConnectionRefusedError | socket.gaierror | ssl.SSLCertVerificationError
            ) or getattr(reason, "errno", None) in {errno.ENETUNREACH, errno.EHOSTUNREACH}
            raise RemoteError("Gitea 连接失败，反馈已留档", uncertain=method == "POST" and not not_connected) from None
        except (json.JSONDecodeError, UnicodeDecodeError):
            raise RemoteError("Gitea 响应无效，请管理员检查", uncertain=method == "POST") from None

    def pages(self, path):
        result = []
        for page in range(1, 201):
            separator = "&" if "?" in path else "?"
            items = self.request("GET", f"{path}{separator}limit=50&page={page}")
            if not isinstance(items, list):
                raise RemoteError("Gitea 列表响应无效", permanent=True)
            result.extend(items)
            if len(items) < 50:
                return result
        raise RemoteError("Gitea 列表超过安全分页范围，请管理员检查", permanent=True)

    def upload(self, path, filename, content, mime):
        boundary = "cageledger" + uuid4().hex
        envelope = (
            f'--{boundary}\r\nContent-Disposition: form-data; name="attachment"; filename="{filename}"\r\n'
            f"Content-Type: {mime}\r\n\r\n"
        ).encode()
        return self.request(
            "POST",
            path,
            raw=envelope + content + f"\r\n--{boundary}--\r\n".encode(),
            content_type="multipart/form-data; boundary=" + boundary,
        )

    def download_asset(self, value):
        # Attachment metadata is untrusted. Only same-origin /attachments/ UUID URLs are allowed.
        url = urlparse(value)
        base = urlparse(self.base)
        prefix = base.path.rstrip("/") + "/attachments/"
        if (
            (url.scheme, url.netloc) != (base.scheme, base.netloc)
            or not url.path.startswith(prefix)
            or url.query
            or url.fragment
        ):
            raise RemoteError("远端附件地址不受信任", permanent=True)
        suffix = url.path.removeprefix(prefix)
        if not suffix or "/" in suffix or ".." in suffix:
            raise RemoteError("远端附件地址不受信任", permanent=True)
        try:
            request = Request(value, headers={"Authorization": "token " + self.token})
            with self.opener.open(request, timeout=10) as response:
                content = response.read(10 * 1024 * 1024 + 1)
            if len(content) > 10 * 1024 * 1024:
                raise RemoteError("远端截图超过 10MiB", permanent=True)
            return content
        except HTTPError as exc:
            exc.close()
            raise RemoteError("远端截图下载失败，请稍后重试") from None
        except (URLError, TimeoutError, OSError):
            raise RemoteError("远端截图下载失败，请稍后重试") from None
