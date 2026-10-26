"""Domain-specific GET adapters; connection and permission boundaries unchanged."""

from http import HTTPStatus
from urllib.parse import parse_qs, urlparse

from server_app.db import connect_db
from server_app.domains.billing.generation import validate_quantity_sheet_permission
from server_app.domains.quantity.facade import (
    get_quantity_sheet,
    list_quantity_sheet_filter_options,
    list_quantity_sheets_page,
)
from server_app.repositories.billing import find_latest_quantity_sheet_pi as find_latest_quantity_sheet_pi_repository
from server_app.repositories.payload import read_payloads
from server_app.shared import clean_text
from server_app.web.pdf_exports import download_quantity_sheet_pdf


class ReadQuantityActionsMixin:
    def get_quantity_sheets(self, path):
        if not self.require_user():
            return
        # The existing projection is already the summary contract. Keep the
        # unqualified legacy response byte-for-byte compatible.
        query = parse_qs(urlparse(self.path).query)
        view = clean_text(query.get("view", [""])[0])
        if view not in ("", "summary"):
            self.send_json({"error": "列表视图无效"}, HTTPStatus.BAD_REQUEST)
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
