import hashlib
import json
import threading
import time

from server_app.performance import performance_snapshot, record_cache

CACHE_TTL_SECONDS = 15
CACHE_MAX_ENTRIES = 512
DATA_CACHE_LOCK = threading.Lock()
DATA_CACHE = {}
CACHE_MISS = object()


def cache_get(key, default=None):
    with DATA_CACHE_LOCK:
        entry = DATA_CACHE.get(key)
        if not entry:
            record_cache("miss")
            return default
        if entry["expiresAt"] <= time.monotonic():
            DATA_CACHE.pop(key, None)
            record_cache("expired")
            return default
        record_cache("hit")
        return entry["value"]


def cache_set(key, value, ttl_seconds=CACHE_TTL_SECONDS):
    with DATA_CACHE_LOCK:
        now = time.monotonic()
        expired = [cache_key for cache_key, entry in DATA_CACHE.items() if entry["expiresAt"] <= now]
        for cache_key in expired:
            DATA_CACHE.pop(cache_key, None)
        if key not in DATA_CACHE and len(DATA_CACHE) >= CACHE_MAX_ENTRIES:
            oldest_key = min(DATA_CACHE, key=lambda cache_key: DATA_CACHE[cache_key]["expiresAt"])
            DATA_CACHE.pop(oldest_key, None)
            record_cache("eviction")
        DATA_CACHE[key] = {
            "value": value,
            "expiresAt": now + ttl_seconds,
        }
    return value


def invalidate_data_cache(*keys):
    if not keys:
        return
    with DATA_CACHE_LOCK:
        for key in keys:
            DATA_CACHE.pop(key, None)


def invalidate_data_cache_prefixes(*prefixes):
    if not prefixes:
        return
    with DATA_CACHE_LOCK:
        for key in list(DATA_CACHE.keys()):
            if any(key.startswith(prefix) for prefix in prefixes):
                DATA_CACHE.pop(key, None)


def log_perf(label, started_at, **fields):
    elapsed_ms = round((time.perf_counter() - started_at) * 1000, 1)
    details = " ".join(f"{key}={value}" for key, value in fields.items() if value not in (None, ""))
    suffix = f" {details}" if details else ""
    print(f"[perf] {label} {elapsed_ms}ms{suffix}", flush=True)


def cache_key(prefix, **fields):
    encoded = json.dumps(fields, sort_keys=True, ensure_ascii=False, separators=(",", ":"), default=_encode_set)
    return f"{prefix}::" + hashlib.sha256(encoded.encode("utf-8")).hexdigest()


def _encode_set(value):
    if isinstance(value, set | frozenset):
        return sorted(value, key=lambda item: json.dumps(item, sort_keys=True))
    raise TypeError(f"Unsupported cache key type: {type(value).__name__}")


def cache_performance_snapshot():
    with DATA_CACHE_LOCK:
        entries = len(DATA_CACHE)
    return performance_snapshot(cache_entries=entries, cache_capacity=CACHE_MAX_ENTRIES)
