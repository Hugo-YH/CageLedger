#!/usr/bin/env python3
import mimetypes
from http import HTTPStatus
from urllib.parse import parse_qs, unquote, urlparse

try:
    import openpyxl
except ImportError:
    openpyxl = None


from server_app.config import (
    ANIMAL_INSPECTION_CATALOG_PATH,
    ANIMAL_INSPECTION_IMAGES_PATH,
)
from server_app.db import connect_db
from server_app.domains.administration import (
    list_performance_history,
    list_users,
    system_environment,
    system_update_status,
)
from server_app.domains.animal_management import (
    export_inspection_pdf,
)
from server_app.domains.animal_management import (
    get_attachment as get_animal_inspection_attachment,
)
from server_app.domains.animal_management import (
    get_inspection as get_animal_inspection,
)
from server_app.domains.billing.candidate_calculation import CandidateCalculation
from server_app.domains.billing.candidates import (
    list_settlement_candidates,
)
from server_app.domains.billing.generation import validate_quantity_sheet_permission
from server_app.domains.dashboard_overview import (
    dashboard_overview_payload,
    default_overview_month,
)
from server_app.domains.iacuc.sync import (
    read_principal_identities,
)
from server_app.domains.quantity.facade import (
    get_quantity_sheet,
    list_quantity_sheet_filter_options,
    list_quantity_sheets_by_month_pi,
    list_quantity_sheets_page,
)
from server_app.domains.reimbursement.application import (
    reimbursement_detail_payload,
)
from server_app.domains.reimbursement.facade import (
    get_reimbursement_record,
    list_reimbursement_records_page,
)
from server_app.domains.reimbursement_ledger import (
    get_attachment as get_reimbursement_attachment,
)
from server_app.domains.reimbursement_ledger import (
    get_claim as get_reimbursement_claim,
)
from server_app.domains.reimbursement_ledger import (
    get_obligation as get_reimbursement_obligation,
)
from server_app.domains.reimbursement_ledger import (
    list_claims as list_reimbursement_claims,
)
from server_app.domains.reimbursement_ledger import (
    list_legacy_records as list_reimbursement_legacy_records,
)
from server_app.domains.reimbursement_ledger import (
    list_obligations as list_reimbursement_obligations,
)
from server_app.domains.state.persistence import (
    read_cached_state,
    read_state,
)
from server_app.domains.state.projections import (
    public_cage_card_payload,
)
from server_app.domains.state.query import (
    filter_state_for_actor,
)
from server_app.domains.workflow.facade import (
    current_funding_book_options,
    get_billing_workflow_detail,
    list_billing_workflow_events,
    list_billing_workflow_lines,
    list_billing_workflow_versions,
)
from server_app.domains.workflow.permissions import with_withdrawal_capabilities
from server_app.repositories.billing import (
    find_latest_quantity_sheet_pi as find_latest_quantity_sheet_pi_repository,
)
from server_app.repositories.entities import (
    list_intake_batch_filter_options,
)
from server_app.repositories.filter_options import filtered_where
from server_app.repositories.payload import (
    read_payloads,
)
from server_app.shared import clean_text, now_iso
from server_app.web.dashboard import send_overview
from server_app.web.entity_contracts import ENTITY_ENDPOINTS, WRITABLE_ENTITY_ENDPOINTS
from server_app.web.pdf_exports import (
    download_billing_statement_pdf,
    download_pdf_export_job,
    download_quantity_sheet_pdf,
    read_pdf_export_job,
)
from server_app.web.ports import app_ports


class ReadActionsMixin:
    def get_pdf_export_job(self, path, pdf_job_id, pdf_job_download):
        (download_pdf_export_job if pdf_job_download else read_pdf_export_job)(self, pdf_job_id)
        return

    def get_public_cage_card(self, path):
        qr_id = unquote(path.rsplit("/", 1)[-1])
        try:
            with connect_db() as conn:
                self.send_json(public_cage_card_payload(conn, qr_id))
        except LookupError as exc:
            self.send_json({"error": str(exc)}, HTTPStatus.NOT_FOUND)
        return

    def get_state(self, path):
        user = self.require_user()
        if not user:
            return
        payload = read_state()
        self.send_json({**payload, "state": filter_state_for_actor(payload.get("state"), user)})
        return

    def get_bootstrap(self, path):
        user = self.require_user()
        if not user:
            return
        with connect_db() as conn:
            query = parse_qs(urlparse(self.path).query)
            scope = clean_text(query.get("scope", ["summary"])[0]).lower() or "summary"
            room_id = clean_text(query.get("roomId", [""])[0])
            self.send_json(app_ports().read_bootstrap_state(conn, user, scope, room_id))
        return

    def get_dashboard_overview(self, path):
        user = self.require_user()
        if not user:
            return
        with connect_db() as conn:
            query = parse_qs(urlparse(self.path).query)
            month = clean_text(query.get("month", [""])[0])
            if not month:
                month = default_overview_month()

            def calculate(billing_month, pi):
                return app_ports().generate_billing_statement_by_pi(
                    conn, {"month": billing_month, "pi": pi, "sourceType": "quantity_sheet"}, user
                )[0]

            calculation = CandidateCalculation(conn, calculate)
            send_overview(
                self,
                dashboard_overview_payload(
                    conn, month, calculate=calculation, prepare_calculations=calculation.prepare
                ),
            )
        return

    def get_reimbursement_ledger_obligations(self, path):
        user = self.require_user()
        if not user:
            return
        with connect_db() as conn:
            self.send_json(
                list_reimbursement_obligations(conn, user, self.list_filters(default_limit=20, max_limit=10000))
            )
        return

    def get_reimbursement_ledger_claims(self, path):
        user = self.require_user()
        if not user:
            return
        with connect_db() as conn:
            self.send_json(list_reimbursement_claims(conn, user, self.list_filters(default_limit=20, max_limit=10000)))
        return

    def get_reimbursement_ledger_legacy_records(self, path):
        user = self.require_user()
        if not user:
            return
        with connect_db() as conn:
            self.send_json(
                list_reimbursement_legacy_records(conn, user, self.list_filters(default_limit=20, max_limit=10000))
            )
        return

    def get_reimbursement_attachment(self, path, attachment_id):
        user = self.require_user()
        if not user:
            return
        try:
            with connect_db() as conn:
                attachment, body = get_reimbursement_attachment(conn, user, attachment_id)
            self.send_response(HTTPStatus.OK)
            self.send_header("Content-Type", attachment["mimeType"])
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "private, no-store")
            self.end_headers()
            self.wfile.write(body)
        except LookupError as exc:
            self.send_json({"error": str(exc)}, HTTPStatus.NOT_FOUND)
        except PermissionError as exc:
            self.send_json({"error": str(exc)}, HTTPStatus.FORBIDDEN)
        return

    def get_billing_workflow_attachment_download(self, path, attachment_id):
        self.handle_billing_workflow_attachment_download(attachment_id)
        return

    def get_reimbursement_claim(self, path, claim_id):
        user = self.require_user()
        if not user:
            return
        try:
            with connect_db() as conn:
                self.send_json(get_reimbursement_claim(conn, user, claim_id))
        except LookupError as exc:
            self.send_json({"error": str(exc)}, HTTPStatus.NOT_FOUND)
        except PermissionError as exc:
            self.send_json({"error": str(exc)}, HTTPStatus.FORBIDDEN)
        return

    def get_reimbursement_obligation(self, path, obligation_id):
        user = self.require_user()
        if not user:
            return
        try:
            with connect_db() as conn:
                self.send_json(get_reimbursement_obligation(conn, user, obligation_id))
        except LookupError as exc:
            self.send_json({"error": str(exc)}, HTTPStatus.NOT_FOUND)
        return

    def get_animal_inspection_attachment(self, path, attachment_id):
        user = self.require_user()
        if not user:
            return
        try:
            with connect_db() as conn:
                attachment, body = get_animal_inspection_attachment(conn, user, attachment_id)
            self.send_response(HTTPStatus.OK)
            self.send_header("Content-Type", attachment["mimeType"])
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "private, no-store")
            self.end_headers()
            self.wfile.write(body)
        except LookupError as exc:
            self.send_json({"error": str(exc)}, HTTPStatus.NOT_FOUND)
        except PermissionError as exc:
            self.send_json({"error": str(exc)}, HTTPStatus.FORBIDDEN)
        return

    def get_animal_inspection_reference(self, path, reference_name):
        if not self.require_user():
            return
        target = (ANIMAL_INSPECTION_IMAGES_PATH / reference_name).resolve()
        root = ANIMAL_INSPECTION_IMAGES_PATH.resolve()
        if not target.is_file() or root not in target.parents:
            target = (ANIMAL_INSPECTION_CATALOG_PATH / "images" / reference_name).resolve()
            root = (ANIMAL_INSPECTION_CATALOG_PATH / "images").resolve()
        if not target.is_file() or root not in target.parents:
            self.send_json({"error": "参考图例不存在"}, HTTPStatus.NOT_FOUND)
            return
        body = target.read_bytes()
        self.send_response(HTTPStatus.OK)
        self.send_header("Content-Type", mimetypes.guess_type(target.name)[0] or "application/octet-stream")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "private, max-age=86400")
        self.end_headers()
        self.wfile.write(body)
        return

    def get_animal_inspection_pdf(self, path, inspection_id):
        user = self.require_user()
        if not user:
            return
        try:
            with connect_db() as conn:
                body, filename = export_inspection_pdf(conn, user, inspection_id)
            self.send_download(body, filename, "application/pdf")
        except LookupError as exc:
            self.send_json({"error": str(exc)}, HTTPStatus.NOT_FOUND)
        except PermissionError as exc:
            self.send_json({"error": str(exc)}, HTTPStatus.FORBIDDEN)
        except RuntimeError as exc:
            self.send_json({"error": str(exc)}, HTTPStatus.SERVICE_UNAVAILABLE)
        return

    def get_animal_inspection(self, path, inspection_id):
        user = self.require_user()
        if not user:
            return
        try:
            with connect_db() as conn:
                self.send_json(get_animal_inspection(conn, user, inspection_id))
        except LookupError as exc:
            self.send_json({"error": str(exc)}, HTTPStatus.NOT_FOUND)
        except PermissionError as exc:
            self.send_json({"error": str(exc)}, HTTPStatus.FORBIDDEN)
        return

    def get_iacuc_index_status(self, path):
        if not self.require_user():
            return
        payload = app_ports().read_iacuc_index()
        self.send_json({key: payload[key] for key in ("count", "updatedAt", "source")})
        return

    def get_system_update_check(self, path):
        user = self.require_user()
        if not user:
            return
        if user["role"] != "admin":
            self.send_json({"error": "需要管理员权限"}, HTTPStatus.FORBIDDEN)
            return
        try:
            self.send_json(system_update_status())
        except ValueError as exc:
            self.send_json({"error": str(exc)}, HTTPStatus.BAD_GATEWAY)
        return

    def get_system_environment(self, path):
        user = self.require_user()
        if not user:
            return
        if user["role"] != "admin":
            self.send_json({"error": "需要管理员权限"}, HTTPStatus.FORBIDDEN)
            return
        self.send_json(system_environment())
        return

    def get_system_performance_history(self, path):
        user = self.require_user()
        if not user:
            return
        if user["role"] != "admin":
            self.send_json({"error": "需要管理员权限"}, HTTPStatus.FORBIDDEN)
            return
        hours = parse_qs(urlparse(self.path).query).get("hours", ["24"])[0]
        try:
            self.send_json(list_performance_history(hours))
        except ValueError:
            self.send_json({"error": "hours 必须是整数"}, HTTPStatus.BAD_REQUEST)
        return

    def get_users(self, path):
        user = self.require_user()
        if not user:
            return
        if user["role"] != "admin":
            self.send_json({"error": "需要管理员权限"}, HTTPStatus.FORBIDDEN)
            return
        with connect_db() as conn:
            self.send_json({"users": list_users(conn)})
        return

    def get_quantity_sheets(self, path):
        if not self.require_user():
            return
        with connect_db() as conn:
            self.send_json(list_quantity_sheets_page(conn, self.list_filters()))
        return

    def get_quantity_sheets_filter_options(self, path):
        if not self.require_user():
            return
        query = parse_qs(urlparse(self.path).query)
        column = clean_text(query.get("column", [""])[0])
        with connect_db() as conn:
            self.send_json(list_quantity_sheet_filter_options(conn, self.list_filters(), column))
        return

    def get_quantity_sheets_pi_history(self, path):
        user = self.require_user()
        if not user:
            return
        query = parse_qs(urlparse(self.path).query)
        iacuc = clean_text(query.get("iacuc", [""])[0]).upper()
        before_month = clean_text(query.get("beforeMonth", [""])[0])
        if not iacuc or not before_month:
            self.send_json({"error": "缺少 iacuc 或 beforeMonth 参数"}, HTTPStatus.BAD_REQUEST)
            return
        with connect_db() as conn:
            self.send_json({"item": find_latest_quantity_sheet_pi_repository(conn, iacuc, before_month)})
        return

    def get_quantity_sheet_rooms(self, path):
        if not self.require_user():
            return
        with connect_db() as conn:
            rooms = read_payloads(conn, "rooms", "rowid")
        self.send_json({"items": rooms})
        return

    def get_quantity_sheet_pdf(self, path, sheet_id):
        download_quantity_sheet_pdf(
            self,
            sheet_id,
            connect_db=connect_db,
            get_quantity_sheet=get_quantity_sheet,
            validate_permission=validate_quantity_sheet_permission,
        )
        return

    def get_quantity_sheet(self, path, sheet_id):
        user = self.require_user()
        if not user:
            return
        try:
            with connect_db() as conn:
                sheet = get_quantity_sheet(conn, sheet_id)
                validate_quantity_sheet_permission(user, sheet)
                self.send_json({"item": sheet})
        except LookupError as exc:
            self.send_json({"error": str(exc)}, HTTPStatus.NOT_FOUND)
        except PermissionError as exc:
            self.send_json({"error": str(exc)}, HTTPStatus.FORBIDDEN)
        return

    def get_principal_identities(self, path):
        user = self.require_user()
        if not user:
            return
        self.send_json({"items": read_principal_identities()})
        return

    def get_infrastructure_occupancies(self, path):
        user = self.require_user()
        if not user:
            return
        query = parse_qs(urlparse(self.path).query)
        filters = {
            "month": clean_text(query.get("month", [""])[0]),
            "iacuc": clean_text(query.get("iacuc", [""])[0]),
            "pi": clean_text(query.get("pi", [""])[0]),
        }
        try:
            with connect_db() as conn:
                self.send_json(app_ports().read_billing_occupancies(conn, user, filters))
        except ValueError as exc:
            self.send_json({"error": str(exc)}, HTTPStatus.BAD_REQUEST)
        return

    def get_billing_workflows(self, path):
        user = self.require_user()
        if not user:
            return
        with connect_db() as conn:
            payload = app_ports().list_billing_workflows_page(conn, self.list_filters())
            self.send_json({**payload, "items": with_withdrawal_capabilities(conn, user, payload["items"])})
        return

    def get_reimbursement_records(self, path):
        user = self.require_user()
        if not user:
            return
        with connect_db() as conn:
            self.send_json(list_reimbursement_records_page(conn, self.list_filters()))
        return

    def get_billing_workflow_funding_options(self, path, workflow_id):
        user = self.require_user()
        if not user:
            return
        try:
            with connect_db() as conn:
                self.send_json(current_funding_book_options(conn, workflow_id))
        except LookupError as exc:
            self.send_json({"error": str(exc)}, HTTPStatus.NOT_FOUND)
        return

    def get_billing_workflow_lines(self, path, workflow_id):
        user = self.require_user()
        if not user:
            return
        query = parse_qs(urlparse(self.path).query)
        version_id = clean_text(query.get("versionId", [""])[0])
        try:
            with connect_db() as conn:
                self.send_json(list_billing_workflow_lines(conn, workflow_id, version_id))
        except LookupError as exc:
            self.send_json({"error": str(exc)}, HTTPStatus.NOT_FOUND)
        return

    def get_billing_workflow(self, path, workflow_id):
        user = self.require_user()
        if not user:
            return
        with connect_db() as conn:
            workflow = get_billing_workflow_detail(conn, workflow_id)
            if not workflow:
                self.send_json({"error": "结算流程不存在"}, HTTPStatus.NOT_FOUND)
                return
            self.send_json(
                {
                    "workflow": with_withdrawal_capabilities(conn, user, [workflow])[0],
                    "versions": list_billing_workflow_versions(conn, workflow_id),
                    "events": list_billing_workflow_events(conn, workflow_id),
                }
            )
        return

    def get_reimbursement_record(self, path, reimbursement_id):
        user = self.require_user()
        if not user:
            return
        with connect_db() as conn:
            record = get_reimbursement_record(conn, reimbursement_id)
            if not record:
                self.send_json({"error": "报销台账不存在"}, HTTPStatus.NOT_FOUND)
                return
            self.send_json(reimbursement_detail_payload(conn, record))
        return

    def get_billing_statements(self, path):
        user = self.require_user()
        if not user:
            return
        with connect_db() as conn:
            self.send_json({"items": app_ports().list_current_billing_statements(conn)})
        return

    def get_billing_settlement_candidates(self, path):
        user = self.require_user()
        if not user:
            return
        filters = self.list_filters(default_limit=10, max_limit=100)
        with connect_db() as conn:

            def calculate(month, pi):
                payload = {"month": month, "pi": pi, "sourceType": "quantity_sheet"}
                return app_ports().generate_billing_statement_by_pi(conn, payload, user)[0]

            payload = list_settlement_candidates(conn, filters, calculate, "quantity_sheet", now_iso())
            self.send_json(
                {
                    **payload,
                    "items": with_withdrawal_capabilities(conn, user, payload["items"], id_key="workflowId"),
                }
            )
        return

    def get_billing_settlements_pdf(self, path):
        download_billing_statement_pdf(
            self,
            connect_db=connect_db,
            list_quantity_sheets_by_month_pi=list_quantity_sheets_by_month_pi,
            validate_permission=validate_quantity_sheet_permission,
            generate_statement=app_ports().generate_billing_statement_by_pi,
            clean_text=clean_text,
        )
        return

    def get_intake_batches_filter_options(self, path):
        if not self.require_user():
            return
        query = parse_qs(urlparse(self.path).query)
        column = clean_text(query.get("column", [""])[0])
        with connect_db() as conn:
            self.send_json(list_intake_batch_filter_options(conn, self.list_filters(), filtered_where, column))
        return

    def get_billing_statement(self, path, statement_id):
        user = self.require_user()
        if not user:
            return
        with connect_db() as conn:
            statement = app_ports().get_current_billing_statement(conn, statement_id)
            if not statement:
                self.send_json({"error": "结算单不存在"}, HTTPStatus.NOT_FOUND)
                return
            self.send_json({"item": statement})
        return

    def get_entity_list(self, path):
        user = self.require_user()
        if not user:
            return
        self.send_entity_list(ENTITY_ENDPOINTS[path], user)
        return

    def get_entity(self, path, endpoint, item_id):
        user = self.require_user()
        if not user:
            return
        collection = WRITABLE_ENTITY_ENDPOINTS[endpoint]["collection"]
        with connect_db() as conn:
            state = filter_state_for_actor(read_cached_state(conn), user)
        item = next((entry for entry in state.get(collection, []) if entry.get("id") == item_id), None)
        if not item:
            self.send_json({"error": "记录不存在"}, HTTPStatus.NOT_FOUND)
            return
        self.send_json({"item": item})
        return
