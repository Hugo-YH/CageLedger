"""Allowlisted feedback diagnostics. Raw messages, URLs, bodies and credentials are never accepted."""

import json

PAGES = {
    "overview",
    "cages",
    "intake",
    "quarantine",
    "animal-inspection",
    "billing",
    "workflows",
    "feedback",
    "settings",
    "scanner",
    "unknown",
}
RESOURCES = {
    "bootstrap",
    "state",
    "cages",
    "cage-cards",
    "rooms",
    "facilities",
    "users",
    "iacuc",
    "intake-batches",
    "placement-tasks",
    "quantity-sheets",
    "billing-statements",
    "billing-workflows",
    "settlement-candidates",
    "principal-identities",
    "reimbursements",
    "pdf-exports",
    "pdf-export-jobs",
    "quarantine",
    "quarantine-batches",
    "animal-inspections",
    "feedback",
    "system",
    ":other",
}
ROUTE_PARTS = {
    ":id",
    "summary",
    "preview",
    "pdf",
    "download",
    "export",
    "import",
    "filter-options",
    "integration",
    "retry",
    "sync",
    "comments",
    "attachments",
    "encounter",
    "environment",
    "performance-history",
    "catalog",
    "records",
    "reports",
    "draft",
    "publish",
    "versions",
    "complete",
    "cancel",
}
ERROR_TYPES = {
    "Error",
    "TypeError",
    "ReferenceError",
    "RangeError",
    "SyntaxError",
    "URIError",
    "EvalError",
    "ChunkLoadError",
    "ResourceError",
    "UnknownError",
}
METHODS = {"GET", "POST", "PUT", "PATCH", "DELETE"}
MAX_TIMESTAMP = 4_102_444_800_000


def require(condition):
    if not condition:
        raise ValueError("诊断信息格式或长度无效，请更新诊断信息后重试")


def integer(value, maximum):
    return type(value) is int and 0 <= value <= maximum


def route(value):
    if not isinstance(value, str):
        return False
    parts = value.split("/")
    return (
        3 <= len(parts) <= 8
        and parts[:2] == ["", "api"]
        and parts[2] in RESOURCES
        and all(part in ROUTE_PARTS for part in parts[3:])
    )


def validate(value):
    if value is None:
        return None
    require(isinstance(value, dict) and set(value) == {"schemaVersion", "capturedAt", "windowSeconds", "events"})
    require(type(value["schemaVersion"]) is int and value["schemaVersion"] == 1)
    require(type(value["windowSeconds"]) is int and value["windowSeconds"] == 300)
    require(integer(value["capturedAt"], MAX_TIMESTAMP))
    require(isinstance(value["events"], list) and len(value["events"]) <= 50)
    captured_at = value["capturedAt"]
    for event in value["events"]:
        require(isinstance(event, dict))
        require(integer(event.get("at"), MAX_TIMESTAMP) and captured_at - 300_000 <= event["at"] <= captured_at)
        require(isinstance(event.get("page"), str) and event["page"] in PAGES)
        kind = event.get("kind")
        fields = {"at", "page", "kind"}
        if kind == "navigation":
            pass
        elif kind == "action":
            fields |= {"action"}
            require(isinstance(event.get("action"), str) and event["action"] in {"save", "delete", "download"})
        elif kind == "error":
            fields |= {"errorType", "source", "line", "column"}
            require(isinstance(event.get("errorType"), str) and event["errorType"] in ERROR_TYPES)
            require(
                isinstance(event.get("source"), str) and event["source"] in {"runtime", "promise", "react", "resource"}
            )
            require(all(integer(event[key], 10_000_000) for key in ("line", "column") if key in event))
        elif kind == "request":
            fields |= {"method", "route", "status", "durationMs", "requestId"}
            require(isinstance(event.get("method"), str) and event["method"] in METHODS)
            require(route(event.get("route")))
            require(integer(event.get("status"), 599) and integer(event.get("durationMs"), 120_000))
            if "requestId" in event:
                identity = event["requestId"]
                require(
                    isinstance(identity, str) and len(identity) == 16 and all(c in "0123456789abcdef" for c in identity)
                )
        else:
            require(False)
        require(set(event) <= fields)
    require(len(json.dumps(value, ensure_ascii=False).encode()) <= 16_384)
    return value


def markdown(value):
    snapshot = validate(value)
    if snapshot is None:
        return ""
    content = json.dumps(snapshot, ensure_ascii=False, indent=2, sort_keys=True)
    return "\n\n<details>\n<summary>诊断信息（用户选择附带）</summary>\n\n```json\n" + content + "\n```\n\n</details>"
