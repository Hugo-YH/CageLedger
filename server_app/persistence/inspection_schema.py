"""Create inspection base tables; caller owns ordering and transaction."""


def initialize_inspection_schema(conn):
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS inspection_catalog_versions (
            version TEXT PRIMARY KEY,
            source TEXT NOT NULL,
            status TEXT NOT NULL,
            imported_at TEXT NOT NULL,
            payload TEXT NOT NULL
        )
        """
    )
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS inspection_catalog_nodes (
            version TEXT NOT NULL,
            code TEXT NOT NULL,
            module_code TEXT NOT NULL,
            parent_id TEXT,
            node_type TEXT NOT NULL,
            input_type TEXT,
            name TEXT NOT NULL,
            sort_order INTEGER NOT NULL DEFAULT 0,
            config_json TEXT NOT NULL,
            payload TEXT NOT NULL,
            PRIMARY KEY (version, code),
            FOREIGN KEY(version) REFERENCES inspection_catalog_versions(version) ON DELETE CASCADE
        )
        """
    )
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS animal_inspections (
            id TEXT PRIMARY KEY,
            room_id TEXT NOT NULL,
            room_name TEXT NOT NULL,
            facility TEXT,
            module_codes TEXT NOT NULL,
            status TEXT NOT NULL,
            catalog_version TEXT NOT NULL,
            created_by TEXT NOT NULL,
            created_by_name TEXT NOT NULL,
            submitted_at TEXT,
            updated_at TEXT NOT NULL,
            snapshot_json TEXT NOT NULL,
            payload TEXT NOT NULL,
            FOREIGN KEY(catalog_version) REFERENCES inspection_catalog_versions(version)
        )
        """
    )
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS animal_inspection_answers (
            id TEXT PRIMARY KEY,
            inspection_id TEXT NOT NULL,
            module_code TEXT NOT NULL,
            node_code TEXT NOT NULL,
            score INTEGER NOT NULL,
            sub_option TEXT,
            note TEXT,
            payload TEXT NOT NULL,
            UNIQUE(inspection_id, node_code),
            FOREIGN KEY(inspection_id) REFERENCES animal_inspections(id) ON DELETE CASCADE
        )
        """
    )
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS animal_inspection_findings (
            id TEXT PRIMARY KEY,
            inspection_id TEXT NOT NULL,
            room_id TEXT NOT NULL,
            module_code TEXT NOT NULL,
            node_code TEXT NOT NULL,
            severity INTEGER NOT NULL,
            status TEXT NOT NULL,
            location_hint TEXT,
            rack_hint TEXT,
            cage_number TEXT,
            animal_identifier TEXT,
            action_note TEXT,
            responsible_name TEXT,
            recheck_due_at TEXT,
            resolved_at TEXT,
            updated_at TEXT NOT NULL,
            payload TEXT NOT NULL,
            UNIQUE(inspection_id, node_code),
            FOREIGN KEY(inspection_id) REFERENCES animal_inspections(id) ON DELETE CASCADE
        )
        """
    )
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS animal_inspection_finding_events (
            id TEXT PRIMARY KEY,
            finding_id TEXT NOT NULL,
            event_type TEXT NOT NULL,
            note TEXT,
            actor_id TEXT NOT NULL,
            actor_name TEXT NOT NULL,
            at TEXT NOT NULL,
            payload TEXT NOT NULL,
            FOREIGN KEY(finding_id) REFERENCES animal_inspection_findings(id) ON DELETE CASCADE
        )
        """
    )
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS animal_inspection_attachments (
            id TEXT PRIMARY KEY,
            inspection_id TEXT NOT NULL,
            finding_id TEXT NOT NULL,
            original_name TEXT NOT NULL,
            stored_name TEXT NOT NULL,
            mime_type TEXT NOT NULL,
            size_bytes INTEGER NOT NULL,
            created_by TEXT NOT NULL,
            created_at TEXT NOT NULL,
            payload TEXT NOT NULL,
            FOREIGN KEY(inspection_id) REFERENCES animal_inspections(id) ON DELETE CASCADE,
            FOREIGN KEY(finding_id) REFERENCES animal_inspection_findings(id) ON DELETE CASCADE
        )
        """
    )
