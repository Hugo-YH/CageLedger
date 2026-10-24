"""Compatibility composition for domain-specific HTTP GET adapters."""

from .read_billing_actions import ReadBillingActionsMixin
from .read_inspection_actions import ReadInspectionActionsMixin
from .read_quantity_actions import ReadQuantityActionsMixin
from .read_reimbursement_actions import ReadReimbursementActionsMixin
from .read_state_actions import ReadStateActionsMixin
from .read_system_actions import ReadSystemActionsMixin


class ReadActionsMixin(
    ReadSystemActionsMixin,
    ReadStateActionsMixin,
    ReadReimbursementActionsMixin,
    ReadBillingActionsMixin,
    ReadInspectionActionsMixin,
    ReadQuantityActionsMixin,
):
    """Preserve the registered action interface through explicit mixin composition."""
