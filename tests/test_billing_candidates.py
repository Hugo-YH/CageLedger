import json
import sqlite3
import unittest
from unittest.mock import patch

import server
from server_app.cache import invalidate_data_cache_prefixes
from server_app.domains.billing.candidates import (
    invalidate_settlement_candidate_snapshots,
    list_settlement_candidates,
    update_settlement_candidate_snapshot_from_statement,
)
from server_app.repositories.billing_candidates import (
    QUANTITY_SETTLEMENT_CALCULATION_VERSION,
    billing_candidate_snapshot_registry_needs_sync,
    get_billing_candidate_snapshot,
    list_quantity_settlement_groups,
    sync_billing_candidate_snapshot_registry,
    upsert_billing_candidate_snapshot,
)


class SettlementCandidateSnapshotTests(unittest.TestCase):
    def tearDown(self):
        invalidate_data_cache_prefixes("quantity_sheets::settlement_candidates::", "quantity_sheets::")

    def test_schema_initialization_creates_candidate_snapshot_table(self):
        with sqlite3.connect(":memory:") as conn:
            conn.row_factory = sqlite3.Row
            server.initialize_schema(conn)
            row = conn.execute(
                "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'billing_candidate_snapshots'"
            ).fetchone()
            self.assertIsNotNone(row)

    def test_default_candidate_page_refreshes_only_visible_stale_items(self):
        with build_candidate_conn() as conn:
            seed_quantity_sheet(conn, "sheet-1", "2026-07", "李教授", "Z3")
            seed_quantity_sheet(conn, "sheet-2", "2026-06", "张教授", "Z2")
            seed_quantity_sheet(conn, "sheet-3", "2026-06", "张教授", "Z1")
            seed_quantity_sheet(conn, "sheet-4", "2026-05", "王教授", "Z4")
            calls = []

            def calculate(month, pi_name):
                calls.append((month, pi_name))
                return {"iacucs": [f"{pi_name}-{month}"], "totalAmount": 123}

            result = list_settlement_candidates(
                conn,
                {
                    "limit": 1,
                    "offset": 0,
                    "sortKey": "month",
                    "sortDir": "desc",
                    "columnFilters": {},
                },
                calculate,
                "quantity_sheet",
                "2026-07-01T00:00:00Z",
            )

            self.assertEqual(calls, [("2026-07", "李教授")])
            self.assertEqual(result["items"][0]["pi"], "李教授")
            self.assertEqual(result["items"][0]["iacucs"], ["Z3"])
            self.assertEqual(result["filterOptions"]["amount"], [{"value": "123.00", "label": "¥123.00", "count": 1}])
            self.assertEqual([item["value"] for item in result["filterOptions"]["iacuc"]], ["Z1", "Z2", "Z3", "Z4"])

    def test_amount_sort_refreshes_all_stale_candidates_once(self):
        with build_candidate_conn() as conn:
            seed_quantity_sheet(conn, "sheet-1", "2026-07", "李教授", "Z3")
            seed_quantity_sheet(conn, "sheet-2", "2026-06", "张教授", "Z2")
            seed_quantity_sheet(conn, "sheet-3", "2026-05", "王教授", "Z4")
            calls = []
            amounts = {("2026-07", "李教授"): 10, ("2026-06", "张教授"): 30, ("2026-05", "王教授"): 20}

            def calculate(month, pi_name):
                calls.append((month, pi_name))
                return {"iacucs": [f"{pi_name}-{month}"], "totalAmount": amounts[(month, pi_name)]}

            first = list_settlement_candidates(
                conn,
                {
                    "limit": 2,
                    "offset": 0,
                    "sortKey": "amount",
                    "sortDir": "desc",
                    "columnFilters": {},
                },
                calculate,
                "quantity_sheet",
                "2026-07-01T00:00:00Z",
            )
            second = list_settlement_candidates(
                conn,
                {
                    "limit": 2,
                    "offset": 1,
                    "sortKey": "amount",
                    "sortDir": "desc",
                    "columnFilters": {},
                },
                calculate,
                "quantity_sheet",
                "2026-07-01T00:00:00Z",
            )

            self.assertEqual(len(calls), 3)
            self.assertEqual([item["pi"] for item in first["items"]], ["张教授", "王教授"])
            self.assertEqual([item["pi"] for item in second["items"]], ["王教授", "李教授"])
            self.assertEqual([item["value"] for item in first["filterOptions"]["amount"]], ["10.00", "20.00", "30.00"])

    def test_generate_path_can_write_snapshot_from_statement(self):
        with build_candidate_conn() as conn:
            seed_quantity_sheet(conn, "sheet-1", "2026-06", "张教授", "Z2")
            seed_quantity_sheet(conn, "sheet-2", "2026-06", "张教授", "Z1")
            list_settlement_candidates(
                conn,
                {"limit": 10, "offset": 0, "sortKey": "month", "sortDir": "desc", "columnFilters": {}},
                lambda month, pi_name: {"iacucs": ["Z1", "Z2"], "totalAmount": 100},
                "quantity_sheet",
                "2026-06-01T00:00:00Z",
            )

            update_settlement_candidate_snapshot_from_statement(
                conn,
                "2026-06",
                "张教授",
                {"iacucs": ["Z1", "Z2"], "totalAmount": 456.5, "generatedAt": "2026-06-20T08:00:00Z"},
                "quantity_sheet",
                "2026-06-20T08:00:00Z",
            )

            snapshot = get_billing_candidate_snapshot(conn, "2026-06", "张教授", "quantity_sheet")
            self.assertEqual(snapshot["iacucs"], ["Z1", "Z2"])
            self.assertEqual(snapshot["totalAmount"], 456.5)
            self.assertEqual(snapshot["error"], "")
            self.assertFalse(snapshot["isStale"])

    def test_calculation_version_marks_existing_snapshot_stale(self):
        with build_candidate_conn() as conn:
            seed_quantity_sheet(conn, "sheet-1", "2026-06", "梁教授", "Z2025154")
            upsert_billing_candidate_snapshot(
                conn,
                {
                    "month": "2026-06",
                    "pi": "梁教授",
                    "sourceType": "quantity_sheet",
                    "iacucs": ["Z2025154"],
                    "totalAmount": 1471.5,
                    "error": "",
                    "stale": False,
                    "updatedAt": "2026-07-10T00:00:00Z",
                    "sourceFingerprint": "sheet-1:sheet-1-updated",
                },
            )

            sync_billing_candidate_snapshot_registry(conn, "quantity_sheet", "2026-07-10T00:00:00Z")

            snapshot = get_billing_candidate_snapshot(conn, "2026-06", "梁教授", "quantity_sheet")
            self.assertTrue(snapshot["isStale"])
            self.assertIn(QUANTITY_SETTLEMENT_CALCULATION_VERSION, snapshot["sourceFingerprint"])

    def test_every_group_fingerprint_carries_the_calculation_version(self):
        with build_candidate_conn() as conn:
            seed_quantity_sheet(conn, "sheet-1", "2026-06", "李教授", "Z1")
            seed_quantity_sheet(conn, "sheet-2", "2026-06", "张教授", "Z2")
            groups = list_quantity_settlement_groups(conn)
            self.assertEqual(len(groups), 2)
            self.assertTrue(
                all(QUANTITY_SETTLEMENT_CALCULATION_VERSION in group["sourceFingerprint"] for group in groups)
            )
            sync_billing_candidate_snapshot_registry(conn, "quantity_sheet", "2026-07-10T00:00:00Z")
            self.assertFalse(
                billing_candidate_snapshot_registry_needs_sync(
                    conn,
                    "quantity_sheet",
                    QUANTITY_SETTLEMENT_CALCULATION_VERSION,
                )
            )

    def test_warm_candidate_list_skips_registry_scan(self):
        with build_candidate_conn() as conn:
            seed_quantity_sheet(conn, "sheet-1", "2026-06", "张教授", "Z1")
            sync_billing_candidate_snapshot_registry(conn, "quantity_sheet", "2026-07-10T00:00:00Z")
            with patch("server_app.domains.billing.candidates.sync_billing_candidate_snapshot_registry") as sync:
                list_settlement_candidates(
                    conn,
                    {"limit": 10, "offset": 0, "sortKey": "month", "sortDir": "desc", "columnFilters": {}},
                    lambda month, pi_name: {"iacucs": ["Z1"], "totalAmount": 10},
                    "quantity_sheet",
                    "2026-07-10T00:00:00Z",
                )
            sync.assert_not_called()

    def test_invalidation_updates_or_removes_only_the_affected_snapshot(self):
        with build_candidate_conn() as conn:
            seed_quantity_sheet(conn, "sheet-1", "2026-06", "张教授", "Z1")
            sync_billing_candidate_snapshot_registry(conn, "quantity_sheet", "2026-07-10T00:00:00Z")
            invalidate_settlement_candidate_snapshots(
                conn,
                [("2026-06", "张教授")],
                "quantity_sheet",
                "2026-07-10T00:00:01Z",
            )
            self.assertTrue(get_billing_candidate_snapshot(conn, "2026-06", "张教授", "quantity_sheet")["isStale"])
            conn.execute("DELETE FROM quantity_sheets WHERE id = 'sheet-1'")
            invalidate_settlement_candidate_snapshots(
                conn,
                [("2026-06", "张教授")],
                "quantity_sheet",
                "2026-07-10T00:00:02Z",
            )
            self.assertIsNone(get_billing_candidate_snapshot(conn, "2026-06", "张教授", "quantity_sheet"))


def build_candidate_conn():
    conn = sqlite3.connect(":memory:")
    conn.row_factory = sqlite3.Row
    conn.executescript(
        """
        CREATE TABLE quantity_sheets (
            id TEXT PRIMARY KEY,
            month TEXT NOT NULL,
            iacuc TEXT NOT NULL,
            room_id TEXT,
            room_name TEXT,
            manager TEXT,
            project TEXT,
            pi TEXT,
            owner TEXT,
            funding TEXT,
            updated_at TEXT NOT NULL,
            payload TEXT NOT NULL
        );
        CREATE TABLE billing_candidate_snapshots (
            source_type TEXT NOT NULL,
            month TEXT NOT NULL,
            pi TEXT NOT NULL,
            iacucs_json TEXT NOT NULL,
            iacucs_text TEXT NOT NULL,
            total_amount REAL,
            error_message TEXT NOT NULL,
            is_stale INTEGER NOT NULL DEFAULT 1,
            updated_at TEXT NOT NULL,
            source_fingerprint TEXT NOT NULL,
            PRIMARY KEY (source_type, month, pi)
        );
        """
    )
    return conn


def seed_quantity_sheet(conn, sheet_id, month, pi_name, iacuc):
    payload = {
        "id": sheet_id,
        "month": month,
        "pi": pi_name,
        "iacuc": iacuc,
        "rows": [],
    }
    conn.execute(
        """
        INSERT INTO quantity_sheets (
            id, month, iacuc, room_id, room_name, manager, project, pi, owner, funding, updated_at, payload
        )
        VALUES (?, ?, ?, '', '', '', '', ?, '', '', ?, ?)
        """,
        (sheet_id, month, iacuc, pi_name, f"{sheet_id}-updated", json.dumps(payload, ensure_ascii=False)),
    )


if __name__ == "__main__":
    unittest.main()
