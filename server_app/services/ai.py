"""Shared DeepSeek client used by domain-specific AI features.

Domain modules supply their own system prompt and payload normalization;
this module owns configuration, HTTP transport, error mapping and JSON output.
"""

import json
import ssl
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

from server_app.config import DEEPSEEK_API_KEY, DEEPSEEK_API_URL, DEEPSEEK_MODEL, DEEPSEEK_TIMEOUT_SECONDS

_CA_BUNDLE_CANDIDATES = (
    "/etc/ssl/cert.pem",
    "/opt/homebrew/etc/openssl@3/cert.pem",
    "/opt/homebrew/etc/openssl@1.1/cert.pem",
    "/Library/Frameworks/Python.framework/Versions/3.13/etc/openssl/cert.pem",
)


def _ssl_context():
    for path in _CA_BUNDLE_CANDIDATES:
        try:
            return ssl.create_default_context(cafile=path)
        except (OSError, ssl.SSLError):
            continue
    return ssl.create_default_context()


def deepseek_chat_json(system_prompt: str, user_prompt: str) -> tuple[dict[str, Any], dict[str, Any]]:
    """Send a chat request and return the parsed JSON object and token usage."""
    if not DEEPSEEK_API_KEY:
        raise ValueError("未配置 DEEPSEEK_API_KEY，无法使用 AI 识别。")
    body = json.dumps(
        {
            "model": DEEPSEEK_MODEL,
            "temperature": 0,
            "response_format": {"type": "json_object"},
            "messages": [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt},
            ],
        },
        ensure_ascii=False,
    ).encode("utf-8")
    request = Request(
        DEEPSEEK_API_URL,
        data=body,
        headers={
            "Authorization": f"Bearer {DEEPSEEK_API_KEY}",
            "Content-Type": "application/json",
        },
        method="POST",
    )
    try:
        with urlopen(request, timeout=DEEPSEEK_TIMEOUT_SECONDS, context=_ssl_context()) as response:
            response_body = json.loads(response.read().decode("utf-8"))
    except HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")[:300]
        raise ValueError(f"DeepSeek 接口返回错误：HTTP {exc.code} {detail}") from exc
    except URLError as exc:
        raise ValueError(f"无法连接 DeepSeek：{exc.reason}") from exc
    except TimeoutError as exc:
        raise ValueError("连接 DeepSeek 超时") from exc
    content = str(response_body.get("choices", [{}])[0].get("message", {}).get("content") or "")
    try:
        payload = json.loads(content)
    except json.JSONDecodeError as exc:
        raise ValueError("DeepSeek 未返回有效 JSON，请重试。") from exc
    usage = response_body.get("usage") or {}
    return payload if isinstance(payload, dict) else {}, usage
