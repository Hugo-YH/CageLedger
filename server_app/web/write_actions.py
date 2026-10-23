#!/usr/bin/env python3
import sqlite3
from http import HTTPStatus

try:
    import openpyxl
except ImportError:
    openpyxl = None


from server_app.db import connect_db
from server_app.domains.administration import (
    audit_event,
    create_user,
    delete_user,
    update_user,
    write_audit_events,
)
from server_app.domains.billing.generation import validate_quantity_sheet_permission
from server_app.domains.quantity.facade import (
    get_quantity_sheet,
    list_quantity_sheets_by_month,
    list_quantity_sheets_by_month_pi,
)
from server_app.domains.state.commands import write_state
from server_app.domains.state.persistence import (
    read_applications_by_iacuc,
)
from server_app.domains.workflow.facade import (
    list_billing_workflows_by_month,
)
from server_app.shared import clean_text, now_iso
from server_app.shared.concurrency import StaleWriteError
from server_app.web import download_settlement_xlsx
from server_app.web.monthly_summary import export_monthly_billing_summary
from server_app.web.pdf_exports import (
    export_billing_statement_pdfs,
    export_quantity_sheet_pdfs,
    start_pdf_export,
)
from server_app.web.ports import app_ports


class WriteActionsMixin:
    def post_auth_login(self, path):
        self.handle_login()
        return

    def post_auth_logout(self, path):
        self.handle_logout()
        return

    def post_animal_inspections(self, path):
        self.handle_animal_inspection_save(None)
        return

    def post_animal_inspection_catalog_draft_publish(self, path):
        self.handle_animal_inspection_catalog_publish()
        return

    def post_animal_inspection_catalog_images(self, path):
        self.handle_animal_inspection_catalog_image_upload()
        return

    def post_catalog_version_restore(self, path, version):
        self.handle_animal_inspection_catalog_version_restore(version)
        return

    def post_animal_inspection_submit(self, path, inspection_id):
        self.handle_animal_inspection_submit(inspection_id)
        return

    def post_animal_inspection_attachment_upload(self, path, inspection_id, finding_id):
        self.handle_animal_inspection_attachment(inspection_id, finding_id)
        return

    def post_animal_inspection_finding_action_actions(self, path, finding_id):
        self.handle_animal_inspection_finding_update(finding_id)
        return

    def post_animal_inspection_finding_action_recheck(self, path, finding_id):
        self.handle_animal_inspection_finding_recheck(finding_id)
        return

    def post_animal_inspection_finding_action_resolve(self, path, finding_id):
        self.handle_animal_inspection_finding_resolve(finding_id)
        return

    def post_reimbursement_ledger_claims(self, path):
        self.handle_reimbursement_claim_save(None)
        return

    def post_reimbursement_claim_attachment_upload(self, path, claim_id):
        self.handle_reimbursement_claim_attachment(claim_id)
        return

    def post_reimbursement_claim_allocation(self, path, claim_id):
        self.handle_reimbursement_allocation_create(claim_id)
        return

    def post_reimbursement_allocation_action_confirm(self, path, allocation_id):
        self.handle_reimbursement_allocation_confirm(allocation_id)
        return

    def post_reimbursement_allocation_action_reverse(self, path, allocation_id):
        self.handle_reimbursement_allocation_reverse(allocation_id)
        return

    def post_reimbursement_legacy_migration(self, path, legacy_id):
        self.handle_reimbursement_legacy_migration(legacy_id)
        return

    def post_iacuc_index_upload(self, path):
        self.handle_iacuc_upload()
        return

    def post_billing_statements_generate(self, path):
        self.handle_billing_statement_generate()
        return

    def post_billing_statements_generate_by_pi(self, path):
        self.handle_billing_statement_generate_by_pi()
        return

    def post_quantity_sheets_pdf_export(self, path):
        export_quantity_sheet_pdfs(
            self,
            connect_db=connect_db,
            get_quantity_sheet=get_quantity_sheet,
            list_quantity_sheets_by_month_pi=list_quantity_sheets_by_month_pi,
            validate_permission=validate_quantity_sheet_permission,
            generate_statement=app_ports().generate_billing_statement_by_pi,
            clean_text=clean_text,
        )
        return

    def post_billing_settlements_pdf_export(self, path):
        export_billing_statement_pdfs(
            self,
            connect_db=connect_db,
            get_quantity_sheet=get_quantity_sheet,
            list_quantity_sheets_by_month_pi=list_quantity_sheets_by_month_pi,
            validate_permission=validate_quantity_sheet_permission,
            generate_statement=app_ports().generate_billing_statement_by_pi,
            clean_text=clean_text,
        )
        return

    def post_billing_settlements_xlsx(self, path):
        download_settlement_xlsx(
            self,
            connect_db=connect_db,
            generate_statement=app_ports().generate_billing_statement_by_pi,
            clean_text=clean_text,
        )
        return

    def post_billing_monthly_summary_export(self, path):
        export_monthly_billing_summary(
            self,
            connect_db=connect_db,
            list_quantity_sheets_by_month=list_quantity_sheets_by_month,
            list_billing_workflows_by_month=list_billing_workflows_by_month,
            read_rooms_for_quantity_sheets=app_ports().read_rooms_for_quantity_sheets,
            read_principal_type_by_pi=app_ports().read_principal_type_by_pi,
            read_applications_by_iacuc=read_applications_by_iacuc,
            audit_event=audit_event,
            write_audit_events=write_audit_events,
            now_iso=now_iso,
            clean_text=clean_text,
        )
        return

    def post_pdf_exports(self, path):
        start_pdf_export(
            self,
            connect_db=connect_db,
            get_quantity_sheet=get_quantity_sheet,
            list_quantity_sheets_by_month_pi=list_quantity_sheets_by_month_pi,
            validate_permission=validate_quantity_sheet_permission,
            generate_statement=app_ports().generate_billing_statement_by_pi,
            clean_text=clean_text,
        )
        return

    def post_billing_workflows_advance(self, path):
        self.handle_billing_workflow_advance()
        return

    def post_billing_workflow_reimbursement_recording(self, path, workflow_id):
        self.handle_billing_workflow_reimbursement_recording(workflow_id)
        return

    def post_billing_workflow_attachment_upload(self, path, workflow_id):
        self.handle_billing_workflow_attachment_upload(workflow_id)
        return

    def post_reimbursement_records_import_monthly(self, path):
        self.handle_reimbursement_monthly_import()
        return

    def post_reimbursement_records_import_arrears(self, path):
        self.handle_reimbursement_arrears_import()
        return

    def post_infrastructure(self, path):
        self.handle_infrastructure_write()
        return

    def post_quantity_sheet_generate(self, path, sheet_id):
        self.handle_quantity_sheet_statement_generate(sheet_id)
        return

    def post_quantity_sheets(self, path):
        self.handle_quantity_sheet_save(None)
        return

    def post_quantity_sheets_print_data(self, path):
        self.handle_quantity_sheet_print_data()
        return

    def post_intake_batches_mark_printed(self, path):
        self.handle_intake_batches_mark_printed()
        return

    def post_intake_batches_confirm_receipt(self, path):
        self.handle_intake_batches_confirm_receipt()
        return

    def post_intake_batch_confirm(self, path, batch_id):
        self.handle_intake_batch_confirm(batch_id)
        return

    def post_placement_task_action_reserve(self, path, task_id):
        self.handle_placement_task_reserve(task_id)
        return

    def post_placement_task_action_move_in(self, path, task_id):
        self.handle_placement_task_move_in(task_id)
        return

    def post_placement_task_action_reassign_room(self, path, task_id):
        self.handle_placement_task_reassign_room(task_id)
        return

    def post_users(self, path):
        user = self.require_user()
        if not user:
            return
        if user["role"] != "admin":
            self.send_json({"error": "需要管理员权限"}, HTTPStatus.FORBIDDEN)
            return
        try:
            body = self.read_json_body()
            with connect_db() as conn:
                created = create_user(conn, body, actor=user)
            self.send_json({"user": created}, HTTPStatus.CREATED)
        except sqlite3.IntegrityError:
            self.send_json({"error": "用户名已存在"}, HTTPStatus.CONFLICT)
        except ValueError as exc:
            self.send_json({"error": str(exc)}, HTTPStatus.BAD_REQUEST)
        return

    def post_entity_list(self, path):
        self.handle_entity_write("POST", path, None)
        return

    def put_animal_inspection_catalog_draft(self, path):
        self.handle_animal_inspection_catalog_draft_save()
        return

    def put_reimbursement_claim(self, path, claim_id):
        self.handle_reimbursement_claim_save(claim_id)
        return

    def put_animal_inspection(self, path, inspection_id):
        self.handle_animal_inspection_save(inspection_id)
        return

    def put_state(self, path):
        user = self.require_user()
        if not user:
            return

        try:
            body = self.read_json_body()
            state = body.get("state")
            if not isinstance(state, dict):
                self.send_error(HTTPStatus.BAD_REQUEST, "Request body must contain a state object")
                return
            self.send_json(write_state(state, user))
        except PermissionError as exc:
            self.send_json({"error": str(exc)}, HTTPStatus.FORBIDDEN)
        except ValueError as exc:
            self.send_error(HTTPStatus.BAD_REQUEST, str(exc))
        return

    def put_user(self, path, user_id):
        user = self.require_user()
        if not user:
            return
        if user["role"] != "admin":
            self.send_json({"error": "需要管理员权限"}, HTTPStatus.FORBIDDEN)
            return
        try:
            body = self.read_json_body()
            with connect_db() as conn:
                updated = update_user(conn, user, user_id, body)
            self.send_json({"user": updated})
        except StaleWriteError as exc:
            self.send_json({"error": str(exc)}, HTTPStatus.CONFLICT)
        except sqlite3.IntegrityError:
            self.send_json({"error": "用户名已存在"}, HTTPStatus.CONFLICT)
        except LookupError as exc:
            self.send_json({"error": str(exc)}, HTTPStatus.NOT_FOUND)
        except PermissionError as exc:
            self.send_json({"error": str(exc)}, HTTPStatus.FORBIDDEN)
        except ValueError as exc:
            self.send_json({"error": str(exc)}, HTTPStatus.BAD_REQUEST)
        return

    def put_entity(self, path, endpoint, item_id):
        self.handle_entity_write("PUT", endpoint, item_id)
        return

    def put_principal_identity(self, path, principal_name):
        self.handle_principal_identity_save(principal_name)
        return

    def put_quantity_sheet(self, path, sheet_id):
        self.handle_quantity_sheet_save(sheet_id)
        return

    def put_reimbursement_record(self, path, reimbursement_id):
        self.handle_reimbursement_record_update(reimbursement_id)
        return

    def delete_user(self, path, user_id):
        user = self.require_user()
        if not user:
            return
        if user["role"] != "admin":
            self.send_json({"error": "需要管理员权限"}, HTTPStatus.FORBIDDEN)
            return
        try:
            with connect_db() as conn:
                delete_user(conn, user, user_id)
            self.send_json({"ok": True})
        except LookupError as exc:
            self.send_json({"error": str(exc)}, HTTPStatus.NOT_FOUND)
        except PermissionError as exc:
            self.send_json({"error": str(exc)}, HTTPStatus.FORBIDDEN)
        return

    def delete_entity(self, path, endpoint, item_id):
        self.handle_entity_write("DELETE", endpoint, item_id)
        return

    def delete_quantity_sheet(self, path, sheet_id):
        self.handle_quantity_sheet_delete(sheet_id)
        return

    def delete_billing_workflow(self, path, workflow_id):
        self.handle_billing_workflow_delete(workflow_id)
        return

    def delete_reimbursement_claim(self, path, claim_id):
        self.handle_reimbursement_claim_delete(claim_id)
        return

    def delete_reimbursement_record(self, path, reimbursement_id):
        self.handle_reimbursement_record_delete(reimbursement_id)
        return
