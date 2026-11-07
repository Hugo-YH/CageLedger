"""Totals must match full billing, and first registry builds must fence prepared input."""

import json
import sqlite3
import tempfile
import unittest
from pathlib import Path
from unittest.mock import Mock, patch

import server
from server_app import cache
from server_app.domains.billing import dashboard_calculation as amounts
from server_app.domains.billing.candidates import dashboard_candidate_snapshots
from server_app.repositories.billing_candidate_batches import candidate_room_payloads, quantity_sheet_payloads_many
from server_app.repositories.infrastructure import insert_room_record
from tests import test_reimbursement_ledger as ledger

ADMIN = {"id": "overview-test", "username": "overview-test", "displayName": "合成管理员", "role": "admin"}


class DashboardCalculationTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory(prefix="dashboard-calculation-")
        self.addCleanup(self.directory.cleanup)
        self.path = Path(self.directory.name) / "isolated.sqlite"
        self.conn = sqlite3.connect(self.path, timeout=0.1)
        self.conn.row_factory = sqlite3.Row
        self.addCleanup(self.conn.close)
        self.conn.execute("PRAGMA journal_mode=WAL")
        server.initialize_schema(self.conn)
        self.writer = sqlite3.connect(self.path, timeout=0.1)
        self.writer.row_factory = sqlite3.Row
        self.addCleanup(self.writer.close)
        for identity, billing in (("mouse", "mouse_standard"), ("rabbit", "rabbit")):
            insert_room_record(
                self.conn,
                {
                    "id": identity,
                    "name": identity,
                    "defaultBillingItem": billing,
                    "billingProfileConfigured": True,
                    "billingProfileConfirmed": True,
                },
            )
        self.conn.commit()
        cache.invalidate_data_cache_prefixes("")
        self.addCleanup(cache.invalidate_data_cache_prefixes, "")

    def sheet(self, identity, pi="A", **changes):
        value = {
            "id": identity,
            "pi": pi,
            "month": "2026-09",
            "iacuc": "Z" + identity,
            "roomId": "mouse",
            "roomName": "mouse",
            "initialCageCount": 170,
            "initialAnimalCount": 10,
            "updatedAt": "v1",
            "rows": [{"id": "row-" + identity, "date": "2026-09-03", "addedCount": 2, "removedCount": 0}],
        }
        value.update(changes)
        self.conn.execute(
            """INSERT INTO quantity_sheets(id,month,pi,iacuc,room_id,room_name,updated_at,payload)
                          VALUES(?,?,?,?,?,?,?,?)""",
            (
                identity,
                value["month"],
                pi,
                value["iacuc"],
                value["roomId"],
                value["roomName"],
                value["updatedAt"],
                json.dumps(value),
            ),
        )
        return value

    def live(self, month, pi):
        return server.generate_billing_statement_by_pi(
            self.conn, {"month": month, "pi": pi, "sourceType": "quantity_sheet"}, ADMIN
        )[0]

    def protected(self):
        return {
            t: [tuple(r) for r in self.conn.execute(f"SELECT * FROM {t} ORDER BY rowid")]
            for t in (
                "quantity_sheets",
                "billing_workflows",
                "billing_statement_versions",
                "audit_events",
                "audit_event_payload_blocks",
            )
        }

    def test_batched_totals_equal_full_statements_with_tiers_exemptions_custom_rates_and_transfers(self):
        self.conn.execute("INSERT INTO principal_identities VALUES('A','pi','v1','{}')")
        self.sheet(
            "a",
            preferredFreeCages=5,
            freeCagePriority=0,
            tierCagePriority=0,
            rows=[
                {"id": "a-row", "date": "2026-09-03", "removedCount": 2, "addedCount": 0, "transferOutToIacuc": "Zb"}
            ],
        )
        self.sheet("b", initialCageCount=10, projectEndDate="2026-09-15")
        self.sheet("zero", "B", initialCageCount=0, rows=[])
        self.sheet("exempt", "C", fullExemption=True)
        self.sheet(
            "custom",
            "D",
            customBillingSegments=[
                {"id": "special", "startDate": "2026-09-05", "endDate": "2026-09-12", "quantity": 10, "unitPrice": 7.01}
            ],
        )
        self.sheet("rabbit", "E", roomId="rabbit", roomName="rabbit", rows=[])
        self.conn.commit()
        keys = [("2026-09", pi) for pi in "ABCDE"]
        original = {key: self.live(*key)["totalAmount"] for key in keys}
        before = self.protected()
        fallback = Mock(side_effect=self.live)
        calculation = amounts.DashboardCalculation(self.conn, fallback, ADMIN)
        calculation.prepare(keys)
        for key in keys:
            self.assertEqual(calculation(*key)["totalAmount"], original[key])
        fallback.assert_not_called()
        self.assertEqual(before, self.protected())
        calculation.reset_prepared()
        self.assertEqual(calculation.prepared, {})

    def test_issued_snapshot_and_corrupt_detail_never_fall_back_to_live_amount(self):
        self.sheet("a")
        ledger.ReimbursementLedgerTests._insert_statement_on(self.conn, "wf", "version", "2026-09", "A", "Za", 12.34)
        self.conn.execute(
            "UPDATE billing_workflows SET source_type='pi_merged_quantity_sheet',iacuc='pi::A',workflow_status='statement_sent',payload=json_set(payload,'$.pi','A')"
        )
        self.conn.commit()
        fallback = Mock(side_effect=AssertionError("issued amount must stay frozen"))
        calculation = amounts.DashboardCalculation(self.conn, fallback, ADMIN)
        calculation.prepare([("2026-09", "A")])
        self.assertEqual(calculation("2026-09", "A")["totalAmount"], 12.34)
        self.conn.execute("UPDATE billing_statement_versions SET payload='{}' WHERE id='version'")
        self.conn.commit()
        calculation.reset_prepared()
        calculation.prepare([("2026-09", "A")])
        with self.assertRaises(ValueError):
            calculation("2026-09", "A")
        fallback.assert_not_called()

    def test_one_bad_source_keeps_per_pi_error_boundary_and_raw_keys_keep_legacy_generator(self):
        self.sheet("good", "A")
        self.sheet("bad", "B")
        self.conn.execute("UPDATE quantity_sheets SET payload='{' WHERE id='bad'")
        self.conn.commit()
        calculation = amounts.DashboardCalculation(self.conn, self.live, ADMIN)
        result = dashboard_candidate_snapshots(
            self.conn, "2026-09", calculation, prepare_calculations=calculation.prepare
        )
        by_pi = {r["pi"]: r for r in result}
        self.assertGreater(by_pi["A"]["total_amount"], 0)
        self.assertTrue(by_pi["B"]["error_message"])
        legacy = Mock(return_value={"totalAmount": 7})
        raw = amounts.DashboardCalculation(self.conn, legacy, ADMIN)
        raw.prepare([("2026-09", " A ")])
        self.assertEqual(raw("2026-09", " A ")["totalAmount"], 7)
        legacy.assert_called_once_with("2026-09", " A ")

    def test_first_registry_build_computes_before_lock_and_other_writer_can_acquire(self):
        self.sheet("a")
        self.sheet("b", "B")
        self.conn.commit()
        original = amounts.quantity_sheet_statement_lines
        observed = []

        def compute(*args, **kwargs):
            observed.append(self.conn.in_transaction)
            self.writer.execute("BEGIN IMMEDIATE")
            self.writer.rollback()
            return original(*args, **kwargs)

        calculation = amounts.DashboardCalculation(self.conn, self.live, ADMIN)
        before = self.protected()
        with patch.object(amounts, "quantity_sheet_statement_lines", side_effect=compute):
            rows = dashboard_candidate_snapshots(
                self.conn, "2026-09", calculation, prepare_calculations=calculation.prepare
            )
        self.assertEqual(observed, [False, False])
        self.assertTrue(all(not r["is_stale"] for r in rows))
        self.assertTrue(self.conn.in_transaction)
        self.assertEqual(self.writer.execute("SELECT COUNT(*) FROM billing_candidate_snapshots").fetchone()[0], 0)
        self.assertEqual(before, self.protected())
        self.conn.rollback()
        self.assertEqual(self.conn.execute("SELECT COUNT(*) FROM billing_candidate_snapshots").fetchone()[0], 0)

    def test_concurrent_change_discards_prepared_totals_before_first_registry_publish(self):
        value = self.sheet("a")
        self.conn.commit()
        original = amounts.quantity_sheet_statement_lines
        changed = False

        def compute(*args, **kwargs):
            nonlocal changed
            result = original(*args, **kwargs)
            if not changed:
                changed = True
                latest = {**value, "initialCageCount": 5, "updatedAt": "v2"}
                self.writer.execute(
                    "UPDATE quantity_sheets SET updated_at='v2',payload=? WHERE id='a'", (json.dumps(latest),)
                )
                self.writer.commit()
            return result

        calculation = amounts.DashboardCalculation(self.conn, self.live, ADMIN)
        with patch.object(amounts, "quantity_sheet_statement_lines", side_effect=compute):
            rows = dashboard_candidate_snapshots(
                self.conn, "2026-09", calculation, prepare_calculations=calculation.prepare
            )
        self.assertEqual(rows[0]["total_amount"], self.live("2026-09", "A")["totalAmount"])

    def test_caller_transaction_sees_own_changes_and_is_never_committed(self):
        self.sheet("a")
        self.conn.commit()
        self.conn.execute("UPDATE quantity_sheets SET payload=json_set(payload,'$.initialCageCount',1)")
        expected = self.live("2026-09", "A")["totalAmount"]
        calculation = amounts.DashboardCalculation(self.conn, self.live, ADMIN)
        rows = dashboard_candidate_snapshots(
            self.conn, "2026-09", calculation, prepare_calculations=calculation.prepare
        )
        self.assertEqual(rows[0]["total_amount"], expected)
        self.conn.rollback()
        self.assertEqual(self.writer.execute("SELECT COUNT(*) FROM billing_candidate_snapshots").fetchone()[0], 0)
        self.assertEqual(
            json.loads(self.writer.execute("SELECT payload FROM quantity_sheets").fetchone()[0])["initialCageCount"],
            170,
        )

    def test_payload_batches_preserve_single_query_order_across_sql_batches(self):
        for n in range(205):
            self.sheet(str(n), str(n))
        older = self.sheet("older", "0", updatedAt="v0")
        self.conn.commit()
        result = quantity_sheet_payloads_many(self.conn, [("2026-09", str(n)) for n in range(205)])
        self.assertEqual(len(result), 205)
        self.assertEqual([s["id"] for s in result["2026-09", "0"]], ["0", older["id"]])
        self.conn.setlimit(sqlite3.SQLITE_LIMIT_VARIABLE_NUMBER, 999)
        rooms = candidate_room_payloads(
            self.conn, [{"roomId": f"missing-{n}"} for n in range(1200)] + [{"roomName": "mouse"}]
        )
        self.assertEqual([room["id"] for room in rooms], ["mouse"])
        keys = [("2026-09", str(n)) for n in range(205)]
        calculation = amounts.DashboardCalculation(
            self.conn, Mock(side_effect=AssertionError("unexpected fallback")), ADMIN
        )
        with patch.object(amounts, "quantity_sheet_payloads_many", wraps=quantity_sheet_payloads_many) as read:
            calculation.prepare(keys)
        self.assertEqual([len(call.args[1]) for call in read.call_args_list], [200, 5])
        self.assertTrue(all(calculation(*key)["totalAmount"] >= 0 for key in keys))

    def test_prepare_started_transaction_refreshes_its_group_fingerprint_without_committing(self):
        self.sheet("a")
        self.conn.commit()
        calculation = amounts.DashboardCalculation(self.conn, self.live, ADMIN)

        def prepare(keys):
            calculation.prepare(keys)
            self.conn.execute(
                "UPDATE quantity_sheets SET updated_at='own-write',payload=json_set(payload,'$.initialCageCount',3)"
            )

        rows = dashboard_candidate_snapshots(self.conn, "2026-09", calculation, prepare_calculations=prepare)
        self.assertEqual(rows[0]["total_amount"], self.live("2026-09", "A")["totalAmount"])
        self.assertIn(
            "own-write", self.conn.execute("SELECT source_fingerprint FROM billing_candidate_snapshots").fetchone()[0]
        )
        self.conn.rollback()
        self.assertEqual(self.writer.execute("SELECT COUNT(*) FROM billing_candidate_snapshots").fetchone()[0], 0)
        self.assertEqual(self.writer.execute("SELECT updated_at FROM quantity_sheets").fetchone()[0], "v1")

    def test_late_snapshot_error_rolls_back_initial_registry_and_keeps_original_audit(self):
        self.sheet("a")
        self.conn.commit()
        self.conn.execute("""CREATE TRIGGER fail_snapshot BEFORE UPDATE ON billing_candidate_snapshots
                          WHEN new.total_amount IS NOT NULL BEGIN SELECT RAISE(ABORT,'synthetic failure'); END""")
        before = self.protected()
        calculation = amounts.DashboardCalculation(self.conn, self.live, ADMIN)
        with self.assertRaisesRegex(sqlite3.IntegrityError, "synthetic failure"), self.conn:
            dashboard_candidate_snapshots(self.conn, "2026-09", calculation, prepare_calculations=calculation.prepare)
        self.assertEqual(self.conn.execute("SELECT COUNT(*) FROM billing_candidate_snapshots").fetchone()[0], 0)
        self.assertEqual(self.conn.execute("SELECT COUNT(*) FROM billing_candidate_snapshot_iacucs").fetchone()[0], 0)
        self.assertEqual(before, self.protected())
