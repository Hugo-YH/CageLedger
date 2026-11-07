"""Request-local totals using the same daily calculator as complete statements."""

from server_app.domains.iacuc.rules import normalize_iacuc_number
from server_app.repositories.billing_candidate_batches import candidate_room_payloads, quantity_sheet_payloads_many
from server_app.repositories.entities import read_principal_type_by_pi
from server_app.repositories.state import read_applications_by_iacuc
from server_app.shared import clean_text, now_iso

from .allowance import billing_free_cages_for_pi, normalize_principal_type
from .candidate_calculation import CandidateCalculation
from .generation import validate_quantity_sheet_permission
from .statements import quantity_sheet_statement_lines


class DashboardCalculation(CandidateCalculation):
    def __init__(self, conn, calculate, actor):
        super().__init__(conn, calculate)
        self.actor = actor

    def prepare(self, keys):
        new = set(keys) - self.prepared.keys()
        super().prepare(keys)
        live = [key for key in keys if key in new and key in self.prepared and self.prepared[key] is None]
        if not live:
            return
        if not self.actor:
            raise PermissionError("请先登录")
        try:
            principals = {
                clean_text(pi): normalize_principal_type(kind)
                for pi, kind in read_principal_type_by_pi(self.conn).items()
                if clean_text(pi)
            }
            applications = read_applications_by_iacuc(self.conn, normalize_iacuc_number)
        except ValueError:
            return
        at = now_iso()
        for offset in range(0, len(live), 200):
            batch = live[offset : offset + 200]
            try:
                sheets_by_key = quantity_sheet_payloads_many(self.conn, batch)
                rooms = candidate_room_payloads(self.conn, [s for items in sheets_by_key.values() for s in items])
            except ValueError:
                # A damaged source retains the original per-PI error boundary.
                # Only this batch falls back; do not retain all history payloads.
                continue
            for key in batch:
                try:
                    sheets = sheets_by_key.get(key, [])
                    if not sheets:
                        raise ValueError("未找到该 PI 在结算月份内的数量统计表")
                    for sheet in sheets:
                        validate_quantity_sheet_permission(self.actor, sheet)
                    amount = quantity_sheet_statement_lines(
                        sheets, billing_free_cages_for_pi(principals, key[1]), rooms, applications, amount_only=True
                    )
                    self.prepared[key] = {"totalAmount": amount, "generatedAt": at}
                except ValueError as error:
                    self.prepared[key] = error
