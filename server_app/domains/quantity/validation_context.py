"""One save shares only the configuration its existing validators actually need."""

from functools import cached_property

from server_app.domains.billing import normalize_principal_type
from server_app.repositories.quantity_save_context import read_principal_types, read_validation_sheets


class QuantityValidationContext:
    def __init__(self, conn, sheet, room):
        self.conn, self.sheet, self.room = conn, sheet, room

    @cached_property
    def sheets(self):
        return read_validation_sheets(self.conn, self.sheet.get("month"), self.sheet.get("pi", ""))

    @cached_property
    def principal_types(self):
        return {
            pi: normalize_principal_type(kind)
            for pi, kind in read_principal_types(self.conn, self.sheet.get("pi", "")).items()
        }
