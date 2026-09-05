import sqlite3
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from server_app import db
from server_app.shared.sqlite import ClosingConnection


class DatabaseLifecycleTests(unittest.TestCase):
    def test_request_connection_commits_and_closes(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "test.sqlite"
            with patch.object(db, "DB_PATH", path), patch.object(db, "ensure_database_ready"):
                with db.connect_db() as conn:
                    conn.execute("CREATE TABLE items (value INTEGER)")
                    conn.execute("INSERT INTO items VALUES (7)")
                self.assert_closed(conn)
                with db.connect_db() as reader:
                    self.assertEqual(reader.execute("SELECT value FROM items").fetchone()[0], 7)

    def test_rolls_back_and_closes_on_error(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "test.sqlite"
            with self.assertRaisesRegex(ValueError, "abort"):
                with sqlite3.connect(path, factory=ClosingConnection) as conn:
                    conn.execute("CREATE TABLE items (value INTEGER)")
                    conn.execute("INSERT INTO items VALUES (7)")
                    raise ValueError("abort")
            self.assert_closed(conn)
            with sqlite3.connect(path, factory=ClosingConnection) as reader:
                self.assertEqual(reader.execute("SELECT COUNT(*) FROM items").fetchone()[0], 0)

    def test_nested_context_keeps_connection_available_to_owner(self):
        with sqlite3.connect(":memory:", factory=ClosingConnection) as conn:
            with conn:
                conn.execute("CREATE TABLE items (value INTEGER)")
                conn.execute("INSERT INTO items VALUES (7)")
            self.assertEqual(conn.execute("SELECT value FROM items").fetchone()[0], 7)
        self.assert_closed(conn)

    def test_commit_failure_still_closes(self):
        with self.assertRaises(sqlite3.IntegrityError):
            with sqlite3.connect(":memory:", factory=ClosingConnection) as conn:
                conn.execute("PRAGMA foreign_keys=ON")
                conn.execute("CREATE TABLE parent (id INTEGER PRIMARY KEY)")
                conn.execute(
                    "CREATE TABLE child (parent_id INTEGER REFERENCES parent(id) DEFERRABLE INITIALLY DEFERRED)"
                )
                conn.execute("INSERT INTO child VALUES (1)")
        self.assert_closed(conn)

    def assert_closed(self, conn):
        with self.assertRaisesRegex(sqlite3.ProgrammingError, "closed"):
            conn.execute("SELECT 1")
