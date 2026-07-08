def initialize_base_schema(
    conn, *, migrate_schema, repair_missing_cage_slots, create_performance_indexes, ensure_default_admin
):
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS app_state (
            id TEXT PRIMARY KEY,
            payload TEXT NOT NULL,
            updated_at TEXT NOT NULL
        )
        """
    )
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS app_settings (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL,
            updated_at TEXT NOT NULL
        )
        """
    )
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS rooms (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            area TEXT,
            rack_count INTEGER,
            rows INTEGER,
            cols INTEGER,
            payload TEXT NOT NULL
        )
        """
    )
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS racks (
            id TEXT PRIMARY KEY,
            room_id TEXT NOT NULL,
            name TEXT NOT NULL,
            rows INTEGER,
            cols INTEGER,
            index_no INTEGER,
            payload TEXT NOT NULL,
            FOREIGN KEY(room_id) REFERENCES rooms(id) ON DELETE CASCADE
        )
        """
    )
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS cage_slots (
            id TEXT PRIMARY KEY,
            rack_id TEXT NOT NULL,
            row_no INTEGER,
            col_no INTEGER,
            code TEXT,
            status TEXT,
            payload TEXT NOT NULL,
            FOREIGN KEY(rack_id) REFERENCES racks(id) ON DELETE CASCADE
        )
        """
    )
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS occupancies (
            id TEXT PRIMARY KEY,
            slot_id TEXT,
            room_id TEXT,
            rack_id TEXT,
            cage_code TEXT,
            status TEXT NOT NULL,
            iacuc TEXT,
            project TEXT,
            pi TEXT,
            owner TEXT,
            funding TEXT,
            species TEXT,
            billing_item TEXT,
            customer_type TEXT,
            animal_count INTEGER,
            room_name TEXT,
            rack_name TEXT,
            slot_code TEXT,
            start_date TEXT,
            end_date TEXT,
            end_reason TEXT,
            notes TEXT,
            updated_at TEXT,
            payload TEXT NOT NULL
        )
        """
    )
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS placement_tasks (
            id TEXT PRIMARY KEY,
            source_batch_id TEXT NOT NULL,
            source_receipt_id TEXT NOT NULL,
            target_room_id TEXT,
            planned_move_in_date TEXT NOT NULL,
            status TEXT NOT NULL,
            reserved_occupancy_id TEXT,
            actual_move_in_date TEXT,
            updated_at TEXT,
            payload TEXT NOT NULL
        )
        """
    )
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS experiment_applications (
            id TEXT PRIMARY KEY,
            iacuc TEXT NOT NULL,
            raw_iacuc TEXT,
            project TEXT,
            pi TEXT,
            owner TEXT,
            funding TEXT,
            imported_at TEXT NOT NULL,
            payload TEXT NOT NULL
        )
        """
    )
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS principal_identities (
            pi TEXT PRIMARY KEY,
            principal_type TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            payload TEXT NOT NULL
        )
        """
    )
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
        CREATE TABLE IF NOT EXISTS project_sync_snapshots (
            id TEXT PRIMARY KEY,
            imported_at TEXT NOT NULL,
            actor_user_id TEXT,
            actor_display_name TEXT,
            summary TEXT NOT NULL,
            payload TEXT NOT NULL
        )
        """
    )
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS audit_logs (
            id TEXT PRIMARY KEY,
            message TEXT,
            at TEXT,
            payload TEXT NOT NULL
        )
        """
    )
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS users (
            id TEXT PRIMARY KEY,
            username TEXT NOT NULL UNIQUE,
            display_name TEXT NOT NULL,
            password_hash TEXT NOT NULL,
            role TEXT NOT NULL,
            room_ids TEXT NOT NULL,
            active INTEGER NOT NULL DEFAULT 1,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        )
        """
    )
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS sessions (
            token_hash TEXT PRIMARY KEY,
            user_id TEXT NOT NULL,
            created_at TEXT NOT NULL,
            expires_at TEXT NOT NULL,
            FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
        )
        """
    )
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS audit_events (
            id TEXT PRIMARY KEY,
            actor_user_id TEXT,
            actor_username TEXT,
            actor_display_name TEXT,
            action TEXT NOT NULL,
            entity_type TEXT NOT NULL,
            entity_id TEXT,
            message TEXT NOT NULL,
            slot_ids TEXT NOT NULL,
            at TEXT NOT NULL,
            payload TEXT NOT NULL
        )
        """
    )
    migrate_schema(conn)
    repair_missing_cage_slots(conn)
    create_performance_indexes(conn)
    conn.commit()
    ensure_default_admin(conn)
