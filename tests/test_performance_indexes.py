import sqlite3
import unittest
from contextlib import closing

import server
from server_app.domains.quarantine.repository import ensure_schema as ensure_quarantine_schema
from server_app.persistence.indexes import create_performance_indexes


class PerformanceIndexTests(unittest.TestCase):
    def test_workflow_ordering_uses_indexes_and_preserves_date_ties(self):
        with closing(sqlite3.connect(":memory:")) as conn:
            conn.row_factory = sqlite3.Row
            server.initialize_schema(conn)
            conn.execute("""INSERT INTO billing_workflows
                (id,business_key,iacuc,month,source_type,workflow_status,payload)
                VALUES ('workflow','scope','Z2026001','2026-10','quantity_sheet','statement_generated','{}')""")
            for identity, number in (("v3", 3), ("v1", 1), ("v2", 2)):
                conn.execute(
                    """INSERT INTO billing_statement_versions
                    (id,workflow_id,version_no,version_status,workflow_status,generated_at,payload)
                    VALUES (?,'workflow',?,'active','statement_generated','2026-10-01','{}')""",
                    (identity, number),
                )
            for identity, date in (("line-b", "2026-10-02"), ("line-c", "2026-10-01"), ("line-a", "2026-10-01")):
                conn.execute("INSERT INTO billing_statement_version_lines VALUES (?,'v3',?,'{}')", (identity, date))
            for identity, at in (("event-b", "2026-10-02"), ("event-c", "2026-10-01"), ("event-a", "2026-10-01")):
                conn.execute(
                    """INSERT INTO billing_workflow_events
                    (id,workflow_id,event_type,at,payload) VALUES (?,'workflow','generated',?,'{}')""",
                    (identity, at),
                )
            queries = (
                (
                    "SELECT id FROM billing_statement_version_lines WHERE version_id='v3' ORDER BY line_date,rowid",
                    ["line-c", "line-a", "line-b"],
                ),
                (
                    "SELECT id FROM billing_statement_versions WHERE workflow_id='workflow' ORDER BY version_no DESC,rowid DESC",
                    ["v3", "v2", "v1"],
                ),
                (
                    "SELECT id FROM billing_workflow_events WHERE workflow_id='workflow' ORDER BY at DESC,rowid DESC",
                    ["event-b", "event-a", "event-c"],
                ),
            )
            for _ in range(2):
                create_performance_indexes(conn)
                for query, expected in queries:
                    with self.subTest(query=query):
                        self.assertEqual([row[0] for row in conn.execute(query)], expected)
                        plan = [row[3] for row in conn.execute("EXPLAIN QUERY PLAN " + query)]
                        self.assertFalse(any("TEMP B-TREE" in step for step in plan), plan)

    def test_upgrade_retires_only_redundant_non_unique_indexes(self):
        with closing(sqlite3.connect(":memory:")) as conn:
            conn.row_factory = sqlite3.Row
            server.initialize_schema(conn)
            conn.execute(
                "CREATE INDEX idx_billing_version_lines_version_id ON billing_statement_version_lines(version_id)"
            )
            conn.execute("CREATE INDEX idx_quantity_sheets_month ON quantity_sheets(month)")
            conn.execute("CREATE UNIQUE INDEX idx_quantity_sheets_pi ON quantity_sheets(pi)")
            unique_before = {
                row[0]
                for row in conn.execute(
                    "SELECT name FROM sqlite_master WHERE type='index' AND sql LIKE 'CREATE UNIQUE INDEX%'"
                )
            }
            create_performance_indexes(conn)
            create_performance_indexes(conn)
            names = {row[0] for row in conn.execute("SELECT name FROM sqlite_master WHERE type='index'")}
            self.assertNotIn("idx_billing_version_lines_version_id", names)
            self.assertNotIn("idx_quantity_sheets_month", names)
            self.assertTrue(unique_before.issubset(names))
            with self.assertRaises(sqlite3.IntegrityError):
                for identity in ("first", "second"):
                    conn.execute(
                        """INSERT INTO quantity_sheets(id,month,iacuc,pi,updated_at,payload)
                        VALUES (?,'2026-10','Z2026001','same-pi','2026-10-01','{}')""",
                        (identity,),
                    )

    def test_quarantine_report_version_unique_index_covers_lookup(self):
        with closing(sqlite3.connect(":memory:")) as conn:
            ensure_quarantine_schema(conn)
            conn.execute("CREATE INDEX idx_quarantine_reports_test_id ON quarantine_reports(test_id)")
            ensure_quarantine_schema(conn)
            self.assertIsNone(
                conn.execute("SELECT name FROM sqlite_master WHERE name='idx_quarantine_reports_test_id'").fetchone()
            )
            plan = [
                row[3]
                for row in conn.execute("EXPLAIN QUERY PLAN SELECT id FROM quarantine_reports WHERE test_id='test'")
            ]
            self.assertTrue(any("USING INDEX" in step for step in plan), plan)

    def test_legacy_quarantine_report_without_unique_key_retains_lookup_index(self):
        with closing(sqlite3.connect(":memory:")) as conn:
            conn.execute(
                "CREATE TABLE quarantine_reports(id TEXT PRIMARY KEY,payload TEXT,updated_at TEXT,test_id TEXT,version INTEGER)"
            )
            ensure_quarantine_schema(conn)
            self.assertIsNotNone(
                conn.execute("SELECT name FROM sqlite_master WHERE name='idx_quarantine_reports_test_id'").fetchone()
            )

    def test_quarantine_upgrade_preserves_custom_unique_lookup(self):
        with closing(sqlite3.connect(":memory:")) as conn:
            ensure_quarantine_schema(conn)
            conn.execute("CREATE UNIQUE INDEX idx_quarantine_reports_test_id ON quarantine_reports(test_id)")
            ensure_quarantine_schema(conn)
            self.assertIsNotNone(
                conn.execute("SELECT name FROM sqlite_master WHERE name='idx_quarantine_reports_test_id'").fetchone()
            )

    def test_quantity_sheet_indexes_are_created_idempotently(self):
        with closing(sqlite3.connect(":memory:")) as conn:
            conn.row_factory = sqlite3.Row
            server.initialize_schema(conn)
            for identity in ("sheet-first", "sheet-second"):
                conn.execute(
                    """INSERT INTO quantity_sheets(id,month,iacuc,room_id,pi,updated_at,payload)
                    VALUES (?,'2026-10','Z2026001','room','same-pi','2026-10-01','{}')""",
                    (identity,),
                )
            server.initialize_schema(conn)
            self.assertEqual(conn.execute("SELECT COUNT(*) FROM quantity_sheets").fetchone()[0], 2)
            indexes = {
                row[0]
                for row in conn.execute(
                    "SELECT name FROM sqlite_master WHERE type = 'index' AND name IN (?, ?, ?, ?)",
                    (
                        "idx_quantity_sheets_month_room",
                        "idx_quantity_sheets_month_iacuc_updated",
                        "idx_reimbursement_records_month_latest",
                        "idx_reimbursement_records_status_month_latest",
                    ),
                )
            }

        self.assertEqual(
            indexes,
            {
                "idx_quantity_sheets_month_room",
                "idx_quantity_sheets_month_iacuc_updated",
                "idx_reimbursement_records_month_latest",
                "idx_reimbursement_records_status_month_latest",
            },
        )


if __name__ == "__main__":
    unittest.main()
