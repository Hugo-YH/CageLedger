"""Read-only exact contact resolution for business printouts, without changing snapshots."""

from . import repository
from .service import authorize


def resolve(conn, actor, body):
    authorize(actor)
    names = body.get("names") if isinstance(body, dict) else None
    if not isinstance(names, list) or not 1 <= len(names) <= 200:
        raise ValueError("每次须查询1至200个姓名")
    if any(not isinstance(name, str) or not name.strip() or len(name) > 200 for name in names):
        raise ValueError("查询姓名无效")
    names = list(dict.fromkeys(name.strip() for name in names))
    candidates = repository.contact_candidates(conn, names)
    items = []
    for name in names:
        matches = [item for item in candidates if name in (item["name"], item.get("alias", ""))]
        phone = ""
        if not matches:
            status = "not_found"
        elif len(matches) > 1:
            status = "ambiguous"
        else:
            phone = (matches[0].get("mobile") or matches[0].get("telephone") or "").strip()
            status = "matched" if phone else "missing_phone"
        items.append({"name": name, "status": status, "phone": phone})
    return {"items": items}
