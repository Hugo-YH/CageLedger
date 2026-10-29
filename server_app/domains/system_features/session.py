"""Optional feature configuration in authenticated session responses."""

import sqlite3

from .service import read


def session_payload(conn, user, include_features):
    payload = {"user": user}
    if user and include_features:
        try:
            payload["features"] = read(conn, user)
        except (ValueError, TypeError, KeyError, sqlite3.Error):
            # Authentication remains usable; the standalone configuration endpoint
            # reports the original failure and never substitutes enabled defaults.
            pass
    return payload
