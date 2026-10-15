import copy
import json
import sqlite3
import tempfile
import threading
import unittest
from contextlib import closing
from pathlib import Path
from unittest.mock import patch

from server_app.cache import invalidate_data_cache_prefixes
from server_app.domains.quantity.application import quantity_sheet_db_values, save_quantity_sheet
from server_app.legacy import initialize_schema
from server_app.persistence.quantity_transfer_links import ensure_schema
from server_app.repositories.quantity_sheets import (
    insert_quantity_sheet,
    select_quantity_sheets_for_transfer,
    update_quantity_sheet,
)
from server_app.repositories.quantity_transfer_links import refresh_pending

ACTOR = {
    "id": "transfer-admin",
    "username": "transfer-admin",
    "displayName": "转移测试",
    "role": "admin",
    "roomIds": [],
}


class QuantityTransferLinkTests(unittest.TestCase):
    def setUp(self):
        self.conn = sqlite3.connect(":memory:")
        self.conn.row_factory = sqlite3.Row
        self.conn.execute("PRAGMA foreign_keys=ON")
        initialize_schema(self.conn)
        invalidate_data_cache_prefixes("quantity_sheets::")

    def tearDown(self):
        self.conn.close()
        invalidate_data_cache_prefixes("quantity_sheets::")

    def sheet(self, identity, iacuc="Z2026001", rows=None):
        return {
            "id": identity,
            "month": "2026-10",
            "iacuc": iacuc,
            "pi": "测试负责人",
            "roomId": "",
            "roomName": "",
            "initialCageCount": 10,
            "initialAnimalCount": 10,
            "rows": rows or [],
            "updatedAt": "2026-10-01",
        }

    def insert(self, sheet):
        insert_quantity_sheet(self.conn, sheet, quantity_sheet_db_values(sheet))

    def select(self, source, targets=(), row_ids=()):
        return select_quantity_sheets_for_transfer(self.conn, "2026-10", source, targets, row_ids)

    def save(self, sheet):
        invalidate_data_cache_prefixes("quantity_sheets::")
        old = self.conn.execute("SELECT updated_at FROM quantity_sheets WHERE id=?", (sheet["id"],)).fetchone()
        body = {"sheet": sheet}
        if old:
            body["expectedUpdatedAt"] = old[0]
        result = save_quantity_sheet(self.conn, body, ACTOR)[0]
        self.conn.commit()
        invalidate_data_cache_prefixes("quantity_sheets::")
        return result

    def test_exact_references_without_notes_prefix_or_wildcard_false_matches(self):
        source = "src_%"
        merged = self.sheet(
            "merged",
            "Z2026002",
            [{"id": "target-row", "transferMirrorContrib": {source + ":row:Z2026002:out_to_in": 3}}],
        )
        mirror = self.sheet(
            "mirror",
            "Z2026003",
            [
                {
                    "id": "xfer-" + source + "-row-Z2026003-out_to_in",
                    "addedType": "转入",
                    "addedCount": 2,
                    "transferSourceSheetId": source,
                }
            ],
        )
        decoy = self.sheet("decoy", "Z2026004", [{"id": "note", "notes": source + ":row:Z2026002:out_to_in"}])
        prefix = self.sheet(
            "prefix", "Z2026004", [{"id": "r", "transferMirrorContrib": {"src_%long:row:Z2026004:out_to_in": 1}}]
        )
        for sheet in (merged, mirror, decoy, prefix):
            self.insert(sheet)
        self.assertEqual({v["id"] for v in self.select(source, row_ids=["new-row"])}, {"merged", "mirror"})
        self.assertEqual(
            {v["id"] for v in self.select(source, targets=["Z2026004"])}, {"merged", "mirror", "decoy", "prefix"}
        )
        plan = self.conn.execute(
            "EXPLAIN QUERY PLAN SELECT target_sheet_id FROM quantity_sheet_transfer_links WHERE source_sheet_id=?",
            (source,),
        ).fetchall()
        self.assertTrue(any("idx_quantity_transfer_source" in row[3] for row in plan))

    def test_backfill_and_legacy_sql_writes_are_lossless_and_idempotent(self):
        sheet = self.sheet(
            "target", "Z2026002", [{"id": "r", "transferMirrorContrib": {"source:old:Z2026002:out_to_in": 3}}]
        )
        self.insert(sheet)
        original = self.conn.execute("SELECT payload FROM quantity_sheets").fetchone()[0]
        self.conn.execute("DROP TABLE quantity_sheet_transfer_links")
        ensure_schema(self.conn)
        self.assertEqual(refresh_pending(self.conn), 1)
        self.assertEqual(self.conn.execute("SELECT payload FROM quantity_sheets").fetchone()[0], original)
        changes = self.conn.total_changes
        ensure_schema(self.conn)
        self.assertEqual(refresh_pending(self.conn), 0)
        self.assertEqual(self.conn.total_changes, changes)
        updated = copy.deepcopy(sheet)
        updated["rows"][0]["transferMirrorContrib"] = {"other:row:Z2026002:in_to_out": 2}
        self.conn.execute("UPDATE quantity_sheets SET payload=? WHERE id=?", (json.dumps(updated), "target"))
        self.assertEqual(self.select("source"), [])
        self.assertEqual([v["id"] for v in self.select("other")], ["target"])
        self.assertEqual(self.conn.execute("SELECT COUNT(*) FROM quantity_sheet_transfer_dirty").fetchone()[0], 0)

    def test_failed_index_write_rolls_back_sheet_and_keeps_outer_transaction(self):
        sheet = self.sheet("target")
        self.insert(sheet)
        self.conn.commit()
        before = self.conn.execute("SELECT payload FROM quantity_sheets").fetchone()[0]
        self.conn.execute("INSERT INTO app_settings(key,value,updated_at) VALUES ('pending-transfer','true','')")
        with patch("server_app.repositories.quantity_sheets.replace_links", side_effect=RuntimeError("index failed")):
            with self.assertRaises(RuntimeError):
                update_quantity_sheet(
                    self.conn,
                    {**sheet, "initialCageCount": 20},
                    quantity_sheet_db_values({**sheet, "initialCageCount": 20}),
                )
        self.assertEqual(self.conn.execute("SELECT payload FROM quantity_sheets").fetchone()[0], before)
        self.assertIsNotNone(self.conn.execute("SELECT 1 FROM app_settings WHERE key='pending-transfer'").fetchone())
        self.conn.rollback()

    def test_target_deletion_cleans_derived_rows_without_foreign_keys(self):
        self.insert(self.sheet("target", "Z2026002", [{"id": "r", "transferSourceSheetId": "missing-source"}]))
        self.conn.commit()
        self.conn.execute("PRAGMA foreign_keys=OFF")
        self.conn.execute("DELETE FROM quantity_sheets WHERE id='target'")
        self.assertEqual(self.conn.execute("SELECT COUNT(*) FROM quantity_sheet_transfer_links").fetchone()[0], 0)
        self.assertEqual(self.conn.execute("SELECT COUNT(*) FROM quantity_sheet_transfer_dirty").fetchone()[0], 0)

    def test_interrupted_schema_backfill_can_restart_without_missing_references(self):
        with closing(sqlite3.connect(":memory:")) as conn:
            conn.execute("CREATE TABLE quantity_sheets(id TEXT PRIMARY KEY,month TEXT,payload TEXT)")
            sheet = self.sheet("target", "Z2026002", [{"id": "r", "transferSourceSheetId": "source"}])
            conn.execute("INSERT INTO quantity_sheets VALUES (?,?,?)", ("target", "2026-10", json.dumps(sheet)))
            conn.commit()
            ensure_schema(conn)
            self.assertEqual(refresh_pending(conn), 1)
            conn.rollback()
            self.assertIsNone(
                conn.execute("SELECT 1 FROM sqlite_master WHERE name='quantity_sheet_transfer_links'").fetchone()
            )
            ensure_schema(conn)
            self.assertEqual(refresh_pending(conn), 1)
            conn.commit()
            self.assertEqual(
                conn.execute("SELECT source_sheet_id FROM quantity_sheet_transfer_links").fetchone()[0], "source"
            )

    def test_concurrent_legacy_write_cannot_lose_dirty_marker_during_refresh(self):
        sheet = self.sheet("target", "Z2026002", [{"id": "r", "transferSourceSheetId": "before"}])
        self.insert(sheet)
        self.conn.commit()
        entered, release, writer_finished = threading.Event(), threading.Event(), threading.Event()
        errors = []
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "copy.sqlite"
            with closing(sqlite3.connect(path)) as copied:
                self.conn.backup(copied)
                copied.execute("UPDATE quantity_sheets SET payload=payload WHERE id='target'")
                copied.commit()
            from server_app.repositories.quantity_transfer_links import replace_links as original_replace

            def delayed_replace(conn, payload):
                entered.set()
                if not release.wait(3):
                    raise TimeoutError("test release")
                original_replace(conn, payload)

            def refresh():
                try:
                    with closing(sqlite3.connect(path, timeout=5)) as conn:
                        refresh_pending(conn)
                        conn.commit()
                except Exception as exc:
                    errors.append(str(exc))

            def legacy_write():
                try:
                    updated = copy.deepcopy(sheet)
                    updated["rows"][0]["transferSourceSheetId"] = "after"
                    with closing(sqlite3.connect(path, timeout=5)) as conn:
                        conn.execute("UPDATE quantity_sheets SET payload=? WHERE id='target'", (json.dumps(updated),))
                        conn.commit()
                except Exception as exc:
                    errors.append(str(exc))
                finally:
                    writer_finished.set()

            with patch("server_app.repositories.quantity_transfer_links.replace_links", side_effect=delayed_replace):
                first = threading.Thread(target=refresh)
                first.start()
                self.assertTrue(entered.wait(2))
                second = threading.Thread(target=legacy_write)
                second.start()
                self.assertFalse(writer_finished.wait(0.05))
                release.set()
                first.join(5)
                second.join(5)
            self.assertFalse(first.is_alive() or second.is_alive())
            self.assertEqual(errors, [])
            with closing(sqlite3.connect(path)) as conn:
                self.assertEqual(conn.execute("SELECT COUNT(*) FROM quantity_sheet_transfer_dirty").fetchone()[0], 1)
                self.assertEqual(
                    [v["id"] for v in select_quantity_sheets_for_transfer(conn, "2026-10", "after", [], [])], ["target"]
                )
                self.assertEqual(select_quantity_sheets_for_transfer(conn, "2026-10", "before", [], []), [])

    def test_transfer_edits_remove_old_mirrors_and_preserve_multiple_sheets(self):
        target = self.save(
            self.sheet(
                "target", "Z2026002", [{"id": "manual", "date": "2026-10-02", "addedType": "转入", "addedCount": 1}]
            )
        )
        self.save(self.sheet("second-target", "Z2026002"))
        source = self.save(
            self.sheet(
                "source",
                "Z2026001",
                [
                    {
                        "id": "source-row",
                        "date": "2026-10-02",
                        "removedType": "转出",
                        "removedCount": 3,
                        "transferOutToIacuc": "Z2026002",
                    }
                ],
            )
        )
        selected = self.select("source")
        self.assertEqual(len(selected), 1)
        original_target = selected[0]
        source["rows"][0]["transferOutToIacuc"] = "Z2026003"
        source["rows"][0]["removedCount"] = 2
        self.save(source)
        current = {
            v["id"]: json.loads(v["payload"]) for v in self.conn.execute("SELECT id,payload FROM quantity_sheets")
        }
        old = current[original_target["id"]]
        if original_target["id"] == target["id"]:
            self.assertEqual(old["rows"][0]["addedCount"], 1)
        else:
            self.assertEqual(old["rows"], [])
        selected = self.select("source")
        self.assertEqual(len(selected), 1)
        self.assertEqual(selected[0]["iacuc"], "Z2026003")
        self.assertEqual(selected[0]["rows"][0]["addedCount"], 2)
        self.assertEqual(
            self.conn.execute("SELECT COUNT(*) FROM quantity_sheets WHERE iacuc='Z2026002'").fetchone()[0], 2
        )
        source["rows"] = []
        self.save(source)
        self.assertEqual(self.select("source"), [])

    def test_reverse_direction_transfers_are_indexed_and_not_duplicated(self):
        source = self.save(
            self.sheet(
                "source",
                "Z2026001",
                [
                    {
                        "id": "in-row",
                        "date": "2026-10-03",
                        "addedType": "转入",
                        "addedCount": 2,
                        "transferInFromIacuc": "Z2026002",
                    }
                ],
            )
        )
        target = self.select("source")[0]
        self.assertEqual(target["rows"][0]["removedCount"], 2)

        self.assertEqual(
            self.conn.execute("SELECT direction,quantity FROM quantity_sheet_transfer_links").fetchone()[0], "in_to_out"
        )
        self.save(source)
        target = self.select("source")[0]
        self.assertEqual(len(target["rows"]), 1)
        self.assertEqual(target["rows"][0]["removedCount"], 2)

    def test_merged_contributions_keep_other_sources_and_manual_quantity(self):
        self.save(
            self.sheet(
                "target", "Z2026003", [{"id": "manual", "date": "2026-10-02", "addedType": "转入", "addedCount": 1}]
            )
        )
        sources = []
        for identity, iacuc, count in [("source-a", "Z2026001", 3), ("source-b", "Z2026002", 2)]:
            sources.append(
                self.save(
                    self.sheet(
                        identity,
                        iacuc,
                        [
                            {
                                "id": "row",
                                "date": "2026-10-02",
                                "removedType": "转出",
                                "removedCount": count,
                                "transferOutToIacuc": "Z2026003",
                            }
                        ],
                    )
                )
            )
        target = self.select("source-a")[0]
        self.assertEqual(target["rows"][0]["addedCount"], 6)
        sources[0]["rows"] = []
        self.save(sources[0])
        self.assertEqual(self.select("source-a"), [])
        target = self.select("source-b")[0]
        self.assertEqual(target["rows"][0]["addedCount"], 3)
        self.assertEqual(len(target["rows"][0]["transferMirrorContrib"]), 1)
        self.save(sources[1])
        self.assertEqual(self.select("source-b")[0]["rows"][0]["addedCount"], 3)


if __name__ == "__main__":
    unittest.main()
