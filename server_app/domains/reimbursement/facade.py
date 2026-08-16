"""Compatibility-facing reimbursement record persistence facade."""

import json

from server_app.repositories.reimbursement import (
    delete_reimbursement_record as delete_reimbursement_record_repository,
)
from server_app.repositories.reimbursement import (
    get_reimbursement_record as get_reimbursement_record_repository,
)
from server_app.repositories.reimbursement import (
    get_reimbursement_record_by_key as get_reimbursement_record_by_key_repository,
)
from server_app.repositories.reimbursement import (
    get_reimbursement_record_by_workflow_id as get_reimbursement_record_by_workflow_id_repository,
)
from server_app.repositories.reimbursement import (
    list_reimbursement_record_summaries_for_pi as list_reimbursement_record_summaries_for_pi_repository,
)
from server_app.repositories.reimbursement import (
    list_reimbursement_records_for_pi as list_reimbursement_records_for_pi_repository,
)
from server_app.repositories.reimbursement import (
    list_reimbursement_records_page as list_reimbursement_records_page_repository,
)
from server_app.repositories.reimbursement import (
    upsert_reimbursement_record as upsert_reimbursement_record_repository,
)
from server_app.shared import clean_text


def list_reimbursement_records_page(conn, filters):
    return list_reimbursement_records_page_repository(conn, filters, clean_text)


def get_reimbursement_record(conn, record_id):
    return get_reimbursement_record_repository(conn, record_id)


def get_reimbursement_record_by_key(conn, business_key):
    return get_reimbursement_record_by_key_repository(conn, business_key)


def get_reimbursement_record_by_workflow_id(conn, workflow_id):
    return get_reimbursement_record_by_workflow_id_repository(conn, workflow_id)


def list_reimbursement_records_for_pi(conn, pi_name):
    return list_reimbursement_records_for_pi_repository(conn, pi_name)


def list_reimbursement_record_summaries_for_pi(conn, pi_name):
    return list_reimbursement_record_summaries_for_pi_repository(conn, pi_name)


def upsert_reimbursement_record(conn, payload):
    existing_by_key = get_reimbursement_record_by_key(conn, payload.get("businessKey", ""))
    if existing_by_key and existing_by_key.get("id"):
        payload["id"] = existing_by_key["id"]
    else:
        row = conn.execute(
            "SELECT payload FROM reimbursement_records WHERE id = ?", (payload.get("id", ""),)
        ).fetchone()
        if row:
            existing_by_id = json.loads(row["payload"])
            payload["id"] = existing_by_id.get("id", payload.get("id", ""))
            if not payload.get("businessKey") and existing_by_id.get("businessKey"):
                payload["businessKey"] = existing_by_id["businessKey"]
    upsert_reimbursement_record_repository(conn, payload)


def delete_reimbursement_record(conn, record_id):
    delete_reimbursement_record_repository(conn, record_id)
