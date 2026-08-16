"""Legacy-compatible schema initialization and repair orchestration."""

from server_app.config import ANIMAL_INSPECTION_CATALOG_PATH, ANIMAL_INSPECTION_IMAGES_PATH
from server_app.domains.administration import ensure_default_admin
from server_app.domains.animal_management import ensure_catalog as ensure_animal_inspection_catalog
from server_app.domains.animal_management.catalog_images import ensure_seed_images
from server_app.domains.reimbursement.migration import migrate_reimbursement_record_schema
from server_app.domains.state.entity_rules import empty_state
from server_app.domains.state.occupancy import occupancy_structured_values, occupancy_with_snapshots
from server_app.domains.state.persistence import assemble_state, read_applications_by_iacuc
from server_app.domains.workflow.constants import (
    VERSION_STATUS_ACTIVE,
    VERSION_STATUS_VOIDED,
    WORKFLOW_STATUS_GENERATED,
)
from server_app.domains.workflow.payloads import (
    billing_workflow_business_key,
    build_version_payload,
    build_workflow_event_payload,
    build_workflow_payload,
    enrich_statement_for_workflow,
    make_statement_document_number,
    normalize_workflow_source,
    workflow_scope_for_statement,
)
from server_app.persistence import SchemaRegistry, SchemaStep, backfills
from server_app.persistence.base_schema import initialize_base_schema
from server_app.persistence.indexes import create_performance_indexes
from server_app.persistence.legacy_migrations import (
    backfill_occupancy_structured_columns as backfill_occupancy_structured_columns_migration,
)
from server_app.persistence.legacy_migrations import (
    ensure_experiment_applications_duplicate_schema,
    ensure_intake_batch_structured_columns,
    ensure_occupancies_history_schema,
)
from server_app.persistence.legacy_migrations import (
    ensure_occupancies_structured_columns as ensure_occupancies_structured_columns_migration,
)
from server_app.persistence.workflow_migration import (
    BillingWorkflowMigrationPorts,
)
from server_app.persistence.workflow_migration import (
    backfill_billing_workflow_scope as backfill_billing_workflow_scope_migration,
)
from server_app.persistence.workflow_migration import (
    migrate_billing_workflow_schema as migrate_billing_workflow_schema_migration,
)
from server_app.repositories.payload import dump_json, read_setting, set_setting, table_has_rows
from server_app.shared import as_int, new_id, now_iso

REIMBURSEMENT_MIGRATION_KEY = "reimbursementRecordMigrationDone"
BILLING_WORKFLOW_MIGRATION_KEY = "billingWorkflowMigrationDone"


def initialize_legacy_schema(conn):
    initialize_base_schema(
        conn,
        migrate_schema=migrate_schema,
        repair_missing_cage_slots=repair_missing_cage_slots,
        create_performance_indexes=create_performance_indexes,
        ensure_default_admin=ensure_default_admin,
    )


def initialize_schema(conn):
    registry = SchemaRegistry(
        [
            SchemaStep("legacy-schema", initialize_legacy_schema),
            SchemaStep("animal-inspection-catalog", ensure_animal_inspection_catalog),
            SchemaStep(
                "animal-inspection-images",
                lambda conn: ensure_seed_images(
                    ANIMAL_INSPECTION_IMAGES_PATH, ANIMAL_INSPECTION_CATALOG_PATH / "images"
                ),
            ),
        ]
    )
    registry.apply(conn)


def migrate_schema(conn):
    ensure_experiment_applications_duplicate_schema(conn)
    ensure_occupancies_history_schema(conn)
    ensure_occupancies_structured_columns_migration(conn, backfill_occupancy_structured_columns)
    ensure_intake_batch_structured_columns(conn)
    migrate_billing_workflow_schema(conn)
    backfill_billing_workflow_scope(conn)
    migrate_reimbursement_record_schema(conn)
    backfills.backfill_quantity_sheet_staff(conn)
    backfills.ensure_users_phone_column(conn)
    backfills.ensure_users_billing_lock_column(conn)


def backfill_occupancy_structured_columns(conn):
    return backfill_occupancy_structured_columns_migration(
        conn,
        assemble_state=assemble_state,
        empty_state=empty_state,
        read_applications_by_iacuc=read_applications_by_iacuc,
        occupancy_with_snapshots=occupancy_with_snapshots,
        occupancy_structured_values=occupancy_structured_values,
    )


def migrate_billing_workflow_schema(conn):
    return migrate_billing_workflow_schema_migration(
        conn,
        billing_workflow_migration_ports(),
        migration_key=BILLING_WORKFLOW_MIGRATION_KEY,
        generated_status=WORKFLOW_STATUS_GENERATED,
        active_version_status=VERSION_STATUS_ACTIVE,
        voided_version_status=VERSION_STATUS_VOIDED,
    )


def backfill_billing_workflow_scope(conn):
    return backfill_billing_workflow_scope_migration(conn, billing_workflow_migration_ports())


def billing_workflow_migration_ports():
    return BillingWorkflowMigrationPorts(
        read_setting=read_setting,
        table_has_rows=table_has_rows,
        set_setting=set_setting,
        now_iso=now_iso,
        normalize_source=normalize_workflow_source,
        workflow_scope=workflow_scope_for_statement,
        business_key=billing_workflow_business_key,
        new_id=new_id,
        dump_json=dump_json,
        document_number=make_statement_document_number,
        enrich_statement=enrich_statement_for_workflow,
        build_version=build_version_payload,
        build_event=build_workflow_event_payload,
        build_workflow=build_workflow_payload,
    )


def table_columns(conn, table):
    return {
        row["name"]: {"type": row["type"], "notnull": bool(row["notnull"]), "pk": int(row["pk"] or 0)}
        for row in conn.execute(f"PRAGMA table_info({table})").fetchall()
    }


def repair_missing_cage_slots(conn):
    racks = conn.execute("SELECT id, rows, cols FROM racks").fetchall()
    if not racks:
        return

    existing_rows = conn.execute("SELECT rack_id, row_no, col_no FROM cage_slots").fetchall()
    existing_positions = {(row["rack_id"], int(row["row_no"] or 0), int(row["col_no"] or 0)) for row in existing_rows}
    for rack in racks:
        rows = max(as_int(rack["rows"]) or 0, 0)
        cols = max(as_int(rack["cols"]) or 0, 0)
        for row_no in range(1, rows + 1):
            for col_no in range(1, cols + 1):
                position = (rack["id"], row_no, col_no)
                if position in existing_positions:
                    continue
                slot = {
                    "id": slot_id_for_rack(rack["id"], row_no, col_no),
                    "rackId": rack["id"],
                    "row": row_no,
                    "col": col_no,
                    "code": f"{column_label(col_no)}{row_no}",
                    "status": "empty",
                }
                conn.execute(
                    """
                    INSERT INTO cage_slots (id, rack_id, row_no, col_no, code, status, payload)
                    VALUES (?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        slot["id"],
                        slot["rackId"],
                        slot["row"],
                        slot["col"],
                        slot["code"],
                        slot["status"],
                        dump_json(slot),
                    ),
                )
                existing_positions.add(position)


def slot_id_for_rack(rack_id, row_no, col_no):
    suffix = str(rack_id).removeprefix("rack-")
    return f"slot-{suffix}-{row_no}-{col_no}"


def column_label(index):
    value = int(index)
    label = ""
    while value > 0:
        value -= 1
        label = chr(65 + (value % 26)) + label
        value //= 26
    return label or "A"
