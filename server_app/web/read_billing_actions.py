"""Domain-specific GET adapters; connection and permission boundaries unchanged."""

from http import HTTPStatus
from urllib.parse import parse_qs, urlparse

from server_app.db import connect_db
from server_app.domains.billing.candidates import list_settlement_candidates
from server_app.domains.billing.generation import validate_quantity_sheet_permission
from server_app.domains.quantity.facade import list_quantity_sheets_by_month_pi
from server_app.domains.workflow.facade import (
    current_funding_book_options,
    get_billing_workflow_detail,
    list_billing_workflow_events,
    list_billing_workflow_lines,
    list_billing_workflow_versions,
)
from server_app.domains.workflow.permissions import with_withdrawal_capabilities
from server_app.shared import clean_text, now_iso
from server_app.web.pdf_exports import download_billing_statement_pdf
from server_app.web.ports import app_ports


class ReadBillingActionsMixin:
    def get_billing_workflow_attachment_download(self, path, attachment_id):
        self.handle_billing_workflow_attachment_download(attachment_id)
        return

    def get_billing_workflows(self, path):
        user = self.require_user()
        if not user:
            return
        with connect_db() as conn:
            payload = app_ports().list_billing_workflows_page(conn, self.list_filters())
            self.send_json({**payload, "items": with_withdrawal_capabilities(conn, user, payload["items"])})
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
