from server_app.cache import cache_get, cache_key, cache_set
from server_app.repositories.billing_candidates import (
    QUANTITY_SETTLEMENT_CALCULATION_VERSION,
    billing_candidate_snapshot_registry_needs_sync,
    delete_billing_candidate_snapshot,
    get_billing_candidate_snapshot,
    get_quantity_settlement_group,
    list_billing_candidate_filter_options,
    list_billing_candidate_snapshot_keys,
    list_billing_candidate_snapshots_page,
    mark_billing_candidate_snapshots_stale,
    sync_billing_candidate_snapshot_registry,
    upsert_billing_candidate_snapshot,
)

SETTLEMENT_CANDIDATE_PAGE_CACHE_TTL_SECONDS = 15


def list_settlement_candidates(conn, filters, calculate, source_type="quantity_sheet", now=None):
    response_cache_key = cache_key(
        "quantity_sheets::settlement_candidates::list",
        source_type=source_type,
        limit=filters["limit"],
        offset=filters["offset"],
        sort_key=filters.get("sortKey", ""),
        sort_dir=filters.get("sortDir", ""),
        column_filters=filters.get("columnFilters", {}),
    )
    cached = cache_get(response_cache_key)
    if cached is not None:
        return cached

    if billing_candidate_snapshot_registry_needs_sync(
        conn,
        source_type,
        QUANTITY_SETTLEMENT_CALCULATION_VERSION if source_type == "quantity_sheet" else "",
    ):
        sync_billing_candidate_snapshot_registry(conn, source_type, now or "")
    sort_key = filters.get("sortKey")
    column_filters = filters.get("columnFilters") or {}
    if sort_key == "amount" or bool(column_filters.get("amount")):
        _refresh_matching_stale_snapshots(conn, filters, calculate, source_type, now)

    payload = list_billing_candidate_snapshots_page(conn, source_type, filters)
    stale_page_keys = [(item["month"], item["pi"]) for item in payload["items"] if item.get("isStale")]
    if stale_page_keys:
        _refresh_snapshot_keys(conn, stale_page_keys, calculate, source_type, now)
        payload = list_billing_candidate_snapshots_page(conn, source_type, filters)

    payload["items"] = [_public_candidate(item) for item in payload["items"]]
    payload["filterOptions"] = list_billing_candidate_filter_options(conn, source_type, filters)
    return cache_set(response_cache_key, payload, ttl_seconds=SETTLEMENT_CANDIDATE_PAGE_CACHE_TTL_SECONDS)


def refresh_settlement_candidate_snapshot(conn, month, pi_name, calculate, source_type="quantity_sheet", now=None):
    group = get_quantity_settlement_group(conn, month, pi_name)
    if not group:
        return None
    return _refresh_snapshot(conn, group, calculate, source_type, now)


def invalidate_settlement_candidate_snapshots(conn, keys, source_type="quantity_sheet", now=None):
    timestamp = now or ""
    resolved = set()
    for month, pi_name in keys:
        if not month or not pi_name:
            continue
        group = get_quantity_settlement_group(conn, month, pi_name) if source_type == "quantity_sheet" else None
        if group is None:
            delete_billing_candidate_snapshot(conn, month, pi_name, source_type)
            continue
        snapshot = get_billing_candidate_snapshot(conn, month, pi_name, source_type)
        if snapshot is None or snapshot.get("sourceFingerprint", "") != group.get("sourceFingerprint", ""):
            upsert_billing_candidate_snapshot(
                conn,
                {
                    "month": month,
                    "pi": pi_name,
                    "sourceType": source_type,
                    "iacucs": group.get("iacucs", []),
                    "totalAmount": None,
                    "error": "",
                    "stale": True,
                    "updatedAt": timestamp,
                    "sourceFingerprint": group.get("sourceFingerprint", ""),
                },
            )
        resolved.add((month, pi_name))
    mark_billing_candidate_snapshots_stale(conn, source_type, resolved, timestamp)


def update_settlement_candidate_snapshot_from_statement(
    conn, month, pi_name, statement, source_type="quantity_sheet", now=None
):
    group = get_quantity_settlement_group(conn, month, pi_name)
    if not group:
        return None
    payload = {
        "month": month,
        "pi": pi_name,
        "sourceType": source_type,
        "iacucs": group.get("iacucs", []),
        "totalAmount": float(statement.get("totalAmount", 0) or 0),
        "error": "",
        "stale": False,
        "updatedAt": now or statement.get("generatedAt", "") or "",
        "sourceFingerprint": group.get("sourceFingerprint", ""),
    }
    upsert_billing_candidate_snapshot(conn, payload)
    snapshot = get_billing_candidate_snapshot(conn, month, pi_name, source_type)
    return _public_candidate(snapshot) if snapshot else None


def _refresh_matching_stale_snapshots(conn, filters, calculate, source_type, now):
    stale_keys = [
        (item["month"], item["pi"])
        for item in list_billing_candidate_snapshot_keys(
            conn,
            source_type=source_type,
            filters=filters,
            stale_only=True,
            exclude_amount=True,
        )
    ]
    _refresh_snapshot_keys(conn, stale_keys, calculate, source_type, now)


def _refresh_snapshot_keys(conn, keys, calculate, source_type, now):
    for month, pi_name in sorted({(month, pi_name) for month, pi_name in keys if month and pi_name}):
        group = get_quantity_settlement_group(conn, month, pi_name)
        if not group:
            continue
        _refresh_snapshot(conn, group, calculate, source_type, now)


def _refresh_snapshot(conn, group, calculate, source_type, now):
    month = group["month"]
    pi_name = group["pi"]
    try:
        statement = calculate(month, pi_name)
        payload = {
            "month": month,
            "pi": pi_name,
            "sourceType": source_type,
            "iacucs": group.get("iacucs", []),
            "totalAmount": float(statement.get("totalAmount", 0) or 0),
            "error": "",
            "stale": False,
            "updatedAt": now or statement.get("generatedAt", "") or "",
            "sourceFingerprint": group.get("sourceFingerprint", ""),
        }
    except ValueError as exc:
        payload = {
            "month": month,
            "pi": pi_name,
            "sourceType": source_type,
            "iacucs": group.get("iacucs", []),
            "totalAmount": None,
            "error": str(exc),
            "stale": False,
            "updatedAt": now or "",
            "sourceFingerprint": group.get("sourceFingerprint", ""),
        }
    upsert_billing_candidate_snapshot(conn, payload)
    return get_billing_candidate_snapshot(conn, month, pi_name, source_type)


def _public_candidate(item):
    return {
        "id": item["id"],
        "month": item["month"],
        "pi": item["pi"],
        "iacucs": list(item.get("iacucs") or []),
        "totalAmount": item.get("totalAmount"),
        "error": item.get("error", ""),
    }
