"""Additive review registry; no flags or corrections are written to business rows."""


def ensure_schema(conn):
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS data_quality_scans (
            id TEXT PRIMARY KEY,
            detector_version TEXT NOT NULL,
            source_sha256 TEXT NOT NULL,
            latest_business_at TEXT NOT NULL,
            scanned_at TEXT NOT NULL,
            finding_count INTEGER NOT NULL,
            payload TEXT NOT NULL
        )
        """
    )
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS data_quality_issues (
            id TEXT PRIMARY KEY,
            code TEXT NOT NULL,
            entity_type TEXT NOT NULL,
            entity_id TEXT NOT NULL,
            reference_id TEXT NOT NULL,
            summary TEXT NOT NULL,
            review_status TEXT NOT NULL CHECK(review_status IN ('needs_review', 'retained_history')),
            first_scan_id TEXT NOT NULL REFERENCES data_quality_scans(id),
            last_scan_id TEXT NOT NULL REFERENCES data_quality_scans(id),
            first_seen_at TEXT NOT NULL,
            last_seen_at TEXT NOT NULL,
            UNIQUE(code, entity_type, entity_id, reference_id)
        )
        """
    )
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS data_quality_observations (
            scan_id TEXT NOT NULL REFERENCES data_quality_scans(id),
            issue_id TEXT NOT NULL REFERENCES data_quality_issues(id),
            evidence_sha256 TEXT NOT NULL,
            evidence_json TEXT NOT NULL,
            PRIMARY KEY(scan_id, issue_id)
        )
        """
    )
    conn.execute("CREATE INDEX IF NOT EXISTS idx_data_quality_entity ON data_quality_issues(entity_type,entity_id)")
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_data_quality_review ON data_quality_issues(review_status,code,last_seen_at)"
    )
