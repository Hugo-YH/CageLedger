"""Create infrastructure base tables; caller owns ordering and transaction."""


def initialize_infrastructure_schema(conn):
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
