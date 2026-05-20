from datetime import datetime, timedelta, timezone
import threading
import time


CACHE_TTL_SECONDS = 15
DATA_CACHE_LOCK = threading.Lock()
DATA_CACHE = {}


def cache_get(key):
    with DATA_CACHE_LOCK:
        entry = DATA_CACHE.get(key)
        if not entry:
            return None
        if entry["expiresAt"] <= datetime.now(timezone.utc):
            DATA_CACHE.pop(key, None)
            return None
        return entry["value"]


def cache_set(key, value, ttl_seconds=CACHE_TTL_SECONDS):
    with DATA_CACHE_LOCK:
        DATA_CACHE[key] = {
            "value": value,
            "expiresAt": datetime.now(timezone.utc) + timedelta(seconds=ttl_seconds),
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
    normalized = []
    for key in sorted(fields):
        value = fields[key]
        if isinstance(value, (list, tuple, set)):
            value = ",".join(str(item) for item in value)
        normalized.append(f"{key}={value}")
    return f"{prefix}::" + "|".join(normalized)
