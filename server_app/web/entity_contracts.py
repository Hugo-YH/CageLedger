"""HTTP entity endpoint mappings and stable query ordering."""

ENTITY_ENDPOINTS = {
    "/api/rooms": "rooms",
    "/api/racks": "racks",
    "/api/cage-slots": "cage_slots",
    "/api/occupancies": "occupancies",
    "/api/placement-tasks": "placement_tasks",
    "/api/billing-rules": "billing_rules",
    "/api/billing-adjustments": "billing_adjustments",
    "/api/intake-batches": "intake_batches",
    "/api/experiment-applications": "experiment_applications",
    "/api/billing-statements": "billing_statements",
    "/api/billing-statement-lines": "billing_statement_lines",
    "/api/audit-events": "audit_events",
}

ENTITY_ORDER_BY = {
    "rooms": "rowid",
    "racks": "room_id, index_no, rowid",
    "cage_slots": "rack_id, row_no, col_no, rowid",
    "occupancies": "start_date, rowid",
    "placement_tasks": "planned_move_in_date, rowid",
    "billing_rules": "rowid",
    "billing_adjustments": "rowid",
    "intake_batches": "updated_at DESC, rowid DESC",
    "experiment_applications": "rowid",
    "billing_statements": "month DESC, iacuc, rowid DESC",
    "billing_statement_lines": "statement_id, line_date, rowid",
}

WRITABLE_ENTITY_ENDPOINTS = {
    "/api/rooms": {"collection": "rooms", "id_prefix": "room"},
    "/api/racks": {"collection": "racks", "id_prefix": "rack"},
    "/api/cage-slots": {"collection": "slots", "id_prefix": "slot"},
    "/api/occupancies": {"collection": "occupancies", "id_prefix": "occ"},
    "/api/placement-tasks": {"collection": "placementTasks", "id_prefix": "ptask"},
    "/api/billing-rules": {"collection": "billingRules", "id_prefix": "rule"},
    "/api/billing-adjustments": {"collection": "adjustments", "id_prefix": "adj"},
    "/api/intake-batches": {"collection": "intakeBatches", "id_prefix": "batch"},
}
