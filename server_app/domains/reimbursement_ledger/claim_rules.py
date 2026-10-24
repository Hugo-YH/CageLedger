"""Claim permissions, bounded pagination and monetary/input normalization."""

import json
import math
import mimetypes

from server_app.shared import clean_text


def _obligation_filters(filters):
    clauses, params = [], []
    for field, column in (("month", "month"), ("iacuc", "iacuc")):
        value = clean_text(filters.get(field, ""))
        if value:
            clauses.append(f"{column} = ?")
            params.append(value)
    pi = clean_text(filters.get("sourcePi", ""))
    if pi:
        clauses.append("source_pi LIKE ?")
        params.append(f"%{pi}%")
    status = clean_text(filters.get("status", ""))
    if status and status != "all":
        clauses.append("status = ?")
        params.append(status)
    return clauses, params


def _normalize_funding_line(value, index):
    if not isinstance(value, dict):
        raise ValueError("经费明细格式无效")
    fund_book = clean_text(value.get("fundBookNo", ""))
    owner = clean_text(value.get("fundingOwner", ""))
    amount = _input_money(value.get("reimbursementAmount", 0), "报销金额")
    if not fund_book or not owner:
        raise ValueError("经费明细需填写经费本号和经费负责人")
    if amount < 0:
        raise ValueError("报销金额不能小于 0")
    return {
        "id": clean_text(value.get("id", "")),
        "fundBookNo": fund_book,
        "fundingOwner": owner,
        "reimbursementAmount": amount,
        "sortOrder": index,
    }


def _detect_attachment_type(body, supplied_type, filename):
    if body.startswith(b"%PDF-"):
        return "application/pdf"
    if body.startswith(b"\xff\xd8\xff"):
        return "image/jpeg"
    if body.startswith(b"\x89PNG\r\n\x1a\n"):
        return "image/png"
    guessed = mimetypes.guess_type(filename or "")[0] or clean_text(supplied_type).split(";", 1)[0]
    return guessed.lower()


def _require_authenticated(actor):
    if not actor:
        raise PermissionError("请先登录")


def _require_admin(actor):
    _require_authenticated(actor)
    if actor.get("role") != "admin":
        raise PermissionError("需要管理员权限")


def _require_claim_view(actor, claim):
    _require_authenticated(actor)
    if actor.get("role") == "admin" or claim["created_by"] == actor.get("id"):
        return
    raise PermissionError("没有权限查看该报销单")


def _require_claim_edit(actor, claim):
    _require_claim_view(actor, claim)
    if claim["status"] == "void":
        raise ValueError("已作废报销单不能编辑")


def _limit(filters):
    try:
        return max(1, min(int(filters.get("limit", 20)), 100))
    except (TypeError, ValueError):
        return 20


def _offset(filters):
    try:
        return max(0, int(filters.get("offset", 0)))
    except (TypeError, ValueError):
        return 0


def _page(filters, total):
    limit, offset = _limit(filters), _offset(filters)
    return {"limit": limit, "offset": offset, "total": total, "hasMore": offset + limit < total}


def _money(value):
    try:
        number = float(value or 0)
        return round(number, 2) if math.isfinite(number) else 0.0
    except (TypeError, ValueError):
        return 0.0


def _input_money(value, field):
    if isinstance(value, bool):
        raise ValueError(f"{field}格式无效")
    try:
        number = float(value)
    except (TypeError, ValueError) as exc:
        raise ValueError(f"{field}格式无效") from exc
    if not math.isfinite(number):
        raise ValueError(f"{field}格式无效")
    return round(number, 2)


def _load(value):
    try:
        return json.loads(value or "{}")
    except json.JSONDecodeError:
        return {}


def _dump(value):
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"))
