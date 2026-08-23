import json
import sqlite3
import unittest

import server
from server_app.cache import invalidate_data_cache
from server_app.repositories.state import assemble_state, read_cached_state


class StateCacheTests(unittest.TestCase):
    def setUp(self):
        self.conn = sqlite3.connect(":memory:")
        self.conn.row_factory = sqlite3.Row
        server.initialize_schema(self.conn)
        self.conn.execute(
            "INSERT INTO rooms (id, name, payload) VALUES ('room-1', '8014', ?)",
            (json.dumps({"id": "room-1", "name": "8014"}),),
        )
        self.conn.execute(
            "INSERT INTO audit_logs (id, message, at, payload) VALUES ('audit-1', 'updated', '2026-08-23', ?)",
            (json.dumps({"id": "audit-1", "message": "updated"}),),
        )
        self.conn.commit()
        invalidate_data_cache("assembled_state")

    def tearDown(self):
        invalidate_data_cache("assembled_state")
        self.conn.close()

    def test_cached_state_omits_audit_history_but_full_state_retains_it(self):
        cached = read_cached_state(self.conn, lambda: {})
        full = assemble_state(self.conn)

        self.assertNotIn("auditLogs", cached)
        self.assertEqual(full["auditLogs"], [{"id": "audit-1", "message": "updated"}])


if __name__ == "__main__":
    unittest.main()
