import hashlib
import json
import sys
import threading
import time
from contextlib import contextmanager

from server_app.performance import performance_snapshot, record_cache
from server_app.runtime_logging import emit_event

CACHE_TTL_SECONDS = 15
CACHE_MAX_ENTRIES = 512
CACHE_MAX_BYTES = 64 * 1024 * 1024
CACHE_MAX_ITEM_BYTES = 16 * 1024 * 1024
DATA_CACHE_LOCK = threading.Lock()
DATA_CACHE = {}
CACHE_MISS = object()
_GENERATION = 0
_BUILD_LOCKS = tuple(threading.RLock() for _ in range(32))


def cache_generation():
    """Capture before a read; invalidation retires every in-flight cache fill."""
    with DATA_CACHE_LOCK:
        return _GENERATION


@contextmanager
def cache_build_lock(key, conn):
    """Coalesce read-only rebuilds; writers never wait while owning SQLite's lock."""
    if conn.in_transaction:
        yield
    else:
        with _BUILD_LOCKS[hash(key) % len(_BUILD_LOCKS)]:
            yield


def cache_get(key, default=None, *, connection=None):
    if connection is not None and connection.in_transaction is True:
        # A transaction must see its own writes, not another connection's
        # committed projection. Such reads are never published to the cache.
        record_cache("miss")
        return default
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


def cache_set(key, value, ttl_seconds=CACHE_TTL_SECONDS, *, expected_generation=None):
    size = _value_size(value)
    with DATA_CACHE_LOCK:
        if expected_generation is not None and expected_generation != _GENERATION:
            return value
        now = time.monotonic()
        expired = [cache_key for cache_key, entry in DATA_CACHE.items() if entry["expiresAt"] <= now]
        for cache_key in expired:
            DATA_CACHE.pop(cache_key, None)
        DATA_CACHE.pop(key, None)
        if size > min(CACHE_MAX_ITEM_BYTES, CACHE_MAX_BYTES):
            return value
        cached_bytes = sum(entry["sizeBytes"] for entry in DATA_CACHE.values())
        while DATA_CACHE and (len(DATA_CACHE) >= CACHE_MAX_ENTRIES or cached_bytes + size > CACHE_MAX_BYTES):
            oldest_key = min(DATA_CACHE, key=lambda cache_key: DATA_CACHE[cache_key]["expiresAt"])
            cached_bytes -= DATA_CACHE.pop(oldest_key)["sizeBytes"]
            record_cache("eviction")
        DATA_CACHE[key] = {
            "value": value,
            "expiresAt": now + ttl_seconds,
            "sizeBytes": size,
        }
    return value


def _value_size(value):
    """Bound container/string memory without serializing a second large JSON copy."""
    total, pending, seen = 0, [value], set()
    while pending:
        item = pending.pop()
        if id(item) in seen:
            continue
        seen.add(id(item))
        total += sys.getsizeof(item)
        if total > CACHE_MAX_ITEM_BYTES:
            break
        if isinstance(item, dict):
            pending.extend(item.keys())
            pending.extend(item.values())
        elif isinstance(item, list | tuple | set | frozenset):
            pending.extend(item)
    return total


def invalidate_data_cache(*keys):
    global _GENERATION
    if not keys:
        return
    with DATA_CACHE_LOCK:
        _GENERATION += 1
        for key in keys:
            DATA_CACHE.pop(key, None)


def invalidate_data_cache_prefixes(*prefixes):
    global _GENERATION
    if not prefixes:
        return
    with DATA_CACHE_LOCK:
        _GENERATION += 1
        for key in list(DATA_CACHE.keys()):
            if any(key.startswith(prefix) for prefix in prefixes):
                DATA_CACHE.pop(key, None)


def log_perf(label, started_at, **fields):
    elapsed_ms = round((time.perf_counter() - started_at) * 1000, 1)
    emit_event("performance_operation", operation=label, durationMs=elapsed_ms, **fields)


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
