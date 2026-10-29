"""Shared DeepSeek client used by domain-specific AI features.

Domain modules supply their own system prompt and payload normalization;
this module owns configuration, HTTP transport, error mapping and JSON output.
"""

import json
import re
import ssl
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.request import HTTPRedirectHandler, HTTPSHandler, Request, build_opener

from server_app.config import DEEPSEEK_API_KEY, DEEPSEEK_API_URL, DEEPSEEK_MODEL, DEEPSEEK_TIMEOUT_SECONDS
from server_app.runtime_logging import log_operation

_CA_BUNDLE_CANDIDATES = (
    "/etc/ssl/cert.pem",
    "/opt/homebrew/etc/openssl@3/cert.pem",
    "/opt/homebrew/etc/openssl@1.1/cert.pem",
    "/Library/Frameworks/Python.framework/Versions/3.13/etc/openssl/cert.pem",
)
_MAX_RESPONSE_BYTES = 4 * 1024 * 1024


class _NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def urlopen(request, *, timeout, context):
    # The configured endpoint must be the final URL; never forward credentials
    # to a redirect target (including same-origin redirect targets).
    return build_opener(_NoRedirect(), HTTPSHandler(context=context)).open(request, timeout=timeout)


def _read_bounded(response):
    data = response.read(_MAX_RESPONSE_BYTES + 1)
    if len(data) > _MAX_RESPONSE_BYTES:
        raise ValueError("DeepSeek 接口响应过大，请检查上游服务。")
    return data


def _safe_error_detail(detail):
    # Scrub before truncation so a secret cannot be exposed as a prefix.
    for secret in (DEEPSEEK_API_URL, DEEPSEEK_API_KEY):
        if secret:
            escaped = json.dumps(secret, ensure_ascii=True)[1:-1]
            for variant in (secret, escaped, escaped.replace("/", "\\/")):
                detail = detail.replace(variant, "[已隐藏]")
    return re.sub(r"\bBearer\s+[^\s\"']+", "Bearer [已隐藏]", detail, flags=re.IGNORECASE)[:300]


def _ssl_context():
    for path in _CA_BUNDLE_CANDIDATES:
        try:
            return ssl.create_default_context(cafile=path)
        except (OSError, ssl.SSLError):
            continue
    return ssl.create_default_context()


@log_operation("ai_request", component="ai")
def deepseek_chat_json(
    system_prompt: str, user_prompt: str, *, image_urls: list[str] | None = None, model: str | None = None
) -> tuple[dict[str, Any], dict[str, Any]]:
    """Send a chat request and return the parsed JSON object and token usage."""
    if not DEEPSEEK_API_KEY:
        raise ValueError("未配置 DEEPSEEK_API_KEY，无法使用 AI 识别。")
    payload = {
        "model": model or DEEPSEEK_MODEL,
        "temperature": 0,
        "response_format": {"type": "json_object"},
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt},
        ],
    }
    if image_urls:
        payload["messages"][1]["content"] = [
            {"type": "text", "text": user_prompt},
            *[{"type": "image_url", "image_url": {"url": url, "detail": "original"}} for url in image_urls],
        ]
        payload.update({"thinking": {"type": "disabled"}, "max_tokens": 8192})
    body = json.dumps(
        payload,
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
            try:
                response_body = json.loads(_read_bounded(response).decode("utf-8"))
            except (UnicodeDecodeError, json.JSONDecodeError) as exc:
                raise ValueError("DeepSeek 接口返回的响应无效，请稍后重试。") from exc
    except HTTPError as exc:
        with exc:
            if 300 <= exc.code < 400:
                raise ValueError("DeepSeek 接口地址发生重定向，请将配置改为最终地址。") from exc
            if image_urls:
                # Provider errors may echo input; do not expose screenshots or their text.
                raise ValueError(f"图片识别接口返回 HTTP {exc.code}，请核对图片识别模型配置或稍后重试。") from exc
            detail = _safe_error_detail(_read_bounded(exc).decode("utf-8", errors="replace"))
            raise ValueError(f"DeepSeek 接口返回错误：HTTP {exc.code} {detail}") from exc
    except URLError as exc:
        raise ValueError("无法连接 DeepSeek，请检查接口配置或稍后重试。") from exc
    except TimeoutError as exc:
        raise ValueError("连接 DeepSeek 超时") from exc
    if not isinstance(response_body, dict):
        raise ValueError("DeepSeek 接口返回的响应无效，请稍后重试。")
    choices = response_body.get("choices")
    if not isinstance(choices, list) or not choices or not isinstance(choices[0], dict):
        raise ValueError("DeepSeek 接口返回的响应无效，请稍后重试。")
    message = choices[0].get("message")
    if not isinstance(message, dict) or not isinstance(message.get("content"), str):
        raise ValueError("DeepSeek 接口返回的响应无效，请稍后重试。")
    content = message["content"]
    try:
        payload = json.loads(content)
    except json.JSONDecodeError as exc:
        raise ValueError("DeepSeek 未返回有效 JSON，请重试。") from exc
    usage = response_body.get("usage")
    if not isinstance(usage, dict):
        usage = {}
    return payload if isinstance(payload, dict) else {}, usage
