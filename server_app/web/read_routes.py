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
    frontend_root,
)
from server_app.db import connect_db
from server_app.domains.administration import (
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
    get_billing_workflow_detail,
    list_billing_workflow_events,
    list_billing_workflow_lines,
    list_billing_workflow_versions,
)
from server_app.repositories.billing import (
    find_latest_quantity_sheet_pi as find_latest_quantity_sheet_pi_repository,
)
from server_app.repositories.entities import (
    list_intake_batch_filter_options,
)
from server_app.repositories.filter_options import filtered_where, route_column_filter_options
from server_app.repositories.payload import (
    read_payloads,
)
from server_app.shared import clean_text, now_iso
from server_app.static import send_documentation_asset, send_frontend_asset
from server_app.web import animal_inspection as animal_inspection_web
from server_app.web.entity_contracts import ENTITY_ENDPOINTS, WRITABLE_ENTITY_ENDPOINTS
from server_app.web.pdf_exports import (
    download_billing_statement_pdf,
    download_pdf_export_job,
    download_quantity_sheet_pdf,
    pdf_export_job_route,
    quantity_sheet_pdf_route,
    read_pdf_export_job,
)
from server_app.web.ports import app_ports
from server_app.web.router_registry import API_ROUTER


class ReadRoutesMixin:
    def do_GET(self):
        path = urlparse(self.path).path
        pdf_job_id, pdf_job_download = pdf_export_job_route(path)
        if pdf_job_id:
            (download_pdf_export_job if pdf_job_download else read_pdf_export_job)(self, pdf_job_id)
            return
        if routed := API_ROUTER.dispatch("GET", path, self):
            self.send_json(routed.payload, routed.status)
            return
        if path.startswith("/api/public/cage-card/"):
            qr_id = unquote(path.rsplit("/", 1)[-1])
            try:
                with connect_db() as conn:
                    self.send_json(public_cage_card_payload(conn, qr_id))
            except LookupError as exc:
                self.send_json({"error": str(exc)}, HTTPStatus.NOT_FOUND)
            return
        if path == "/api/state":
            user = self.require_user()
            if not user:
                return
            payload = read_state()
            self.send_json({**payload, "state": filter_state_for_actor(payload.get("state"), user)})
            return
        if path == "/api/bootstrap":
            user = self.require_user()
            if not user:
                return
            with connect_db() as conn:
                query = parse_qs(urlparse(self.path).query)
                scope = clean_text(query.get("scope", ["summary"])[0]).lower() or "summary"
                room_id = clean_text(query.get("roomId", [""])[0])
                self.send_json(app_ports().read_bootstrap_state(conn, user, scope, room_id))
            return
        if path == "/api/dashboard/overview":
            user = self.require_user()
            if not user:
                return
            with connect_db() as conn:
                query = parse_qs(urlparse(self.path).query)
                month = clean_text(query.get("month", [""])[0])
                if not month:
                    month = default_overview_month()
                self.send_json(dashboard_overview_payload(conn, month))
            return
        if animal_inspection_web.handle_get(self, path):
            return
        if path == "/api/reimbursement-ledger/obligations":
            user = self.require_user()
            if not user:
                return
            with connect_db() as conn:
                self.send_json(
                    list_reimbursement_obligations(conn, user, self.list_filters(default_limit=20, max_limit=10000))
                )
            return
        if path == "/api/reimbursement-ledger/claims":
            user = self.require_user()
            if not user:
                return
            with connect_db() as conn:
                self.send_json(
                    list_reimbursement_claims(conn, user, self.list_filters(default_limit=20, max_limit=10000))
                )
            return
        if path == "/api/reimbursement-ledger/legacy-records":
            user = self.require_user()
            if not user:
                return
            with connect_db() as conn:
                self.send_json(
                    list_reimbursement_legacy_records(conn, user, self.list_filters(default_limit=20, max_limit=10000))
                )
            return
        attachment_id = self.reimbursement_attachment_route(path)
        if attachment_id:
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
        attachment_id = self.billing_workflow_attachment_download_route(path)
        if attachment_id:
            self.handle_billing_workflow_attachment_download(attachment_id)
            return
        claim_id = self.reimbursement_claim_route(path)
        if claim_id:
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
        obligation_id = self.reimbursement_obligation_route(path)
        if obligation_id:
            user = self.require_user()
            if not user:
                return
            try:
                with connect_db() as conn:
                    self.send_json(get_reimbursement_obligation(conn, user, obligation_id))
            except LookupError as exc:
                self.send_json({"error": str(exc)}, HTTPStatus.NOT_FOUND)
            return
        attachment_id = self.animal_inspection_attachment_route(path)
        if attachment_id:
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
        reference_name = self.animal_inspection_reference_route(path)
        if reference_name:
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
        inspection_id = self.animal_inspection_pdf_route(path)
        if inspection_id:
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
        inspection_id = self.animal_inspection_route(path)
        if inspection_id:
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
        if path == "/api/iacuc-index/status":
            if not self.require_user():
                return
            payload = app_ports().read_iacuc_index()
            self.send_json({key: payload[key] for key in ("count", "updatedAt", "source")})
            return
        if path == "/api/system/update-check":
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
        if path == "/api/system/environment":
            user = self.require_user()
            if not user:
                return
            if user["role"] != "admin":
                self.send_json({"error": "需要管理员权限"}, HTTPStatus.FORBIDDEN)
                return
            self.send_json(system_environment())
            return
        if path == "/api/users":
            user = self.require_user()
            if not user:
                return
            if user["role"] != "admin":
                self.send_json({"error": "需要管理员权限"}, HTTPStatus.FORBIDDEN)
                return
            with connect_db() as conn:
                self.send_json({"users": list_users(conn)})
            return
        if route_column_filter_options(self, path):
            return
        if path == "/api/quantity-sheets":
            if not self.require_user():
                return
            with connect_db() as conn:
                self.send_json(list_quantity_sheets_page(conn, self.list_filters()))
            return
        if path == "/api/quantity-sheets/filter-options":
            if not self.require_user():
                return
            query = parse_qs(urlparse(self.path).query)
            column = clean_text(query.get("column", [""])[0])
            with connect_db() as conn:
                self.send_json(list_quantity_sheet_filter_options(conn, self.list_filters(), column))
            return
        if path == "/api/quantity-sheets/pi-history":
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
        if path == "/api/quantity-sheet-rooms":
            if not self.require_user():
                return
            with connect_db() as conn:
                rooms = read_payloads(conn, "rooms", "rowid")
            self.send_json({"items": rooms})
            return
        sheet_id = quantity_sheet_pdf_route(path, unquote)
        if sheet_id:
            download_quantity_sheet_pdf(
                self,
                sheet_id,
                connect_db=connect_db,
                get_quantity_sheet=get_quantity_sheet,
                validate_permission=validate_quantity_sheet_permission,
            )
            return
        sheet_id = self.quantity_sheet_route(path)
        if sheet_id:
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
        if path == "/api/principal-identities":
            user = self.require_user()
            if not user:
                return
            self.send_json({"items": read_principal_identities()})
            return
        if path == "/api/infrastructure/occupancies":
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
        if path == "/api/billing-workflows":
            user = self.require_user()
            if not user:
                return
            with connect_db() as conn:
                self.send_json(app_ports().list_billing_workflows_page(conn, self.list_filters()))
            return
        if path == "/api/reimbursement-records":
            user = self.require_user()
            if not user:
                return
            with connect_db() as conn:
                self.send_json(list_reimbursement_records_page(conn, self.list_filters()))
            return
        workflow_id = self.billing_workflow_lines_route(path)
        if workflow_id:
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
        workflow_id = self.billing_workflow_route(path)
        if workflow_id:
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
                        "workflow": workflow,
                        "versions": list_billing_workflow_versions(conn, workflow_id),
                        "events": list_billing_workflow_events(conn, workflow_id),
                    }
                )
            return
        reimbursement_id = self.reimbursement_record_route(path)
        if reimbursement_id:
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
        if path == "/api/billing-statements":
            user = self.require_user()
            if not user:
                return
            with connect_db() as conn:
                self.send_json({"items": app_ports().list_current_billing_statements(conn)})
            return
        if path == "/api/billing-settlement-candidates":
            user = self.require_user()
            if not user:
                return
            filters = self.list_filters(default_limit=10, max_limit=100)
            with connect_db() as conn:

                def calculate(month, pi):
                    payload = {"month": month, "pi": pi, "sourceType": "quantity_sheet"}
                    return app_ports().generate_billing_statement_by_pi(conn, payload, user)[0]

                self.send_json(list_settlement_candidates(conn, filters, calculate, "quantity_sheet", now_iso()))
            return
        if path == "/api/billing-settlements/pdf":
            download_billing_statement_pdf(
                self,
                connect_db=connect_db,
                list_quantity_sheets_by_month_pi=list_quantity_sheets_by_month_pi,
                validate_permission=validate_quantity_sheet_permission,
                generate_statement=app_ports().generate_billing_statement_by_pi,
                clean_text=clean_text,
            )
            return
        if path == "/api/intake-batches/filter-options":
            if not self.require_user():
                return
            query = parse_qs(urlparse(self.path).query)
            column = clean_text(query.get("column", [""])[0])
            with connect_db() as conn:
                self.send_json(list_intake_batch_filter_options(conn, self.list_filters(), filtered_where, column))
            return
        statement_id = self.billing_statement_route(path)
        if statement_id:
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
        if path in ENTITY_ENDPOINTS:
            user = self.require_user()
            if not user:
                return
            self.send_entity_list(ENTITY_ENDPOINTS[path], user)
            return
        endpoint, item_id = self.entity_route(path)
        if endpoint and item_id:
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
        if path.startswith("/scan/cage-card/") or path.startswith("/c/"):
            self.send_spa_index()
            return
        if path in {"/docs/app", "/docs/app/"}:
            self.send_response(302)
            self.send_header("Location", "/app")
            self.end_headers()
            return
        if send_documentation_asset(self, frontend_root()):
            return
        if send_frontend_asset(self, frontend_root()):
            return
        if not path.startswith("/api/") and "." not in path.rsplit("/", 1)[-1]:
            self.send_spa_index()
            return
        super().do_GET()
