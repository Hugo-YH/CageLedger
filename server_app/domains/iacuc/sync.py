"""IACUC-derived field synchronization and principal identity commands."""

import json

from server_app.cache import cache_get, cache_set, invalidate_data_cache, invalidate_data_cache_prefixes
from server_app.db import connect_db
from server_app.domains.administration import audit_event, merge_audit_logs, write_audit_events
from server_app.domains.billing import (
    BILLING_PRINCIPAL_INDEPENDENT,
    free_cages_for_principal_type,
    invalidate_settlement_candidate_snapshots,
    normalize_principal_type,
    principal_type_label,
)
from server_app.domains.dashboard_overview import invalidate_dashboard_overview_cache
from server_app.domains.iacuc.importer import normalize_application_amount, normalize_application_date
from server_app.domains.iacuc.rules import normalize_iacuc_number
from server_app.repositories.billing_candidates import (
    mark_all_billing_candidate_snapshots_stale,
    mark_billing_candidate_snapshots_stale_by_pi,
)
from server_app.repositories.entities import (
    list_distinct_principal_names,
    read_principal_identity_payloads,
    upsert_principal_identity,
)
from server_app.repositories.iacuc import replace_experiment_applications
from server_app.repositories.payload import dump_json
from server_app.shared import clean_text, new_id, now_iso
from server_app.shared.concurrency import require_current_version


def write_experiment_applications(conn, items, imported_at):
    replace_experiment_applications(conn, items, imported_at, application_payload)


PROJECT_DERIVED_FIELDS = (
    "project",
    "pi",
    "owner",
    "funding",
    "projectStartDate",
    "projectEndDate",
    "applicationApprovalDate",
    "iacucApprovalDate",
    "fundCode",
    "supportProjectPeriod",
    "experimentNo",
    "species",
    "facility",
    "maxFeedingPeriod",
    "approvedFeedingFee",
    "approvalLeader",
    "actualFeedingFee",
    "pendingReimbursementFee",
    "assistant",
    "applicationDate",
)


PROJECT_DERIVED_FIELDS = (
    "project",
    "pi",
    "owner",
    "funding",
    "projectStartDate",
    "projectEndDate",
    "applicationApprovalDate",
    "iacucApprovalDate",
    "fundCode",
    "supportProjectPeriod",
    "experimentNo",
    "species",
    "facility",
    "maxFeedingPeriod",
    "approvedFeedingFee",
    "approvalLeader",
    "actualFeedingFee",
    "pendingReimbursementFee",
    "assistant",
    "applicationDate",
)


def application_by_iacuc(items):
    applications = {}
    for item in items:
        iacuc = normalize_iacuc_number((item or {}).get("iacuc", ""))
        if iacuc:
            applications[iacuc] = item
    return applications


def project_field_snapshot(item):
    return {field: clean_text((item or {}).get(field, "")) for field in PROJECT_DERIVED_FIELDS}


def changed_project_fields(before, after):
    return {
        field
        for field in PROJECT_DERIVED_FIELDS
        if clean_text(before.get(field, "")) != clean_text(after.get(field, ""))
    }


def read_current_applications(conn):
    rows = conn.execute("SELECT payload FROM experiment_applications ORDER BY rowid").fetchall()
    return [json.loads(row["payload"]) for row in rows]


def source_iacuc_for_placement_tasks(conn):
    rows = conn.execute("SELECT id, iacuc, payload FROM intake_batches").fetchall()
    by_batch = {}
    for row in rows:
        payload = json.loads(row["payload"])
        by_batch[row["id"]] = normalize_iacuc_number(payload.get("iacuc") or row["iacuc"] or "")
    return by_batch


def sync_project_fields_for_table(conn, table, applications, changed_iacucs, imported_at, source_iacuc_by_batch=None):
    rows = conn.execute(f"SELECT * FROM {table}").fetchall()
    changes = []
    for row in rows:
        payload = json.loads(row["payload"])
        if table == "placement_tasks":
            source_iacuc = (source_iacuc_by_batch or {}).get(clean_text(payload.get("sourceBatchId", "")), "")
            iacuc = normalize_iacuc_number(payload.get("iacuc", "") or source_iacuc)
        else:
            iacuc = normalize_iacuc_number(payload.get("iacuc", "") or (row["iacuc"] if "iacuc" in row.keys() else ""))
        if not iacuc or iacuc not in changed_iacucs or iacuc not in applications:
            continue

        before = project_field_snapshot(payload)
        after = project_field_snapshot(applications[iacuc])
        changed_fields = sorted(changed_project_fields(before, after))
        if not changed_fields:
            continue

        for field in PROJECT_DERIVED_FIELDS:
            payload[field] = after[field]
        payload["projectSyncedAt"] = imported_at
        payload["projectSyncSource"] = "iacuc_upload"
        payload["updatedAt"] = imported_at
        payload_json = dump_json(payload)

        if table == "quantity_sheets":
            conn.execute(
                """
                UPDATE quantity_sheets
                SET project = ?, pi = ?, owner = ?, funding = ?, updated_at = ?, payload = ?
                WHERE id = ?
                """,
                (after["project"], after["pi"], after["owner"], after["funding"], imported_at, payload_json, row["id"]),
            )
        elif table == "occupancies":
            conn.execute(
                """
                UPDATE occupancies
                SET project = ?, pi = ?, owner = ?, funding = ?, species = ?, updated_at = ?, payload = ?
                WHERE id = ?
                """,
                (
                    after["project"],
                    after["pi"],
                    after["owner"],
                    after["funding"],
                    after["species"],
                    imported_at,
                    payload_json,
                    row["id"],
                ),
            )
        elif table == "intake_batches":
            conn.execute(
                "UPDATE intake_batches SET pi = ?, owner = ?, updated_at = ?, payload = ? WHERE id = ?",
                (after["pi"], after["owner"], imported_at, payload_json, row["id"]),
            )
        elif table == "placement_tasks":
            conn.execute(
                "UPDATE placement_tasks SET updated_at = ?, payload = ? WHERE id = ?",
                (imported_at, payload_json, row["id"]),
            )

        changes.append(
            {
                "table": table,
                "id": row["id"],
                "iacuc": iacuc,
                "changedFields": changed_fields,
                "before": {field: before[field] for field in changed_fields},
                "after": {field: after[field] for field in changed_fields},
            }
        )
    return changes


def sync_project_derived_fields_after_iacuc_upload(conn, old_items, new_items, actor, imported_at):
    old_by_iacuc = application_by_iacuc(old_items)
    new_by_iacuc = application_by_iacuc(new_items)
    changed_iacucs = {
        iacuc
        for iacuc, new_item in new_by_iacuc.items()
        if iacuc not in old_by_iacuc
        or changed_project_fields(project_field_snapshot(old_by_iacuc[iacuc]), project_field_snapshot(new_item))
    }
    if not changed_iacucs:
        return {"changedIacucCount": 0, "updatedRecordCount": 0, "tableCounts": {}, "snapshotId": ""}

    source_iacuc_by_batch = source_iacuc_for_placement_tasks(conn)
    changes = []
    for table in ("quantity_sheets", "occupancies", "intake_batches", "placement_tasks"):
        changes.extend(
            sync_project_fields_for_table(conn, table, new_by_iacuc, changed_iacucs, imported_at, source_iacuc_by_batch)
        )

    table_counts = {}
    for item in changes:
        table_counts[item["table"]] = table_counts.get(item["table"], 0) + 1

    snapshot_id = ""
    if changes:
        snapshot_id = new_id("project-sync")
        summary = {
            "changedIacucCount": len(changed_iacucs),
            "updatedRecordCount": len(changes),
            "tableCounts": table_counts,
        }
        payload = {
            **summary,
            "changedIacucs": sorted(changed_iacucs),
            "changes": changes,
        }
        conn.execute(
            """
            INSERT INTO project_sync_snapshots (
                id, imported_at, actor_user_id, actor_display_name, summary, payload
            )
            VALUES (?, ?, ?, ?, ?, ?)
            """,
            (
                snapshot_id,
                imported_at,
                actor.get("id", ""),
                actor.get("displayName", ""),
                dump_json(summary),
                dump_json(payload),
            ),
        )

    return {
        "changedIacucCount": len(changed_iacucs),
        "updatedRecordCount": len(changes),
        "tableCounts": table_counts,
        "snapshotId": snapshot_id,
    }


def list_principal_identities(conn):
    identity_by_pi = {
        clean_text(item.get("pi", "")): item
        for item in read_principal_identity_payloads(conn)
        if clean_text(item.get("pi", ""))
    }
    principal_names = {clean_text(name) for name in list_distinct_principal_names(conn)}
    principal_names.update(identity_by_pi.keys())
    items = []
    for pi_name in sorted((name for name in principal_names if name), key=lambda value: value.lower()):
        saved = identity_by_pi.get(pi_name, {})
        principal_type = normalize_principal_type(saved.get("principalType", BILLING_PRINCIPAL_INDEPENDENT))
        items.append(
            {
                "pi": pi_name,
                "principalType": principal_type,
                "freeCageAllowance": free_cages_for_principal_type(principal_type),
                "updatedAt": saved.get("updatedAt", ""),
            }
        )
    return items


def read_principal_identities():
    cached = cache_get("principal_identities")
    if cached is not None:
        return cached
    with connect_db() as conn:
        return cache_set("principal_identities", list_principal_identities(conn))


def save_principal_identity(conn, payload, actor, pi_name):
    pi_name = clean_text(pi_name or payload.get("pi", ""))
    if not pi_name:
        raise ValueError("项目负责人不能为空")
    principal_type = normalize_principal_type(payload.get("principalType", ""))
    existing = next(
        (item for item in read_principal_identity_payloads(conn) if clean_text(item.get("pi", "")) == pi_name),
        None,
    )
    require_current_version(existing or {}, payload.get("expectedUpdatedAt"), "项目负责人配置")
    now = now_iso()
    item = {
        "pi": pi_name,
        "principalType": principal_type,
        "freeCageAllowance": free_cages_for_principal_type(principal_type),
        "updatedAt": now,
    }
    upsert_principal_identity(conn, pi_name, principal_type, now, dump_json(item))
    event = audit_event(
        actor,
        "principal_identity.updated",
        "principal_identity",
        pi_name,
        f"{actor['displayName']} 更新项目负责人 {pi_name} 身份为 {principal_type_label(principal_type)}",
        [],
        now,
        None,
        item,
    )
    write_audit_events(conn, [event])
    invalidate_data_cache("principal_identities", "principal_types_by_pi")
    invalidate_data_cache_prefixes("quantity_sheets::", "billing_workflows::")
    return item, merge_audit_logs([], [event])


def invalidate_quantity_sheet_candidate_snapshots(conn, sheets_or_keys):
    keys = []
    for item in sheets_or_keys:
        if isinstance(item, dict):
            month = clean_text(item.get("month", ""))
            pi_name = clean_text(item.get("pi", ""))
        else:
            month, pi_name = item
            month = clean_text(month)
            pi_name = clean_text(pi_name)
        if month and pi_name:
            keys.append((month, pi_name))
    invalidate_settlement_candidate_snapshots(conn, keys, "quantity_sheet", now_iso())
    invalidate_dashboard_overview_cache()


def invalidate_quantity_sheet_candidate_snapshots_by_pi(conn, pi_name):
    mark_billing_candidate_snapshots_stale_by_pi(conn, "quantity_sheet", clean_text(pi_name), now_iso())


def invalidate_all_quantity_sheet_candidate_snapshots(conn):
    mark_all_billing_candidate_snapshots_stale(conn, "quantity_sheet", now_iso())
    invalidate_dashboard_overview_cache()


def application_payload(item, imported_at):
    raw_iacuc = clean_text(item.get("rawIacuc", "") or item.get("iacuc", ""))
    normalized = {
        "id": clean_text(item.get("id", "")),
        "iacuc": clean_text(item.get("iacuc", "") or raw_iacuc),
        "rawIacuc": raw_iacuc,
        "project": clean_text(item.get("project", "")),
        "pi": clean_text(item.get("pi", "")),
        "owner": clean_text(item.get("owner", "")),
        "funding": clean_text(item.get("funding", "")),
        "fundCode": clean_text(item.get("fundCode", "")),
        "supportProjectPeriod": clean_text(item.get("supportProjectPeriod", "")),
        "experimentNo": clean_text(item.get("experimentNo", "")),
        "species": clean_text(item.get("species", "")),
        "facility": clean_text(item.get("facility", "")),
        "maxFeedingPeriod": clean_text(item.get("maxFeedingPeriod", "")),
        "iacucApprovalDate": normalize_application_date(item.get("iacucApprovalDate", "")),
        "applicationApprovalDate": normalize_application_date(item.get("applicationApprovalDate", "")),
        "projectStartDate": normalize_application_date(item.get("projectStartDate", "")),
        "projectEndDate": normalize_application_date(item.get("projectEndDate", "")),
        "approvedFeedingFee": normalize_application_amount(item.get("approvedFeedingFee", "")),
        "approvalLeader": clean_text(item.get("approvalLeader", "")),
        "actualFeedingFee": normalize_application_amount(item.get("actualFeedingFee", "")),
        "pendingReimbursementFee": normalize_application_amount(item.get("pendingReimbursementFee", "")),
        "assistant": clean_text(item.get("assistant", "")),
        "notes": clean_text(item.get("notes", "")),
        "applicationDate": normalize_application_date(item.get("applicationDate", "")),
        "rawFields": item.get("rawFields") if isinstance(item.get("rawFields"), dict) else {},
        "importedAt": imported_at,
    }
    return normalized
