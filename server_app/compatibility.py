"""Declared compatibility surface retained while legacy.py is decomposed."""

SERVER_EXPORTS = frozenset(
    {
        "BILLING_PRINCIPAL_INDEPENDENT",
        "BILLING_PRINCIPAL_PI",
        "DB_PATH",
        "WORKFLOW_STATUS_FINANCE",
        "WORKFLOW_STATUS_SENT",
        "assemble_state",
        "clean_text",
        "column_label",
        "connect_db",
        "delete_billing_workflow",
        "empty_state",
        "generate_billing_statement",
        "generate_billing_statement_by_pi",
        "list_billing_workflows",
        "normalize_iacuc_number",
        "now_iso",
        "save_iacuc_index_file",
        "save_principal_identity",
        "save_quantity_sheet",
        "slot_id_for_rack",
        "update_workflow_status",
        "validate_entity_payload",
        "write_experiment_applications",
        "write_state",
    }
)

LEGACY_EXPORTS = frozenset(
    {
        "connect_db",
        "empty_state",
        "get_billing_workflow_detail",
        "initialize_schema",
        "list_billing_workflows_page",
        "now_iso",
        "read_state",
        "record_archived_reimbursement",
        "update_workflow_status",
        "write_intake_batch_entity_state",
    }
)
