class StaleWriteError(Exception):
    """Raised when an editor submits a record that another writer has changed."""


def require_current_version(existing, expected_updated_at, label):
    """Legacy-compatible check: omitted versions remain allowed on these callers."""
    expected = str(expected_updated_at or "").strip()
    if not expected:
        return
    if isinstance(existing, dict):
        actual = str(existing.get("updatedAt") or existing.get("updated_at") or "").strip()
    else:
        actual = str(existing["updated_at"] or "").strip()
    require_exact_version(actual, expected, f"{label}已被其他操作更新，请刷新后重新编辑。")


def require_exact_version(actual, expected, message):
    """Strict write boundary: require the exact version, without coercion or trimming."""
    if not expected or actual != expected:
        raise StaleWriteError(message)
