import json
import sqlite3
import tempfile
import unittest
from pathlib import Path
from unittest.mock import Mock, patch

from server_app import composition
from server_app.cache import invalidate_data_cache_prefixes
from server_app.domains.intake.duplicates import IntakeDuplicateConfirmationRequired, confirm_duplicate_identifiers
from server_app.domains.intake.repository import find_duplicate_identifiers
from server_app.domains.state import intake_commands
from server_app.domains.state.entity_rules import empty_state
from server_app.domains.state.persistence import write_normalized_state
from server_app.persistence.bootstrap import initialize_schema
from server_app.persistence.intake_identifiers import ensure_intake_identifier_schema
from server_app.repositories.audit_storage import read_payload
from server_app.repositories.entities import upsert_intake_batch
from server_app.shared.concurrency import StaleWriteError
from server_app.shared.intake_identifiers import intake_identifier_values
from server_app.shared.sqlite import ClosingConnection
from server_app.web.handler_support import HandlerSupportMixin

ACTOR = {"id": "duplicate-admin", "username": "duplicate-admin", "displayName": "测试管理员", "role": "admin"}


def batch(identity, **fields):
    return {
        "id": identity,
        "batchNo": "（Z2026001）2026102101",
        "purchaseOrderNo": "C20261021001",
        "iacuc": "Z2026001",
        "pi": "测试负责人",
        "owner": "测试预约人",
        "supplier": "测试供应商",
        "quantity": 5,
        "finalCardCount": 1,
        "roomName": "测试房间",
        "intakeDate": "2026-10-21",
        "status": "pending_print",
        **fields,
    }


class IntakeIdentifierMigrationTests(unittest.TestCase):
    def test_backfill_preserves_payload_versions_and_is_idempotent(self):
        with sqlite3.connect(":memory:") as conn:
            conn.row_factory = sqlite3.Row
            conn.execute("CREATE TABLE intake_batches(id TEXT, batch_no TEXT, updated_at TEXT, payload TEXT)")
            for index, purchase in enumerate((" c20261021001 ", "", None)):
                item = batch(str(index), purchaseOrderNo=purchase)
                conn.execute(
                    "INSERT INTO intake_batches VALUES(?,?,?,?)",
                    (item["id"], item["batchNo"], "original-version", json.dumps(item)),
                )
            before = list(conn.execute("SELECT id,batch_no,updated_at,payload FROM intake_batches"))
            ensure_intake_identifier_schema(conn)
            changes = conn.total_changes
            ensure_intake_identifier_schema(conn)
            self.assertEqual(conn.total_changes, changes)
            self.assertEqual(before, list(conn.execute("SELECT id,batch_no,updated_at,payload FROM intake_batches")))
            self.assertEqual(
                [tuple(row) for row in conn.execute("SELECT purchase_order_no,purchase_order_key FROM intake_batches")],
                [("c20261021001", "C20261021001"), ("", ""), ("", "")],
            )
            indexes = list(conn.execute("PRAGMA index_list(intake_batches)"))
            self.assertEqual(len(indexes), 2)
            self.assertTrue(all(not row["unique"] for row in indexes))


class IntakeDuplicateTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.path = Path(self.directory.name) / "test.sqlite"
        with self.connect() as conn:
            initialize_schema(conn)
        invalidate_data_cache_prefixes("")
        self.addCleanup(invalidate_data_cache_prefixes, "")
        self.patcher = patch.object(intake_commands, "connect_db", self.connect)
        self.patcher.start()
        self.addCleanup(self.patcher.stop)

    def connect(self):
        conn = sqlite3.connect(self.path, factory=ClosingConnection)
        conn.row_factory = sqlite3.Row
        return conn

    def save(self, item, *, exists=False, actor=ACTOR, **options):
        return composition.write_intake_batch_entity_state(
            "PUT" if exists else "POST",
            item["id"] if exists else None,
            {"item": item, **options},
            actor,
            {"id_prefix": "batch"},
        )[0]["item"]

    def warning(self, item, **options):
        with self.assertRaises(IntakeDuplicateConfirmationRequired) as caught:
            self.save(item, checkDuplicates=True, **options)
        return caught.exception.details

    def counts(self):
        with self.connect() as conn:
            return tuple(
                conn.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0]
                for table in ("intake_batches", "audit_events")
            )

    def test_confirmation_writes_duplicate_and_complete_confirmation_audit(self):
        self.save(batch("original"))
        original_counts = self.counts()
        item = batch("new", purchaseOrderNo=" c20261021001 ", batchNo=" ( z2026001 )2026102101 ")
        warning = self.warning(item)
        self.assertEqual(self.counts(), original_counts)
        self.assertEqual(warning["total"], 1)
        self.assertEqual(warning["items"][0]["matchedFields"], ["purchaseOrderNo", "batchNo"])
        saved = self.save(item, checkDuplicates=True, duplicateConfirmation=warning["confirmationToken"])
        self.assertEqual(saved["purchaseOrderNo"], item["purchaseOrderNo"])
        self.assertEqual(self.counts(), (original_counts[0] + 1, original_counts[1] + 2))
        with self.connect() as conn:
            event = conn.execute(
                "SELECT id FROM audit_events WHERE action='intake_batch.duplicate_confirmed'"
            ).fetchone()
            payload = json.loads(read_payload(conn, event["id"]))
            self.assertEqual(payload["actorUserId"], ACTOR["id"])
            self.assertEqual(payload["entityId"], "new")
            self.assertEqual(
                payload["after"]["matches"], [{"id": "original", "matchedFields": ["purchaseOrderNo", "batchNo"]}]
            )

    def test_either_identifier_matches_but_blanks_and_substrings_do_not(self):
        self.save(batch("original"))
        for fields, expected in (
            ({"batchNo": "different"}, ["purchaseOrderNo"]),
            ({"purchaseOrderNo": "different"}, ["batchNo"]),
        ):
            with self.subTest(fields=fields):
                warning = self.warning(batch("new", **fields))
                self.assertEqual(warning["items"][0]["matchedFields"], expected)
        self.save(batch("empty-one", purchaseOrderNo="", batchNo=""), checkDuplicates=True)
        self.save(batch("empty-two", purchaseOrderNo="", batchNo=""), checkDuplicates=True)
        self.save(
            batch("substring", purchaseOrderNo="C2026102100", batchNo="（Z2026001）202610210"), checkDuplicates=True
        )

    def test_edit_excludes_itself_and_preserves_version_conflicts(self):
        saved = self.save(batch("original"))
        updated = self.save(saved, exists=True, checkDuplicates=True, expectedUpdatedAt=saved["updatedAt"])
        with self.assertRaises(StaleWriteError):
            self.save(saved, exists=True, checkDuplicates=True, expectedUpdatedAt=saved["updatedAt"])
        self.assertNotEqual(updated["updatedAt"], saved["updatedAt"])
        self.save(batch("other"))
        warning = self.warning(updated, exists=True, expectedUpdatedAt=updated["updatedAt"])
        self.assertEqual([item["id"] for item in warning["items"]], ["other"])
        self.save(
            updated,
            exists=True,
            checkDuplicates=True,
            duplicateConfirmation=warning["confirmationToken"],
            expectedUpdatedAt=updated["updatedAt"],
        )

    def test_confirmation_is_bound_to_draft_and_fresh_complete_match_set(self):
        self.save(batch("original"))
        item = batch("new")
        warning = self.warning(item)
        self.warning(batch("another-draft"), duplicateConfirmation=warning["confirmationToken"])
        self.warning(batch("new", batchNo="changed"), duplicateConfirmation=warning["confirmationToken"])
        self.save(batch("concurrent"))
        changed = self.warning(item, duplicateConfirmation=warning["confirmationToken"])
        self.assertEqual(changed["total"], 2)
        self.assertNotEqual(warning["confirmationToken"], changed["confirmationToken"])
        self.save(item, checkDuplicates=True, duplicateConfirmation=changed["confirmationToken"])

    def test_legacy_save_remains_compatible_and_no_confirmation_audit_is_invented(self):
        for identity in ("a", "b"):
            self.save(batch(identity))
        with self.connect() as conn:
            self.assertEqual(conn.execute("SELECT COUNT(*) FROM intake_batches").fetchone()[0], 2)
            self.assertEqual(
                conn.execute(
                    "SELECT COUNT(*) FROM audit_events WHERE action='intake_batch.duplicate_confirmed'"
                ).fetchone()[0],
                0,
            )

    def test_warning_permission_precedence_and_room_admin_confirmation(self):
        self.save(batch("original"))
        actor = {**ACTOR, "role": "room_admin", "roomIds": []}
        with self.assertRaises(PermissionError):
            self.save(batch("new"), actor=actor, checkDuplicates=True)
        actor["roomIds"] = ["authorized-room"]
        warning = self.warning(batch("new"), actor=actor)
        self.save(batch("new"), actor=actor, checkDuplicates=True, duplicateConfirmation=warning["confirmationToken"])

    def test_audit_failure_rolls_back_confirmation_and_business_record(self):
        self.save(batch("original"))
        warning = self.warning(batch("new"))
        before = self.counts()
        with patch.object(intake_commands, "write_audit_events", side_effect=RuntimeError("audit failed")):
            with self.assertRaisesRegex(RuntimeError, "audit failed"):
                self.save(batch("new"), checkDuplicates=True, duplicateConfirmation=warning["confirmationToken"])
        self.assertEqual(self.counts(), before)

    def test_match_preview_limit_does_not_truncate_check_or_audit(self):
        with self.connect() as conn:
            for index in range(24):
                upsert_intake_batch(conn, batch(f"match-{index:02d}"))
        item = batch("new")
        warning = self.warning(item)
        self.assertEqual(len(warning["items"]), 20)
        self.assertEqual(warning["total"], 24)
        with self.connect() as conn:
            confirmation = confirm_duplicate_identifiers(conn, item, "", warning["confirmationToken"])
            self.assertEqual(len(confirmation["matches"]), 24)
            conn.execute("UPDATE intake_batches SET updated_at='changed' WHERE id='match-23'")
        self.warning(item, duplicateConfirmation=warning["confirmationToken"])

    def test_legacy_full_state_writes_keep_lookup_columns_current(self):
        state = {**empty_state(), "intakeBatches": [batch("full-state")]}
        with self.connect() as conn:
            write_normalized_state(conn, state, "version")
            _, purchase, batch_key = intake_identifier_values(state["intakeBatches"][0])
            self.assertEqual(len(find_duplicate_identifiers(conn, purchase, batch_key)), 1)
            state["intakeBatches"][0]["purchaseOrderNo"] = "new-order"
            state["intakeBatches"][0]["batchNo"] = "new-batch"
            write_normalized_state(conn, state, "version-2")
            self.assertEqual(find_duplicate_identifiers(conn, purchase, batch_key), [])
            self.assertEqual(len(find_duplicate_identifiers(conn, "NEW-ORDER", "NEW-BATCH")), 1)

    def test_handler_exposes_distinct_conflict_and_rejects_anonymous_before_write(self):
        handler = Mock()
        handler.require_user.return_value = ACTOR
        ports = Mock()
        ports.write_entity_state.side_effect = IntakeDuplicateConfirmationRequired({"items": [], "total": 1})
        with patch("server_app.web.handler_support.app_ports", return_value=ports):
            HandlerSupportMixin.handle_entity_write(handler, "POST", "/api/intake-batches", None)
            response, status = handler.send_json.call_args.args
            self.assertEqual(status, 409)
            self.assertEqual(response["code"], "INTAKE_DUPLICATE_CONFIRMATION_REQUIRED")
            ports.reset_mock()
            handler.require_user.return_value = None
            HandlerSupportMixin.handle_entity_write(handler, "POST", "/api/intake-batches", None)
            ports.write_entity_state.assert_not_called()
