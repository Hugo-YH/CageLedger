"""Original-field summary projection; full and room reads keep their own contracts."""

from server_app.repositories.payload import read_payloads
from server_app.repositories.payload_projection import projected_rows


def read_summary_state(conn):
    def items(table, fields, order="rowid"):
        return [item for _, item in projected_rows(conn, table, fields, order=order)]

    return {
        "rooms": read_payloads(conn, "rooms", "rowid"),
        "racks": read_payloads(conn, "racks", "room_id,index_no,rowid"),
        "slots": items("cage_slots", ("id", "rackId", "status"), "rack_id,row_no,col_no,rowid"),
        "occupancies": items(
            "occupancies", ("id", "slotId", "rackId", "roomId", "status", "endDate", "animalCount"), "start_date,rowid"
        ),
        "placementTasks": items(
            "placement_tasks", ("targetRoomId", "status", "plannedMoveInDate"), "planned_move_in_date,rowid"
        ),
        "intakeBatches": items("intake_batches", ("status", "roomName", "roomMatched"), "updated_at DESC,rowid DESC"),
    }
