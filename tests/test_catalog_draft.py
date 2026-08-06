import sqlite3
import unittest

from server_app.domains.animal_management.catalog import active_version, version_nodes
from server_app.domains.animal_management.catalog_draft import (
    get_draft,
    list_catalog_versions,
    publish_draft,
    restore_catalog_version,
    save_draft,
)
from server_app.domains.animal_management.catalog_schema import CatalogValidationError
from server_app.legacy import initialize_schema
from server_app.shared.concurrency import StaleWriteError

ACTOR = {"id": "admin", "username": "admin", "displayName": "系统管理员", "role": "admin", "roomIds": []}


class CatalogDraftTests(unittest.TestCase):
    def setUp(self):
        self.conn = sqlite3.connect(":memory:")
        self.conn.row_factory = sqlite3.Row
        self.conn.execute("PRAGMA foreign_keys=ON")
        initialize_schema(self.conn)

    def tearDown(self):
        self.conn.close()

    def _active(self):
        version = active_version(self.conn)
        return {"version": version["version"], "nodes": version_nodes(self.conn, version["version"])}

    def test_get_draft_clones_active_catalog(self):
        active = self._active()
        draft = get_draft(self.conn)
        self.assertEqual(draft["version"]["status"], "draft")
        self.assertEqual(draft["version"]["version"], "draft")
        self.assertEqual(len(draft["nodes"]), len(active["nodes"]))
        self.assertFalse(draft["hasDraft"])
        self.assertEqual(draft["active"]["version"]["version"], active["version"])
        self.assertEqual(len(draft["active"]["nodes"]), len(active["nodes"]))

    def test_save_draft_persists_changes_and_marks_has_draft(self):
        first = get_draft(self.conn)
        nodes = first["nodes"]
        nodes[0]["name"] = "修改后的分类名"
        saved = save_draft(
            self.conn,
            ACTOR,
            {"modules": first["modules"], "nodes": nodes, "expectedUpdatedAt": first["version"]["updatedAt"]},
        )
        self.assertTrue(saved["hasDraft"])
        self.assertEqual(saved["nodes"][0]["name"], "修改后的分类名")
        self.assertNotEqual(saved["version"]["updatedAt"], first["version"]["updatedAt"])

    def test_save_draft_rejects_invalid_structure(self):
        first = get_draft(self.conn)
        nodes = first["nodes"]
        nodes[0]["nodeType"] = "SECTION"
        with self.assertRaises(CatalogValidationError):
            save_draft(
                self.conn,
                ACTOR,
                {"modules": first["modules"], "nodes": nodes, "expectedUpdatedAt": first["version"]["updatedAt"]},
            )

    def test_save_draft_rejects_stale_expected_updated_at(self):
        first = get_draft(self.conn)
        save_draft(
            self.conn,
            ACTOR,
            {"modules": first["modules"], "nodes": first["nodes"], "expectedUpdatedAt": first["version"]["updatedAt"]},
        )
        with self.assertRaises(StaleWriteError):
            save_draft(
                self.conn,
                ACTOR,
                {
                    "modules": first["modules"],
                    "nodes": first["nodes"],
                    "expectedUpdatedAt": first["version"]["updatedAt"],
                },
            )

    def test_publish_moves_active_to_history_and_activates_draft(self):
        old_active = self._active()
        first = get_draft(self.conn)
        nodes = first["nodes"]
        nodes[0]["name"] = "发布后的新名称"
        save_draft(
            self.conn,
            ACTOR,
            {"modules": first["modules"], "nodes": nodes, "expectedUpdatedAt": first["version"]["updatedAt"]},
        )
        published = publish_draft(self.conn, ACTOR)
        self.assertTrue(published["version"]["version"].startswith("manual-"))
        self.assertEqual(published["version"]["status"], "active")
        self.assertEqual(published["nodes"][0]["name"], "发布后的新名称")

        history = self.conn.execute(
            "SELECT status FROM inspection_catalog_versions WHERE version = ?", (old_active["version"],)
        ).fetchone()
        self.assertEqual(history["status"], "history")
        self.assertIsNone(
            self.conn.execute("SELECT 1 FROM inspection_catalog_versions WHERE version = 'draft'").fetchone()
        )
        audit = self.conn.execute(
            "SELECT action, entity_id FROM audit_events WHERE action = 'inspection_catalog.published' ORDER BY at DESC LIMIT 1"
        ).fetchone()
        self.assertEqual(audit["entity_id"], published["version"]["version"])

    def test_publish_without_draft_raises_lookup_error(self):
        with self.assertRaises(LookupError):
            publish_draft(self.conn, ACTOR)

    def _publish_modified_draft(self, name):
        first = get_draft(self.conn)
        nodes = first["nodes"]
        nodes[0]["name"] = name
        save_draft(
            self.conn,
            ACTOR,
            {"modules": first["modules"], "nodes": nodes, "expectedUpdatedAt": first["version"]["updatedAt"]},
        )
        return publish_draft(self.conn, ACTOR)

    def test_list_versions_returns_metadata_newest_first(self):
        first = self._publish_modified_draft("第一版")
        second = self._publish_modified_draft("第二版")
        versions = list_catalog_versions(self.conn)["items"]
        self.assertEqual(versions[0]["version"], second["version"]["version"])
        self.assertEqual(versions[0]["status"], "active")
        self.assertTrue(versions[0]["isActive"])
        self.assertEqual(sum(1 for item in versions if item["isActive"]), 1)
        self.assertEqual(versions[0]["nodeCount"], 233)
        self.assertTrue(any(item["version"] == first["version"]["version"] for item in versions))

    def test_restore_history_version_republishes_content(self):
        first = self._publish_modified_draft("第一版")
        second = self._publish_modified_draft("第二版")
        restored = restore_catalog_version(self.conn, ACTOR, first["version"]["version"])
        self.assertTrue(restored["version"]["version"].startswith("manual-"))
        self.assertNotEqual(restored["version"]["version"], second["version"]["version"])
        self.assertEqual(restored["nodes"][0]["name"], "第一版")
        history = self.conn.execute(
            "SELECT status FROM inspection_catalog_versions WHERE version = ?", (second["version"]["version"],)
        ).fetchone()
        self.assertEqual(history["status"], "history")
        audit = self.conn.execute(
            "SELECT action, entity_id FROM audit_events WHERE action = 'inspection_catalog.restored' ORDER BY at DESC LIMIT 1"
        ).fetchone()
        self.assertEqual(audit["entity_id"], restored["version"]["version"])

    def test_restore_current_active_version_rejected(self):
        active = self._publish_modified_draft("当前版")
        with self.assertRaises(ValueError):
            restore_catalog_version(self.conn, ACTOR, active["version"]["version"])

    def test_restore_missing_version_raises_lookup_error(self):
        with self.assertRaises(LookupError):
            restore_catalog_version(self.conn, ACTOR, "missing-version")

    def test_restore_seed_imported_version_republishes_content(self):
        # The seed import stores raw payloads without moduleCode; restoring must still validate.
        seed_version = active_version(self.conn)["version"]
        self._publish_modified_draft("新版")
        restored = restore_catalog_version(self.conn, ACTOR, seed_version)
        self.assertTrue(restored["version"]["version"].startswith("manual-"))
        self.assertEqual(len(restored["nodes"]), 233)
        self.assertEqual(restored["nodes"][0]["name"], "外观")


if __name__ == "__main__":
    unittest.main()
