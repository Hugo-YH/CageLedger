import json
import sqlite3
import unittest
from concurrent.futures import ThreadPoolExecutor

from server_app.repositories import audit_list_cache, audit_storage
from server_app.repositories.entities import _trim_audit_snapshot, list_audit_events_page
from server_app.repositories.payload import paginated_payloads
from server_app.shared.audit_codec import AuditStorageError, encode_payload


class AuditListSummaryTests(unittest.TestCase):
    def setUp(self):
        self.conn = sqlite3.connect(":memory:")
        self.conn.row_factory = sqlite3.Row
        self.conn.execute(
            "CREATE TABLE audit_events (id TEXT PRIMARY KEY, payload TEXT, at TEXT, entity_type TEXT, action TEXT)"
        )
        self.conn.execute(
            "CREATE TABLE audit_event_payload_blocks (event_id TEXT PRIMARY KEY, codec TEXT, raw_bytes INTEGER, raw_sha256 TEXT, payload BLOB)"
        )
        self.raw = json.dumps(
            {"id": "compressed", "action": "save", "before": {"payload": "x" * 20000}, "after": [1, 2]},
            ensure_ascii=False,
        )
        self.block = encode_payload("compressed", self.raw)
        self.conn.execute(
            "INSERT INTO audit_events VALUES (?,?,?,?,?)",
            ("compressed", self.block["summary"], "2026-01-01", "test", "save"),
        )
        self.conn.execute(
            "INSERT INTO audit_event_payload_blocks VALUES (?,?,?,?,?)",
            (
                "compressed",
                self.block["codec"],
                self.block["raw_bytes"],
                self.block["raw_sha256"],
                self.block["payload"],
            ),
        )
        legacy = json.dumps({"id": "legacy", "before": {"large": "z" * 20000}, "after": [1, 2, 3]})
        self.conn.execute(
            "INSERT INTO audit_events VALUES (?,?,?,?,?)", ("legacy", legacy, "2026-01-02", "test", "save")
        )
        self.conn.commit()
        self.addCleanup(self.conn.close)

    def read(self):
        return list_audit_events_page(self.conn, {"limit": 10, "offset": 0}, lambda fields, filters: ("", []))

    def test_warm_matches_full_path_and_mutation_does_not_pollute(self):
        expected = paginated_payloads(self.conn, "audit_events", "at DESC, rowid DESC", limit=10)
        for item in expected["items"]:
            _trim_audit_snapshot(item)
        self.assertEqual(self.read(), expected)
        self.assertEqual(self.read(), expected)
        self.assertNotIn("_auditStorage", json.dumps(expected))
        edited = self.read()
        edited["items"][0]["before"]["entityKeys"].append("injected")
        self.assertEqual(self.read(), expected)
        self.assertEqual(audit_storage.read_payload(self.conn, "compressed"), self.raw)

    def test_changed_metadata_bytes_summary_and_missing_block_never_hit_warm_cache(self):
        changes = (
            ("UPDATE audit_event_payload_blocks SET codec='broken' WHERE event_id='compressed'", ()),
            ("UPDATE audit_event_payload_blocks SET raw_bytes=raw_bytes+1 WHERE event_id='compressed'", ()),
            ("UPDATE audit_event_payload_blocks SET raw_sha256=? WHERE event_id='compressed'", ("0" * 64,)),
            (
                "UPDATE audit_event_payload_blocks SET payload=? WHERE event_id='compressed'",
                (self.block["payload"] + b"bad",),
            ),
            (
                "UPDATE audit_events SET payload=? WHERE id='compressed'",
                (self.block["summary"].replace('"save"', '"changed"'),),
            ),
            ("DELETE FROM audit_event_payload_blocks WHERE event_id='compressed'", ()),
        )
        for sql, params in changes:
            with self.subTest(sql=sql):
                self.read()
                self.conn.execute("SAVEPOINT corrupt")
                self.conn.execute(sql, params)
                with self.assertRaises(AuditStorageError):
                    self.read()
                with self.assertRaises(AuditStorageError):
                    audit_storage.read_payload(self.conn, "compressed")
                self.conn.execute("ROLLBACK TO corrupt")
                self.conn.execute("RELEASE corrupt")
                self.assertEqual(len(self.read()["items"]), 2)

    def test_filters_and_pagination_keep_original_behavior(self):
        filters = {"limit": 1, "offset": 1, "action": "save"}
        result = list_audit_events_page(self.conn, filters, lambda fields, values: ("action = ?", [values["action"]]))
        original = paginated_payloads(self.conn, "audit_events", "at DESC, rowid DESC", "action = ?", ["save"], 1, 1)
        for item in original["items"]:
            _trim_audit_snapshot(item)
        self.assertEqual(result, original)
        self.assertEqual(result["page"], {"limit": 1, "offset": 1, "total": 2, "hasMore": False})

    def test_legacy_payload_changes_and_marker_is_checked(self):
        self.read()
        self.conn.execute(
            "UPDATE audit_events SET payload=? WHERE id='legacy'", (json.dumps({"id": "legacy", "before": {"new": 1}}),)
        )
        self.assertEqual(self.read()["items"][0]["before"]["entityKeys"], ["new"])
        self.conn.execute(
            "UPDATE audit_events SET payload=? WHERE id='legacy'",
            (json.dumps({"id": "legacy", "_auditStorage": "zlib-audit-json-v1"}),),
        )
        with self.assertRaises(AuditStorageError):
            self.read()

    def test_cache_is_bounded_and_thread_safe(self):
        def store(index):
            key = audit_list_cache.fingerprint(str(index), "{}", None)
            audit_list_cache.put(key, {"id": index})
            return audit_list_cache.get(key)

        with ThreadPoolExecutor(max_workers=8) as pool:
            list(pool.map(store, range(600)))
        self.assertLessEqual(len(audit_list_cache._CACHE), 512)

    def test_large_legacy_string_summary_does_not_fill_the_process_cache(self):
        key = audit_list_cache.fingerprint("large-summary", "large", None)
        audit_list_cache.put(key, {"message": "x" * (256 * 1024 + 1)})
        self.assertIsNone(audit_list_cache.get(key))
