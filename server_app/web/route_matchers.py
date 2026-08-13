from urllib.parse import unquote


def animal_inspection_route(path):
    return _after_prefix(path, "/api/animal-inspections/")


def reimbursement_claim_route(path):
    return _after_prefix(path, "/api/reimbursement-ledger/claims/")


def reimbursement_obligation_route(path):
    return _after_prefix(path, "/api/reimbursement-ledger/obligations/")


def reimbursement_attachment_route(path):
    return _after_prefix(path, "/api/reimbursement-ledger/attachments/")


def reimbursement_claim_attachment_upload_route(path):
    return _between(path, "/api/reimbursement-ledger/claims/", "/attachments")


def billing_workflow_attachment_upload_route(path):
    return _between(path, "/api/billing-workflows/", "/attachments")


def billing_workflow_reimbursement_recording_route(path):
    return _between(path, "/api/billing-workflows/", "/reimbursement-forms")


def billing_workflow_attachment_download_route(path):
    return _between(path, "/api/billing-workflows/attachments/", "")


def reimbursement_claim_allocation_route(path):
    return _between(path, "/api/reimbursement-ledger/claims/", "/allocations")


def reimbursement_allocation_action_route(path, action):
    return _between(path, "/api/reimbursement-ledger/allocations/", f"/{action}")


def reimbursement_legacy_migration_route(path):
    return _between(path, "/api/reimbursement-ledger/legacy-records/", "/migrate")


def animal_inspection_submit_route(path):
    return _between(path, "/api/animal-inspections/", "/submit")


def animal_inspection_pdf_route(path):
    return _between(path, "/api/animal-inspections/", "/export-pdf")


def animal_inspection_attachment_upload_route(path, finding_id):
    inspection_id = _between(path, "/api/animal-inspections/", "/attachments")
    return (inspection_id, finding_id) if inspection_id and finding_id else (None, None)


def animal_inspection_attachment_route(path):
    return _after_prefix(path, "/api/animal-inspection-attachments/")


def animal_inspection_reference_route(path):
    return _after_prefix(path, "/api/animal-inspection-reference/")


def catalog_version_restore_route(path):
    return _between(path, "/api/animal-inspection-catalog/versions/", "/restore")


def animal_inspection_finding_action_route(path, action):
    return _between(path, "/api/animal-inspection-findings/", f"/{action}")


def user_route(path):
    return _after_prefix(path, "/api/users/")


def quantity_sheet_route(path):
    return _after_prefix(path, "/api/quantity-sheets/")


def billing_statement_route(path):
    return _after_prefix(path, "/api/billing-statements/")


def principal_identity_route(path):
    return _after_prefix(path, "/api/principal-identities/")


def billing_workflow_route(path):
    return _after_prefix(path, "/api/billing-workflows/")


def billing_workflow_lines_route(path):
    return _between(path, "/api/billing-workflows/", "/lines")


def reimbursement_record_route(path):
    return _after_prefix(path, "/api/reimbursement-records/")


def intake_batch_confirm_route(path):
    return _between(path, "/api/intake-batches/", "/confirm-receipt")


def placement_task_action_route(path, action):
    return _between(path, "/api/placement-tasks/", f"/{action}")


def quantity_sheet_generate_route(path):
    return _between(path, "/api/quantity-sheets/", "/generate-statement")


def _after_prefix(path, prefix):
    if not path.startswith(prefix):
        return None
    return _single_segment(path[len(prefix) :])


def _between(path, prefix, suffix):
    if not path.startswith(prefix) or not path.endswith(suffix):
        return None
    return _single_segment(path[len(prefix) : -len(suffix)])


def _single_segment(value):
    decoded = unquote(value)
    return decoded if decoded and "/" not in decoded else None
