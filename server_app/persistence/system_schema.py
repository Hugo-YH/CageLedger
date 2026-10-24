"""Create system base tables; caller owns ordering and transaction."""


def initialize_system_schema(conn):
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
            phone TEXT,
            password_hash TEXT NOT NULL,
            role TEXT NOT NULL,
            room_ids TEXT NOT NULL,
            billing_lock_allowed INTEGER NOT NULL DEFAULT 0,
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
        CREATE TABLE IF NOT EXISTS release_announcement_acknowledgements (
            user_id TEXT NOT NULL,
            version TEXT NOT NULL,
            acknowledged_at TEXT NOT NULL,
            PRIMARY KEY(user_id, version),
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
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS system_performance_snapshots (
            id TEXT PRIMARY KEY,
            observed_at TEXT NOT NULL,
            interval_seconds INTEGER NOT NULL,
            process_started_at TEXT NOT NULL,
            app_version TEXT NOT NULL,
            revision TEXT NOT NULL,
            payload TEXT NOT NULL
        )
        """
    )
