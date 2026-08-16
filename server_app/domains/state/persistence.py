"""State aggregate persistence facade."""

import json

from server_app.db import connect_db
from server_app.domains.iacuc import normalize_iacuc_number
from server_app.domains.state.entity_rules import empty_state
from server_app.domains.state.occupancy import occupancy_structured_values, occupancy_with_snapshots
from server_app.repositories.payload import read_updated_at, table_has_rows
from server_app.repositories.state import (
    assemble_state as assemble_state_repository,
)
from server_app.repositories.state import (
    read_applications_by_iacuc as read_applications_by_iacuc_repository,
)
from server_app.repositories.state import (
    read_cached_state as read_cached_state_repository,
)
from server_app.repositories.state import (
    write_normalized_state as write_normalized_state_repository,
)


def assemble_state(conn):
    return assemble_state_repository(conn)


def read_cached_state(conn):
    return read_cached_state_repository(conn, empty_state)


def read_applications_by_iacuc(conn):
    return read_applications_by_iacuc_repository(conn, normalize_iacuc_number)


def write_normalized_state(conn, state, updated_at):
    return write_normalized_state_repository(
        conn,
        state,
        updated_at,
        normalize_iacuc_number=normalize_iacuc_number,
        occupancy_with_snapshots=occupancy_with_snapshots,
        occupancy_structured_values=occupancy_structured_values,
    )


def migrate_legacy_state(conn):
    if table_has_rows(conn, "rooms"):
        return
    row = conn.execute("SELECT payload, updated_at FROM app_state WHERE id = ?", ("default",)).fetchone()
    if row:
        write_normalized_state(conn, json.loads(row["payload"]), row["updated_at"])


def read_state():
    with connect_db() as conn:
        migrate_legacy_state(conn)
        state = assemble_state(conn)
        updated_at = read_updated_at(conn)
    if not state:
        return {"state": None, "updatedAt": None}
    return {"state": state, "updatedAt": updated_at}
