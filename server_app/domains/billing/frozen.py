"""Read issued settlement versions without consulting current billing inputs."""

import json

from server_app.domains.workflow.constants import FROZEN_WORKFLOW_STATUSES
from server_app.repositories.billing_snapshot_storage import read_lines_many
from server_app.repositories.billing_statements import list_billing_statement_lines_for_version
from server_app.repositories.workflow_documents import frozen_workflow_version, frozen_workflow_versions


def frozen_statements(conn, keys, source_type):
    """Read full, validated snapshots in batches; retain errors by business key."""
    versions, results = _versions(conn, keys, source_type)
    lines = read_lines_many(conn, [version["id"] for version in versions.values()])
    for key, version in versions.items():
        detail = lines[version["id"]]
        results[key] = detail if isinstance(detail, ValueError) else (version["statement"], detail)
    return results


def frozen_statement_headers(conn, keys, source_type):
    """Validate complete details in small batches, retaining only bill headers."""
    versions, results = _versions(conn, keys, source_type)
    items = list(versions.items())
    for offset in range(0, len(items), 10):
        batch = items[offset : offset + 10]
        details = read_lines_many(conn, [version["id"] for _, version in batch], validate_only=True)
        for key, version in batch:
            detail = details[version["id"]]
            results[key] = detail if isinstance(detail, ValueError) else version["statement"]
        del details, detail
    return results


def _versions(conn, keys, source_type):
    rows = frozen_workflow_versions(conn, keys, source_type, FROZEN_WORKFLOW_STATUSES)
    versions, results = {}, {}
    for key, row in rows.items():
        try:
            if not row["payload"] or row["version_status"] != "active":
                raise ValueError("已发起流程的结算版本缺失，请核查历史记录")
            version = json.loads(row["payload"])
            if not version.get("statement") or not version.get("id"):
                raise ValueError("已发起流程的结算内容缺失，请核查历史记录")
            versions[key] = version
        except ValueError as exc:
            results[key] = exc
    return versions, results


def frozen_statement(conn, month, pi, source_type, *, source_id="", iacuc=""):
    version = frozen_workflow_version(
        conn, month, pi, source_type, FROZEN_WORKFLOW_STATUSES, source_id=source_id, iacuc=iacuc
    )
    if version is None:
        return None
    statement = version.get("statement")
    if not statement or not version.get("id"):
        raise ValueError("已发起流程的结算内容缺失，请核查历史记录")
    return statement, list_billing_statement_lines_for_version(conn, version["id"])
