"""Domain-specific GET adapters; connection and permission boundaries unchanged."""

from http import HTTPStatus
from urllib.parse import parse_qs, unquote, urlparse

from server_app.db import connect_db
from server_app.domains.billing.candidate_calculation import CandidateCalculation
from server_app.domains.dashboard_overview import dashboard_overview_payload, default_overview_month
from server_app.domains.iacuc.sync import read_principal_identities
from server_app.domains.state.persistence import read_cached_state, read_state
from server_app.domains.state.projections import public_cage_card_payload
from server_app.domains.state.query import filter_state_for_actor
from server_app.repositories.entities import list_intake_batch_filter_options
from server_app.repositories.filter_options import filtered_where
from server_app.shared import clean_text
from server_app.web.dashboard import send_overview
from server_app.web.entity_contracts import ENTITY_ENDPOINTS, WRITABLE_ENTITY_ENDPOINTS
from server_app.web.ports import app_ports


class ReadStateActionsMixin:
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

    def get_intake_batches_filter_options(self, path):
        if not self.require_user():
            return
        query = parse_qs(urlparse(self.path).query)
        column = clean_text(query.get("column", [""])[0])
        with connect_db() as conn:
            self.send_json(list_intake_batch_filter_options(conn, self.list_filters(), filtered_where, column))
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
        if collection == "intakeBatches":
            from server_app.domains.intake.read_service import read_batch

            try:
                with connect_db() as conn:
                    self.send_json({"item": read_batch(conn, user, item_id)})
            except LookupError as exc:
                self.send_json({"error": str(exc)}, HTTPStatus.NOT_FOUND)
            return
        with connect_db() as conn:
            state = filter_state_for_actor(read_cached_state(conn), user)
        item = next((entry for entry in state.get(collection, []) if entry.get("id") == item_id), None)
        if not item:
            self.send_json({"error": "记录不存在"}, HTTPStatus.NOT_FOUND)
            return
        self.send_json({"item": item})
        return
