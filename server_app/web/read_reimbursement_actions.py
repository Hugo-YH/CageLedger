"""Domain-specific GET adapters; connection and permission boundaries unchanged."""

from http import HTTPStatus

from server_app.db import connect_db
from server_app.domains.reimbursement.application import reimbursement_detail_payload
from server_app.domains.reimbursement.facade import get_reimbursement_record, list_reimbursement_records_page
from server_app.domains.reimbursement_ledger import get_attachment as get_reimbursement_attachment
from server_app.domains.reimbursement_ledger import get_claim as get_reimbursement_claim
from server_app.domains.reimbursement_ledger import get_obligation as get_reimbursement_obligation
from server_app.domains.reimbursement_ledger import list_claims as list_reimbursement_claims
from server_app.domains.reimbursement_ledger import list_legacy_records as list_reimbursement_legacy_records
from server_app.domains.reimbursement_ledger import list_obligations as list_reimbursement_obligations


class ReadReimbursementActionsMixin:
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

    def get_reimbursement_records(self, path):
        user = self.require_user()
        if not user:
            return
        with connect_db() as conn:
            self.send_json(list_reimbursement_records_page(conn, self.list_filters()))
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
