"""Low-overhead in-process performance telemetry."""

from __future__ import annotations

import math
import threading
import time
from collections import deque

_SAMPLE_LIMIT = 512
_LOCK = threading.Lock()
_STARTED_AT = time.monotonic()
_REQUEST_SAMPLES = deque(maxlen=_SAMPLE_LIMIT)
_DATABASE_SAMPLES = deque(maxlen=_SAMPLE_LIMIT)
_REQUEST_BREAKDOWN_LIMIT = 24
_REQUEST_BREAKDOWN_SAMPLE_LIMIT = 128
_REQUEST_BREAKDOWNS = {}
_COUNTERS = {
    "requests": 0,
    "slowRequests": 0,
    "cacheHits": 0,
    "cacheMisses": 0,
    "cacheExpirations": 0,
    "cacheEvictions": 0,
    "databaseOperations": 0,
    "slowDatabaseOperations": 0,
    "databaseLockErrors": 0,
}


def record_request(
    elapsed_ms,
    *,
    slow=False,
    application_ms=None,
    category="page",
    route="/",
    response_bytes=0,
    status=0,
):
    with _LOCK:
        _COUNTERS["requests"] += 1
        _COUNTERS["slowRequests"] += int(slow)
        _REQUEST_SAMPLES.append(float(elapsed_ms))
        _record_request_breakdown(
            elapsed_ms,
            slow=slow,
            application_ms=application_ms,
            category=category,
            route=route,
            response_bytes=response_bytes,
            status=status,
        )


def record_cache(result):
    counter = {
        "hit": "cacheHits",
        "miss": "cacheMisses",
        "expired": "cacheExpirations",
        "eviction": "cacheEvictions",
    }.get(result)
    if counter:
        with _LOCK:
            _COUNTERS[counter] += 1


def record_database_operation(elapsed_ms, *, slow=False, locked=False):
    with _LOCK:
        _COUNTERS["databaseOperations"] += 1
        _COUNTERS["slowDatabaseOperations"] += int(slow)
        _COUNTERS["databaseLockErrors"] += int(locked)
        _DATABASE_SAMPLES.append(float(elapsed_ms))


def performance_snapshot(*, cache_entries=0, cache_capacity=0):
    with _LOCK:
        counters = dict(_COUNTERS)
        request_samples = list(_REQUEST_SAMPLES)
        database_samples = list(_DATABASE_SAMPLES)
        request_breakdown = _request_breakdown_snapshot()
    cache_lookups = counters["cacheHits"] + counters["cacheMisses"] + counters["cacheExpirations"]
    return {
        "uptimeSeconds": round(time.monotonic() - _STARTED_AT, 1),
        "requests": {
            "total": counters["requests"],
            "slow": counters["slowRequests"],
            **_latency_summary(request_samples),
            "breakdown": request_breakdown,
        },
        "cache": {
            "entries": cache_entries,
            "capacity": cache_capacity,
            "hits": counters["cacheHits"],
            "misses": counters["cacheMisses"],
            "expirations": counters["cacheExpirations"],
            "evictions": counters["cacheEvictions"],
            "hitRate": round(counters["cacheHits"] / cache_lookups, 4) if cache_lookups else None,
        },
        "database": {
            "operations": counters["databaseOperations"],
            "slowOperations": counters["slowDatabaseOperations"],
            "lockErrors": counters["databaseLockErrors"],
            **_latency_summary(database_samples),
        },
    }


def reset_performance_metrics():
    """Test helper; production metrics reset naturally on process restart."""
    with _LOCK:
        for key in _COUNTERS:
            _COUNTERS[key] = 0
        _REQUEST_SAMPLES.clear()
        _DATABASE_SAMPLES.clear()
        _REQUEST_BREAKDOWNS.clear()


def _latency_summary(samples):
    if not samples:
        return {"sampleCount": 0, "p50Ms": None, "p95Ms": None, "maxMs": None}
    ordered = sorted(samples)
    return {
        "sampleCount": len(ordered),
        "p50Ms": round(_percentile(ordered, 0.5), 1),
        "p95Ms": round(_percentile(ordered, 0.95), 1),
        "maxMs": round(ordered[-1], 1),
    }


def _percentile(ordered, ratio):
    index = min(max(math.ceil(len(ordered) * ratio) - 1, 0), len(ordered) - 1)
    return ordered[index]


def request_observability(path, *, is_download=False):
    """Return a bounded, parameter-free request bucket for telemetry.

    The monitor intentionally keeps only a resource-level API route. Query
    strings, IDs, usernames and other trailing path values never leave the
    request handler, so performance history remains operational metadata.
    """
    if is_download:
        return ("download", "下载")
    if path.startswith("/api/"):
        segments = [part for part in path.split("/") if part]
        resource = segments[1] if len(segments) > 1 else "other"
        if resource in {"system", "auth", "public"} and len(segments) > 2:
            return ("api", f"/api/{resource}/{segments[2]}")
        return ("api", f"/api/{resource}")
    if path.startswith("/assets/"):
        return ("static", "/assets")
    if path.startswith("/docs"):
        return ("static", "/docs")
    return ("page", "页面")


def _record_request_breakdown(elapsed_ms, *, slow, application_ms, category, route, response_bytes, status):
    key = (category, route)
    bucket = _REQUEST_BREAKDOWNS.get(key)
    if bucket is None:
        if len(_REQUEST_BREAKDOWNS) >= _REQUEST_BREAKDOWN_LIMIT:
            key = (category, "其他")
            bucket = _REQUEST_BREAKDOWNS.get(key)
        if bucket is None:
            bucket = {
                "category": key[0],
                "route": key[1],
                "total": 0,
                "slow": 0,
                "errors": 0,
                "responseBytes": 0,
                "elapsedSamples": deque(maxlen=_REQUEST_BREAKDOWN_SAMPLE_LIMIT),
                "applicationSamples": deque(maxlen=_REQUEST_BREAKDOWN_SAMPLE_LIMIT),
            }
            _REQUEST_BREAKDOWNS[key] = bucket
    bucket["total"] += 1
    bucket["slow"] += int(slow)
    bucket["errors"] += int(status >= 400)
    bucket["responseBytes"] += max(int(response_bytes or 0), 0)
    bucket["elapsedSamples"].append(float(elapsed_ms))
    bucket["applicationSamples"].append(float(application_ms if application_ms is not None else elapsed_ms))


def _request_breakdown_snapshot():
    items = []
    for bucket in _REQUEST_BREAKDOWNS.values():
        elapsed = _latency_summary(list(bucket["elapsedSamples"]))
        application = _latency_summary(list(bucket["applicationSamples"]))
        items.append(
            {
                "category": bucket["category"],
                "route": bucket["route"],
                "total": bucket["total"],
                "slow": bucket["slow"],
                "errors": bucket["errors"],
                "responseBytes": bucket["responseBytes"],
                **elapsed,
                "applicationP95Ms": application["p95Ms"],
            }
        )
    return sorted(items, key=lambda item: (item["slow"], item["p95Ms"] or 0, item["total"]), reverse=True)
