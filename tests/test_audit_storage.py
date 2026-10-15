import json
import sqlite3
import tempfile
import unittest
from contextlib import closing, contextmanager
from pathlib import Path
from unittest.mock import patch

from scripts.compact_audit_events import convert_copy
from scripts.recover_intake_batches_from_audit import load_snapshots
from server_app.cache import invalidate_data_cache_prefixes
from server_app.domains.administration.audit import audit_event, write_audit_events
from server_app.legacy import initialize_schema
from server_app.repositories.audit_storage import compact_event, expand_event, read_payload
from server_app.repositories.entities import list_audit_events_page
from server_app.shared.audit_codec import AuditStorageError

ACTOR = {"id": "audit-user", "username": "audit-user", "displayName": "审计测试"}


class AuditStorageTests(unittest.TestCase):
    def setUp(self):
        self.conn = sqlite3.connect(":memory:")
        self.conn.row_factory = sqlite3.Row
        self.conn.execute("PRAGMA foreign_keys=ON")
        initialize_schema(self.conn)
        invalidate_data_cache_prefixes("audit_events::")

    def tearDown(self):
        self.conn.close()
        invalidate_data_cache_prefixes("audit_events::")

    def event(self):
        return audit_event(
            ACTOR,
            "test.created",
            "quantity_sheet",
            "sheet",
            "测试审计",
            [],
            "2026-10-15",
            None,
            {"notes": "完整历史" * 1000, "nested": {"number": 1.005, "flags": [None, True]}, "unknown": "原样保留"},
        )

    def list(self):
        return list_audit_events_page(self.conn, {"limit": 20, "offset": 0}, lambda specs, filters: ("", ()))

    def test_new_writes_are_lossless_and_list_contract_is_identical(self):
        event = self.event()
        write_audit_events(self.conn, [event])
        self.assertEqual(json.loads(read_payload(self.conn, event["id"])), event)
        self.assertEqual(self.conn.execute("SELECT COUNT(*) FROM audit_event_payload_blocks").fetchone()[0], 1)
        before = self.list()
        self.assertEqual(before["items"][0]["after"], {"truncated": True, "entityKeys": ["nested", "notes", "unknown"]})
        expand_event(self.conn, event["id"])
        invalidate_data_cache_prefixes("audit_events::")
        self.assertEqual(self.list(), before)
        self.assertEqual(self.conn.execute("SELECT actor_user_id FROM audit_events").fetchone()[0], ACTOR["id"])

    def test_historical_json_text_and_rowids_survive_roundtrip_and_small_events_stay_json(self):
        event = self.event()
        event["after"] = {"value": 0}
        write_audit_events(self.conn, [event])
        self.assertEqual(self.conn.execute("SELECT COUNT(*) FROM audit_event_payload_blocks").fetchone()[0], 0)
        raw = json.dumps(self.event(), ensure_ascii=True, indent=3)
        self.conn.execute("UPDATE audit_events SET payload=? WHERE id=?", (raw, event["id"]))
        old = self.conn.execute("SELECT rowid,id,at FROM audit_events").fetchone()
        self.assertTrue(compact_event(self.conn, event["id"]))
        self.assertFalse(compact_event(self.conn, event["id"]))
        self.assertEqual(read_payload(self.conn, event["id"]), raw)
        self.assertTrue(expand_event(self.conn, event["id"]))
        self.assertEqual(self.conn.execute("SELECT payload FROM audit_events").fetchone()[0], raw)
        self.assertEqual(tuple(self.conn.execute("SELECT rowid,id,at FROM audit_events").fetchone()), tuple(old))

    def test_corrupt_missing_and_identity_swapped_blocks_fail(self):
        event = self.event()
        write_audit_events(self.conn, [event])
        original = dict(self.conn.execute("SELECT * FROM audit_event_payload_blocks").fetchone())
        for field, value in [
            ("codec", "unknown"),
            ("raw_bytes", 129 * 1024 * 1024),
            ("raw_sha256", "wrong"),
            ("payload", b"bad"),
        ]:
            self.conn.execute(f"UPDATE audit_event_payload_blocks SET {field}=?", (value,))
            with self.assertRaises(AuditStorageError):
                read_payload(self.conn, event["id"])
            self.conn.execute(f"UPDATE audit_event_payload_blocks SET {field}=?", (original[field],))
        other = self.event()
        write_audit_events(self.conn, [other])
        self.conn.execute(
            "UPDATE audit_event_payload_blocks SET codec=?,raw_bytes=?,raw_sha256=?,payload=? WHERE event_id=?",
            (original["codec"], original["raw_bytes"], original["raw_sha256"], original["payload"], other["id"]),
        )
        with self.assertRaises(AuditStorageError):
            read_payload(self.conn, other["id"])
        self.conn.execute("DELETE FROM audit_event_payload_blocks WHERE event_id=?", (event["id"],))
        with self.assertRaises(AuditStorageError):
            read_payload(self.conn, event["id"])

    def test_failed_audit_insert_and_compression_roll_back_with_caller_changes(self):
        event = self.event()
        self.conn.commit()
        self.conn.execute("INSERT INTO app_settings(key,value,updated_at) VALUES ('pending','true','')")
        with patch("server_app.repositories.audit.compact_event", side_effect=RuntimeError("compress failed")):
            with self.assertRaises(RuntimeError):
                write_audit_events(self.conn, [event])
        self.assertEqual(self.conn.execute("SELECT COUNT(*) FROM audit_events").fetchone()[0], 0)
        self.assertIsNotNone(self.conn.execute("SELECT 1 FROM app_settings WHERE key='pending'").fetchone())
        self.conn.rollback()

    def test_legacy_overwrite_and_delete_clean_blocks_with_foreign_keys_off(self):
        event = self.event()
        write_audit_events(self.conn, [event])
        self.conn.commit()
        self.conn.execute("PRAGMA foreign_keys=OFF")
        self.conn.execute("UPDATE audit_events SET payload=? WHERE id=?", (json.dumps(event), event["id"]))
        self.assertEqual(self.conn.execute("SELECT COUNT(*) FROM audit_event_payload_blocks").fetchone()[0], 0)
        compact_event(self.conn, event["id"])
        self.conn.execute("DELETE FROM audit_events WHERE id=?", (event["id"],))
        self.assertEqual(self.conn.execute("SELECT COUNT(*) FROM audit_event_payload_blocks").fetchone()[0], 0)

    def test_offline_tool_preserves_input_and_expands_original_bytes(self):
        event = self.event()
        write_audit_events(self.conn, [event])
        expand_event(self.conn, event["id"])
        self.conn.commit()
        with tempfile.TemporaryDirectory() as directory:
            source, compact, expanded = [
                Path(directory) / name for name in ("input.sqlite", "compact.sqlite", "expanded.sqlite")
            ]
            with closing(sqlite3.connect(source)) as copied:
                self.conn.backup(copied)
            before = source.read_bytes()
            self.assertEqual(convert_copy(source, compact, vacuum=True)["convertedEvents"], 1)
            convert_copy(compact, expanded, mode="expand", vacuum=True)
            self.assertEqual(source.read_bytes(), before)
            with closing(sqlite3.connect(expanded)) as conn:
                self.assertEqual(json.loads(conn.execute("SELECT payload FROM audit_events").fetchone()[0]), event)
            with self.assertRaises(ValueError):
                convert_copy(source, compact)
            with self.assertRaises(ValueError):
                convert_copy(source, source)

    def test_intake_recovery_reads_full_compressed_snapshot(self):
        event = self.event()
        event.update({"entityType": "intake_batch", "entityId": "original-batch", "action": "intake_batch.created"})
        event["after"]["batchNo"] = "HISTORY-BATCH"
        write_audit_events(self.conn, [event])

        @contextmanager
        def connection():
            yield self.conn

        with patch("scripts.recover_intake_batches_from_audit.legacy.connect_db", side_effect=connection):
            snapshots = load_snapshots("original-batch")
        self.assertEqual(snapshots, [{"auditEventId": event["id"], "at": event["at"], "item": event["after"]}])


if __name__ == "__main__":
    unittest.main()
