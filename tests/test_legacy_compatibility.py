import ast
import importlib
import sqlite3
import unittest
from pathlib import Path

from server_app.compatibility import LEGACY_EXPORTS, SERVER_EXPORTS

ROOT = Path(__file__).resolve().parents[1]
PYTHON_CONSUMER_ROOTS = (ROOT / "tests", ROOT / "scripts")


def imported_names(module_name):
    names = set()
    for source_root in PYTHON_CONSUMER_ROOTS:
        for path in source_root.rglob("*.py"):
            tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
            for node in ast.walk(tree):
                if isinstance(node, ast.ImportFrom) and node.module == module_name:
                    names.update(alias.name for alias in node.names)
    return names


class LegacyCompatibilityTests(unittest.TestCase):
    def test_server_imports_are_declared_and_resolvable(self):
        used = imported_names("server")
        self.assertEqual(used - SERVER_EXPORTS, set())
        module = importlib.import_module("server")
        self.assertEqual({name for name in SERVER_EXPORTS if not hasattr(module, name)}, set())

    def test_direct_legacy_imports_are_declared_and_resolvable(self):
        used = imported_names("server_app.legacy")
        self.assertEqual(used - LEGACY_EXPORTS, set())
        module = importlib.import_module("server_app.legacy")
        self.assertEqual({name for name in LEGACY_EXPORTS if not hasattr(module, name)}, set())

    def test_recovery_script_module_access_is_declared(self):
        expected = {
            "connect_db",
            "empty_state",
            "now_iso",
            "read_state",
            "write_intake_batch_entity_state",
        }
        self.assertLessEqual(expected, LEGACY_EXPORTS)

    def test_schema_initialization_is_idempotent(self):
        legacy = importlib.import_module("server_app.legacy")
        conn = sqlite3.connect(":memory:")
        try:
            conn.row_factory = sqlite3.Row
            legacy.initialize_schema(conn)
            before = schema_snapshot(conn)
            legacy.initialize_schema(conn)
            after = schema_snapshot(conn)
        finally:
            conn.close()
        self.assertEqual(after, before)


def schema_snapshot(conn):
    objects = conn.execute(
        """SELECT type, name, tbl_name, sql
           FROM sqlite_master
           WHERE name NOT LIKE 'sqlite_%'
           ORDER BY type, name"""
    ).fetchall()
    tables = [row["name"] for row in objects if row["type"] == "table"]
    columns = {
        table: [tuple(column) for column in conn.execute(f'PRAGMA table_info("{table}")').fetchall()]
        for table in tables
    }
    row_counts = {table: conn.execute(f'SELECT COUNT(*) FROM "{table}"').fetchone()[0] for table in tables}
    return {
        "objects": [tuple(row) for row in objects],
        "columns": columns,
        "rowCounts": row_counts,
    }


if __name__ == "__main__":
    unittest.main()
