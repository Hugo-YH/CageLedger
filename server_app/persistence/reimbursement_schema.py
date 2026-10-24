"""Create reimbursement base tables; caller owns ordering and transaction."""


def initialize_reimbursement_schema(conn):
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS reimbursement_records (
            id TEXT PRIMARY KEY,
            business_key TEXT NOT NULL UNIQUE,
            month TEXT NOT NULL,
            pi TEXT NOT NULL,
            workflow_id TEXT,
            workflow_status TEXT,
            reimbursement_status TEXT NOT NULL,
            current_month_amount REAL NOT NULL DEFAULT 0,
            support_amount REAL NOT NULL DEFAULT 0,
            payable_amount REAL NOT NULL DEFAULT 0,
            paid_amount REAL NOT NULL DEFAULT 0,
            unpaid_amount REAL NOT NULL DEFAULT 0,
            accumulated_payable REAL NOT NULL DEFAULT 0,
            accumulated_paid REAL NOT NULL DEFAULT 0,
            accumulated_unpaid REAL NOT NULL DEFAULT 0,
            source TEXT NOT NULL,
            latest_event_at TEXT,
            updated_at TEXT NOT NULL,
            payload TEXT NOT NULL
        )
        """
    )
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS reimbursement_settlement_obligations (
            id TEXT PRIMARY KEY,
            workflow_id TEXT NOT NULL,
            statement_version_id TEXT NOT NULL,
            statement_version_no INTEGER NOT NULL DEFAULT 0,
            month TEXT NOT NULL,
            source_pi TEXT NOT NULL,
            iacuc TEXT NOT NULL,
            payable_amount REAL NOT NULL DEFAULT 0,
            allocated_amount REAL NOT NULL DEFAULT 0,
            outstanding_amount REAL NOT NULL DEFAULT 0,
            claim_count INTEGER NOT NULL DEFAULT 0,
            obligation_kind TEXT NOT NULL DEFAULT 'statement',
            status TEXT NOT NULL DEFAULT 'open',
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            payload TEXT NOT NULL,
            UNIQUE(workflow_id, statement_version_id, obligation_kind)
        )
        """
    )
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS reimbursement_claims (
            id TEXT PRIMARY KEY,
            document_number TEXT NOT NULL UNIQUE,
            funding_owner TEXT NOT NULL DEFAULT '',
            status TEXT NOT NULL DEFAULT 'pending_submission',
            total_amount REAL NOT NULL DEFAULT 0,
            allocated_amount REAL NOT NULL DEFAULT 0,
            unallocated_amount REAL NOT NULL DEFAULT 0,
            attachment_count INTEGER NOT NULL DEFAULT 0,
            created_by TEXT NOT NULL,
            created_by_name TEXT NOT NULL,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            payload TEXT NOT NULL
        )
        """
    )
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS reimbursement_claim_funding_lines (
            id TEXT PRIMARY KEY,
            claim_id TEXT NOT NULL,
            fund_book_no TEXT NOT NULL,
            funding_owner TEXT NOT NULL,
            reimbursement_amount REAL NOT NULL DEFAULT 0,
            allocated_amount REAL NOT NULL DEFAULT 0,
            unallocated_amount REAL NOT NULL DEFAULT 0,
            sort_order INTEGER NOT NULL DEFAULT 0,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            payload TEXT NOT NULL,
            FOREIGN KEY(claim_id) REFERENCES reimbursement_claims(id) ON DELETE CASCADE
        )
        """
    )
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS reimbursement_allocations (
            id TEXT PRIMARY KEY,
            funding_line_id TEXT NOT NULL,
            obligation_id TEXT NOT NULL,
            amount REAL NOT NULL,
            status TEXT NOT NULL DEFAULT 'draft',
            confirmed_by TEXT,
            confirmed_at TEXT,
            reversed_by TEXT,
            reversed_at TEXT,
            reversal_reason TEXT NOT NULL DEFAULT '',
            created_by TEXT NOT NULL,
            created_by_name TEXT NOT NULL,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            payload TEXT NOT NULL,
            FOREIGN KEY(funding_line_id) REFERENCES reimbursement_claim_funding_lines(id) ON DELETE CASCADE,
            FOREIGN KEY(obligation_id) REFERENCES reimbursement_settlement_obligations(id) ON DELETE RESTRICT
        )
        """
    )
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS reimbursement_claim_attachments (
            id TEXT PRIMARY KEY,
            claim_id TEXT NOT NULL,
            original_name TEXT NOT NULL,
            stored_name TEXT NOT NULL,
            mime_type TEXT NOT NULL,
            size_bytes INTEGER NOT NULL,
            sha256 TEXT NOT NULL,
            ocr_status TEXT NOT NULL DEFAULT 'disabled',
            ocr_result TEXT NOT NULL DEFAULT '',
            ocr_provider TEXT NOT NULL DEFAULT '',
            ocr_model_version TEXT NOT NULL DEFAULT '',
            ocr_requested_at TEXT,
            ocr_completed_at TEXT,
            ocr_error TEXT NOT NULL DEFAULT '',
            created_by TEXT NOT NULL,
            created_at TEXT NOT NULL,
            payload TEXT NOT NULL,
            FOREIGN KEY(claim_id) REFERENCES reimbursement_claims(id) ON DELETE CASCADE,
            UNIQUE(claim_id, sha256)
        )
        """
    )
