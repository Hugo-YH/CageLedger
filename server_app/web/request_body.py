"""Bounded request framing and JSON validation shared by write endpoints."""

import json

from server_app.config import MAX_BODY_BYTES


class RequestBodyError(ValueError):
    pass


def read_body(headers, stream, *, optional=False):
    if headers.get("Transfer-Encoding") is not None:
        raise RequestBodyError("不支持 Transfer-Encoding，请提供 Content-Length")
    lengths = headers.get_all("Content-Length", [])
    if len(lengths) > 1:
        raise RequestBodyError("Content-Length 不能重复")
    value = lengths[0].strip() if lengths else "0"
    if not value.isascii() or not value.isdecimal() or len(value) > 10:
        raise RequestBodyError("Content-Length 无效")
    length = int(value)
    if length == 0:
        if optional:
            return b""
        raise RequestBodyError("Missing request body")
    if length > MAX_BODY_BYTES:
        raise RequestBodyError("Request body is too large")
    body = stream.read(length)
    if len(body) != length:
        raise RequestBodyError("请求体不完整")
    return body


def parse_json_object(raw):
    def reject_constant(_value):
        raise RequestBodyError("JSON 不允许非有限数值")

    try:
        value = json.loads(raw.decode("utf-8"), parse_constant=reject_constant)
    except (UnicodeDecodeError, json.JSONDecodeError, RecursionError) as exc:
        raise RequestBodyError("Invalid JSON body") from exc
    if not isinstance(value, dict):
        raise RequestBodyError("JSON 请求体必须是对象")
    return value
