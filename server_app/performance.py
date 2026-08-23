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


def record_request(elapsed_ms, *, slow=False):
    with _LOCK:
        _COUNTERS["requests"] += 1
        _COUNTERS["slowRequests"] += int(slow)
        _REQUEST_SAMPLES.append(float(elapsed_ms))


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
    cache_lookups = counters["cacheHits"] + counters["cacheMisses"] + counters["cacheExpirations"]
    return {
        "uptimeSeconds": round(time.monotonic() - _STARTED_AT, 1),
        "requests": {
            "total": counters["requests"],
            "slow": counters["slowRequests"],
            **_latency_summary(request_samples),
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
