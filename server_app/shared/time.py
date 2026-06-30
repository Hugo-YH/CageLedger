from datetime import UTC, datetime


def now_iso():
    return datetime.now(UTC).isoformat()


def today_iso():
    return datetime.now().date().isoformat()
