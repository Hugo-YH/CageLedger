import json
import sqlite3
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from server_app.cache import invalidate_data_cache
from server_app.domains.iacuc.metadata import read_index_status
from server_app.repositories.iacuc import read_iacuc_index


class IacucMetadataTests(unittest.TestCase):
    def setUp(self):
        self.conn = sqlite3.connect(":memory:")
        self.conn.row_factory = sqlite3.Row
        self.conn.execute("CREATE TABLE experiment_applications(payload TEXT, imported_at TEXT)")
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.data = Path(self.directory.name) / "data.json"
        self.legacy = Path(self.directory.name) / "legacy.json"
        invalidate_data_cache("iacuc_index")

    def tearDown(self):
        self.conn.close()
        invalidate_data_cache("iacuc_index")

    def test_database_count_and_latest_timestamp_do_not_parse_payloads(self):
        self.conn.executemany(
            "INSERT INTO experiment_applications VALUES (?,?)",
            [("not-json", "2026-10-01"), ("also-not-json", "2026-10-02")],
        )
        with patch("server_app.repositories.iacuc.json.loads", side_effect=AssertionError("must not parse payload")):
            self.assertEqual(
                read_index_status(self.conn, self.data, self.legacy),
                {"count": 2, "updatedAt": "2026-10-02", "source": "database"},
            )

    def test_file_fallback_matches_legacy_reader_and_reuses_cache(self):
        self.legacy.write_text(json.dumps([{"iacuc": "Z1"}, {"iacuc": "Z2"}]), encoding="utf-8")
        expected = read_iacuc_index(self.conn, self.data, self.legacy)
        self.assertEqual(
            read_index_status(self.conn, self.data, self.legacy),
            {key: expected[key] for key in ("count", "updatedAt", "source")},
        )
        self.legacy.write_text("invalid-json", encoding="utf-8")
        self.assertEqual(read_index_status(self.conn, self.data, self.legacy)["count"], 2)
        self.assertEqual(read_index_status(self.conn, self.data, self.legacy)["source"], "legacy")
