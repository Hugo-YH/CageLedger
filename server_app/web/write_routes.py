#!/usr/bin/env python3
import sqlite3
from http import HTTPStatus
from urllib.parse import urlparse

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
from server_app.web.entity_contracts import WRITABLE_ENTITY_ENDPOINTS
from server_app.web.monthly_summary import export_monthly_billing_summary
from server_app.web.pdf_exports import (
    export_billing_statement_pdfs,
    export_quantity_sheet_pdfs,
    start_pdf_export,
)
from server_app.web.ports import app_ports
from server_app.web.router_registry import API_ROUTER


class WriteRoutesMixin:
    def do_POST(self):
        path = urlparse(self.path).path
        if routed := API_ROUTER.dispatch("POST", path, self):
            self.send_json(routed.payload, routed.status)
            return
        if path == "/api/auth/login":
            self.handle_login()
            return
        if path == "/api/auth/logout":
            self.handle_logout()
            return
        if path == "/api/animal-inspections":
            self.handle_animal_inspection_save(None)
            return
        if path == "/api/animal-inspection-catalog/draft/publish":
            self.handle_animal_inspection_catalog_publish()
            return
        if path == "/api/animal-inspection-catalog/images":
            self.handle_animal_inspection_catalog_image_upload()
            return
        version = self.catalog_version_restore_route(path)
        if version:
            self.handle_animal_inspection_catalog_version_restore(version)
            return
        inspection_id = self.animal_inspection_submit_route(path)
        if inspection_id:
            self.handle_animal_inspection_submit(inspection_id)
            return
        inspection_id, finding_id = self.animal_inspection_attachment_upload_route(path)
        if inspection_id and finding_id:
            self.handle_animal_inspection_attachment(inspection_id, finding_id)
            return
        finding_id = self.animal_inspection_finding_action_route(path, "actions")
        if finding_id:
            self.handle_animal_inspection_finding_update(finding_id)
            return
        finding_id = self.animal_inspection_finding_action_route(path, "recheck")
        if finding_id:
            self.handle_animal_inspection_finding_recheck(finding_id)
            return
        finding_id = self.animal_inspection_finding_action_route(path, "resolve")
        if finding_id:
            self.handle_animal_inspection_finding_resolve(finding_id)
            return
        if path == "/api/reimbursement-ledger/claims":
            self.handle_reimbursement_claim_save(None)
            return
        claim_id = self.reimbursement_claim_attachment_upload_route(path)
        if claim_id:
            self.handle_reimbursement_claim_attachment(claim_id)
            return
        claim_id = self.reimbursement_claim_allocation_route(path)
        if claim_id:
            self.handle_reimbursement_allocation_create(claim_id)
            return
        allocation_id = self.reimbursement_allocation_action_route(path, "confirm")
        if allocation_id:
            self.handle_reimbursement_allocation_confirm(allocation_id)
            return
        allocation_id = self.reimbursement_allocation_action_route(path, "reverse")
        if allocation_id:
            self.handle_reimbursement_allocation_reverse(allocation_id)
            return
        legacy_id = self.reimbursement_legacy_migration_route(path)
        if legacy_id:
            self.handle_reimbursement_legacy_migration(legacy_id)
            return
        if path == "/api/iacuc-index/upload":
            self.handle_iacuc_upload()
            return
        if path == "/api/billing-statements/generate":
            self.handle_billing_statement_generate()
            return
        if path == "/api/billing-statements/generate-by-pi":
            self.handle_billing_statement_generate_by_pi()
            return
        if path == "/api/quantity-sheets/pdf-export":
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
        if path == "/api/billing-settlements/pdf-export":
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
        if path == "/api/billing-settlements/xlsx":
            download_settlement_xlsx(
                self,
                connect_db=connect_db,
                generate_statement=app_ports().generate_billing_statement_by_pi,
                clean_text=clean_text,
            )
            return
        if path == "/api/billing-monthly-summary/export":
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
        if path == "/api/pdf-exports":
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
        if path == "/api/billing-workflows/advance":
            self.handle_billing_workflow_advance()
            return
        workflow_id = self.billing_workflow_reimbursement_recording_route(path)
        if workflow_id:
            self.handle_billing_workflow_reimbursement_recording(workflow_id)
            return
        workflow_id = self.billing_workflow_attachment_upload_route(path)
        if workflow_id:
            self.handle_billing_workflow_attachment_upload(workflow_id)
            return
        if path == "/api/reimbursement-records/import-monthly":
            self.handle_reimbursement_monthly_import()
            return
        if path == "/api/reimbursement-records/import-arrears":
            self.handle_reimbursement_arrears_import()
            return
        if path == "/api/infrastructure":
            self.handle_infrastructure_write()
            return
        sheet_id = self.quantity_sheet_generate_route(path)
        if sheet_id:
            self.handle_quantity_sheet_statement_generate(sheet_id)
            return
        if path == "/api/quantity-sheets":
            self.handle_quantity_sheet_save(None)
            return
        if path == "/api/quantity-sheets/print-data":
            self.handle_quantity_sheet_print_data()
            return
        if path == "/api/intake-batches/mark-printed":
            self.handle_intake_batches_mark_printed()
            return
        if path == "/api/intake-batches/confirm-receipt":
            self.handle_intake_batches_confirm_receipt()
            return
        batch_id = self.intake_batch_confirm_route(path)
        if batch_id:
            self.handle_intake_batch_confirm(batch_id)
            return
        task_id = self.placement_task_action_route(path, "reserve")
        if task_id:
            self.handle_placement_task_reserve(task_id)
            return
        task_id = self.placement_task_action_route(path, "move-in")
        if task_id:
            self.handle_placement_task_move_in(task_id)
            return
        task_id = self.placement_task_action_route(path, "reassign-room")
        if task_id:
            self.handle_placement_task_reassign_room(task_id)
            return
        if path == "/api/users":
            user = self.require_user()
            if not user:
                return
            if user["role"] != "admin":
                self.send_json({"error": "需要管理员权限"}, HTTPStatus.FORBIDDEN)
                return
            try:
                body = self.read_json_body()
                with connect_db() as conn:
                    created = create_user(conn, body)
                self.send_json({"user": created}, HTTPStatus.CREATED)
            except sqlite3.IntegrityError:
                self.send_json({"error": "用户名已存在"}, HTTPStatus.CONFLICT)
            except ValueError as exc:
                self.send_json({"error": str(exc)}, HTTPStatus.BAD_REQUEST)
            return
        if path in WRITABLE_ENTITY_ENDPOINTS:
            self.handle_entity_write("POST", path, None)
            return
        self.send_error(HTTPStatus.NOT_FOUND)

    def do_PUT(self):
        path = urlparse(self.path).path
        if path == "/api/animal-inspection-catalog/draft":
            self.handle_animal_inspection_catalog_draft_save()
            return
        claim_id = self.reimbursement_claim_route(path)
        if claim_id:
            self.handle_reimbursement_claim_save(claim_id)
            return
        inspection_id = self.animal_inspection_route(path)
        if inspection_id:
            self.handle_animal_inspection_save(inspection_id)
            return
        if path == "/api/state":
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

        user_id = self.user_route(path)
        if user_id:
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

        endpoint, item_id = self.entity_route(path)
        if endpoint and item_id:
            self.handle_entity_write("PUT", endpoint, item_id)
            return
        principal_name = self.principal_identity_route(path)
        if principal_name:
            self.handle_principal_identity_save(principal_name)
            return
        sheet_id = self.quantity_sheet_route(path)
        if sheet_id:
            self.handle_quantity_sheet_save(sheet_id)
            return
        reimbursement_id = self.reimbursement_record_route(path)
        if reimbursement_id:
            self.handle_reimbursement_record_update(reimbursement_id)
            return
        self.send_error(HTTPStatus.NOT_FOUND)

    def do_DELETE(self):
        path = urlparse(self.path).path
        user_id = self.user_route(path)
        if user_id:
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

        endpoint, item_id = self.entity_route(path)
        if endpoint and item_id:
            self.handle_entity_write("DELETE", endpoint, item_id)
            return
        sheet_id = self.quantity_sheet_route(path)
        if sheet_id:
            self.handle_quantity_sheet_delete(sheet_id)
            return
        workflow_id = self.billing_workflow_route(path)
        if workflow_id:
            self.handle_billing_workflow_delete(workflow_id)
            return
        claim_id = self.reimbursement_claim_route(path)
        if claim_id:
            self.handle_reimbursement_claim_delete(claim_id)
            return
        reimbursement_id = self.reimbursement_record_route(path)
        if reimbursement_id:
            self.handle_reimbursement_record_delete(reimbursement_id)
            return
        self.send_error(HTTPStatus.NOT_FOUND)
