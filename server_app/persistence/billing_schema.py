"""Create billing base tables; caller owns ordering and transaction."""


def initialize_billing_schema(conn):
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS billing_rules (
            id TEXT PRIMARY KEY,
            name TEXT,
            unit TEXT,
            price REAL,
            effective_start TEXT,
            effective_end TEXT,
            payload TEXT NOT NULL
        )
        """
    )
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS billing_adjustments (
            id TEXT PRIMARY KEY,
            target_type TEXT,
            target_id TEXT,
            adjustment_type TEXT,
            value REAL,
            reason TEXT,
            effective_start TEXT,
            effective_end TEXT,
            payload TEXT NOT NULL
        )
        """
    )
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS quantity_sheets (
            id TEXT PRIMARY KEY,
            month TEXT NOT NULL,
            iacuc TEXT NOT NULL,
            room_id TEXT,
            room_name TEXT,
            manager TEXT,
            project TEXT,
            pi TEXT,
            owner TEXT,
            funding TEXT,
            updated_at TEXT NOT NULL,
            payload TEXT NOT NULL
        )
        """
    )
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS intake_batches (
            id TEXT PRIMARY KEY,
            batch_no TEXT NOT NULL,
            iacuc TEXT,
            supplier TEXT,
            pi TEXT,
            owner TEXT,
            quantity INTEGER,
            card_count INTEGER,
            room_name TEXT,
            intake_date TEXT,
            status TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            payload TEXT NOT NULL
        )
        """
    )
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS billing_statements (
            id TEXT PRIMARY KEY,
            iacuc TEXT NOT NULL,
            month TEXT NOT NULL,
            project TEXT,
            pi TEXT,
            owner TEXT,
            funding TEXT,
            total_cage_days INTEGER,
            total_amount REAL,
            status TEXT NOT NULL,
            generated_at TEXT NOT NULL,
            locked_at TEXT,
            payload TEXT NOT NULL
        )
        """
    )
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS billing_statement_lines (
            id TEXT PRIMARY KEY,
            statement_id TEXT NOT NULL,
            line_date TEXT NOT NULL,
            cage_count INTEGER,
            unit_price REAL,
            discount_percent REAL,
            amount REAL,
            cumulative REAL,
            occupancy_ids TEXT,
            payload TEXT NOT NULL,
            FOREIGN KEY(statement_id) REFERENCES billing_statements(id) ON DELETE CASCADE
        )
        """
    )
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS billing_candidate_snapshots (
            source_type TEXT NOT NULL,
            month TEXT NOT NULL,
            pi TEXT NOT NULL,
            iacucs_json TEXT NOT NULL,
            iacucs_text TEXT NOT NULL,
            total_amount REAL,
            error_message TEXT NOT NULL,
            is_stale INTEGER NOT NULL DEFAULT 1,
            updated_at TEXT NOT NULL,
            source_fingerprint TEXT NOT NULL,
            PRIMARY KEY (source_type, month, pi)
        )
        """
    )
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS billing_candidate_snapshot_iacucs (
            source_type TEXT NOT NULL,
            month TEXT NOT NULL,
            pi TEXT NOT NULL,
            iacuc TEXT NOT NULL,
            PRIMARY KEY (source_type, month, pi, iacuc),
            FOREIGN KEY(source_type, month, pi)
                REFERENCES billing_candidate_snapshots(source_type, month, pi)
                ON DELETE CASCADE
        )
        """
    )
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS billing_workflows (
            id TEXT PRIMARY KEY,
            business_key TEXT NOT NULL UNIQUE,
            iacuc TEXT NOT NULL,
            month TEXT NOT NULL,
            source_type TEXT NOT NULL,
            workflow_status TEXT NOT NULL,
            current_version_id TEXT,
            current_version_no INTEGER NOT NULL DEFAULT 0,
            latest_event_at TEXT,
            payload TEXT NOT NULL
        )
        """
    )
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS billing_statement_versions (
            id TEXT PRIMARY KEY,
            workflow_id TEXT NOT NULL,
            version_no INTEGER NOT NULL,
            version_status TEXT NOT NULL,
            workflow_status TEXT NOT NULL,
            generated_at TEXT NOT NULL,
            voided_at TEXT,
            created_by TEXT,
            payload TEXT NOT NULL,
            FOREIGN KEY(workflow_id) REFERENCES billing_workflows(id) ON DELETE CASCADE
        )
        """
    )
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS billing_statement_version_lines (
            id TEXT PRIMARY KEY,
            version_id TEXT NOT NULL,
            line_date TEXT NOT NULL,
            payload TEXT NOT NULL,
            FOREIGN KEY(version_id) REFERENCES billing_statement_versions(id) ON DELETE CASCADE
        )
        """
    )
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS billing_workflow_events (
            id TEXT PRIMARY KEY,
            workflow_id TEXT NOT NULL,
            version_id TEXT,
            event_type TEXT NOT NULL,
            from_status TEXT,
            to_status TEXT,
            at TEXT NOT NULL,
            payload TEXT NOT NULL,
            FOREIGN KEY(workflow_id) REFERENCES billing_workflows(id) ON DELETE CASCADE,
            FOREIGN KEY(version_id) REFERENCES billing_statement_versions(id) ON DELETE SET NULL
        )
        """
    )
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS billing_workflow_attachments (
            id TEXT PRIMARY KEY,
            workflow_id TEXT NOT NULL,
            kind TEXT NOT NULL DEFAULT 'settlement',
            original_name TEXT NOT NULL,
            stored_name TEXT NOT NULL,
            mime_type TEXT NOT NULL,
            size_bytes INTEGER NOT NULL,
            sha256 TEXT NOT NULL,
            created_by TEXT NOT NULL,
            created_by_name TEXT NOT NULL,
            created_at TEXT NOT NULL,
            payload TEXT NOT NULL,
            FOREIGN KEY(workflow_id) REFERENCES billing_workflows(id) ON DELETE CASCADE
        )
        """
    )
