"""Request-scoped preparation for candidate amounts from issued bill snapshots."""

import re

from server_app.shared import clean_text

from .frozen import frozen_statement_headers


class CandidateCalculation:
    def __init__(self, conn, calculate):
        self.conn = conn
        self.calculate = calculate
        self.prepared = {}

    def prepare(self, keys):
        # The original generator normalizes and validates its inputs before
        # consulting an issued snapshot. Keep that path for legacy raw keys.
        missing = [
            (month, pi)
            for month, pi in keys
            if (month, pi) not in self.prepared
            and month == clean_text(month)
            and re.fullmatch(r"\d{4}-\d{2}", month)
            and pi
            and pi == clean_text(pi)
        ]
        # Metadata is selected together; complete details are validated in
        # small batches without retaining them in the candidate request.
        snapshots = frozen_statement_headers(self.conn, missing, "pi_merged_quantity_sheet")
        self.prepared.update({key: snapshots.get(key) for key in missing})

    def __call__(self, month, pi):
        snapshot = self.prepared.get((month, pi))
        if isinstance(snapshot, ValueError):
            raise snapshot
        if snapshot is not None:
            return snapshot
        return self.calculate(month, pi)
