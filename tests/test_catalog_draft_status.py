import sqlite3
import unittest
from unittest.mock import patch

from server_app.domains.animal_management.catalog_draft import draft_status, get_draft, save_draft
from server_app.legacy import initialize_schema
from server_app.web import animal_inspection


class CatalogDraftStatusTests(unittest.TestCase):
    def setUp(self):
        self.conn = sqlite3.connect(":memory:")
        self.conn.row_factory = sqlite3.Row
        initialize_schema(self.conn)

    def tearDown(self):
        self.conn.close()

    def test_status_does_not_create_draft_and_preserves_existing_change_semantics(self):
        self.assertEqual(draft_status(self.conn), {"hasDraft": False, "updatedAt": ""})
        self.assertIsNone(
            self.conn.execute("SELECT 1 FROM inspection_catalog_versions WHERE version='draft'").fetchone()
        )
        draft = get_draft(self.conn)
        self.assertFalse(draft_status(self.conn)["hasDraft"])
        draft["nodes"][0]["name"] = "更改"
        saved = save_draft(
            self.conn,
            {"id": "admin"},
            {"modules": draft["modules"], "nodes": draft["nodes"], "expectedUpdatedAt": draft["version"]["updatedAt"]},
        )
        self.assertEqual(draft_status(self.conn), {"hasDraft": True, "updatedAt": saved["version"]["updatedAt"]})

    def test_http_status_requires_admin_and_does_not_create_draft(self):
        class Handler:
            user = {"id": "reader", "role": "room_admin"}
            response = None

            def require_user(self):
                return self.user

            def send_json(self, payload, status=200):
                self.response = (payload, status)

        handler = Handler()
        self.assertTrue(animal_inspection.handle_get(handler, "/api/animal-inspection-catalog/draft/status"))
        self.assertEqual(handler.response[1], 403)
        handler.user = {"id": "admin", "role": "admin"}
        with patch.object(animal_inspection, "connect_db", return_value=self.conn):
            self.assertTrue(animal_inspection.handle_get(handler, "/api/animal-inspection-catalog/draft/status"))
        self.assertEqual(handler.response, ({"hasDraft": False, "updatedAt": ""}, 200))
        self.assertIsNone(
            self.conn.execute("SELECT 1 FROM inspection_catalog_versions WHERE version='draft'").fetchone()
        )
