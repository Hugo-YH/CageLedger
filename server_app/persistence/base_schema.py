from server_app.persistence.audit_storage import ensure_schema as ensure_audit_storage
from server_app.persistence.billing_snapshot_storage import ensure_schema as ensure_bill_snapshot_storage
from server_app.persistence.money_fields import ensure_schema as ensure_money_fields

from .billing_schema import initialize_billing_schema
from .infrastructure_schema import initialize_infrastructure_schema
from .inspection_schema import initialize_inspection_schema
from .reimbursement_schema import initialize_reimbursement_schema
from .system_schema import initialize_system_schema


def initialize_base_schema(
    conn, *, migrate_schema, repair_missing_cage_slots, create_performance_indexes, ensure_default_admin
):
    initialize_infrastructure_schema(conn)
    initialize_billing_schema(conn)
    initialize_reimbursement_schema(conn)
    initialize_system_schema(conn)
    initialize_inspection_schema(conn)
    ensure_bill_snapshot_storage(conn)
    migrate_schema(conn)
    ensure_money_fields(conn)
    ensure_audit_storage(conn)
    repair_missing_cage_slots(conn)
    create_performance_indexes(conn)
    conn.commit()
    ensure_default_admin(conn)
