"""Settings scope, cache integrity and lock boundaries over isolated SQLite."""

import copy
import json
import sqlite3
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from server_app.domains.administration import users
from server_app.domains.administration.audit import audit_event, write_audit_events
from server_app.domains.administration.auth import sanitize_user, verify_password
from server_app.domains.data_quality import read_service as quality
from server_app.domains.data_quality.archive_cache import BoundedCache
from server_app.domains.data_quality.read_repository import ArchiveIntegrityError
from server_app.domains.data_quality.repository import save_scan
from server_app.domains.researchers import repository as people
from server_app.domains.researchers import service as imports
from server_app.domains.researchers.fields import empty_fields
from server_app.domains.state import infrastructure_commands as infra
from server_app.domains.state.entity_rules import empty_state
from server_app.domains.state.persistence import assemble_state
from server_app.persistence.backfills import backfill_quantity_sheet_staff
from server_app.persistence.bootstrap import initialize_schema
from server_app.persistence.data_quality import ensure_schema
from server_app.repositories.audit_storage import read_payload
from server_app.repositories.infrastructure import insert_rack_record, insert_room_record, insert_slot_record
from server_app.repositories.users import insert_user
from server_app.shared.concurrency import StaleWriteError
from server_app.shared.sqlite import ClosingConnection
from tests.test_data_quality_read import report
from tests.test_researchers import initialize as initialize_people

ADMIN = {"id": "admin", "username": "admin", "displayName": "管理员", "role": "admin", "roomIds": []}
STAFF = {**ADMIN, "id": "staff", "role": "room_admin", "roomIds": ["a"]}


class InfrastructureScopeTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.base = self.root / "base.sqlite"
        with self.connect(self.base) as conn, patch("server_app.persistence.bootstrap.ensure_seed_images"):
            initialize_schema(conn)
            for identity in ("a", "b"):
                insert_room_record(conn, {"id": identity, "name": identity, "roomManager": identity})
                insert_rack_record(conn, {"id": identity, "name": "架", "roomId": identity, "index": 1})
                insert_slot_record(
                    conn, {"id": identity + "1", "rackId": identity, "row": 1, "col": 1, "status": "empty"}
                )
            conn.execute(
                "INSERT INTO occupancies(id,slot_id,status,start_date,payload) VALUES('legacy','b1','ended','old',?)",
                (json.dumps({"id": "legacy", "slotId": "a1", "status": "active"}),),
            )

    def connect(self, path):
        conn = sqlite3.connect(path, factory=ClosingConnection)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA foreign_keys=ON")
        return conn

    def outcome(self, operation, full):
        path = self.root / ("full.sqlite" if full else "scoped.sqlite")
        path.unlink(missing_ok=True)
        with self.connect(self.base) as original, self.connect(path) as conn:
            original.backup(conn)

        def context(conn, batches):
            return assemble_state(conn) or empty_state()

        with patch.object(infra, "connect_db", side_effect=lambda: self.connect(path)):
            try:
                if full:
                    with patch.object(infra, "read_infrastructure_context", side_effect=context):
                        value = operation()
                else:
                    value = operation()
                value = copy.deepcopy(value)

                def scrub(item):
                    if isinstance(item, dict):
                        return {k: scrub(v) for k, v in item.items() if k not in {"updatedAt", "perf", "id", "at"}}
                    if isinstance(item, list | tuple):
                        return [scrub(v) for v in item]
                    return item

                result = ("ok", scrub(value))
            except (LookupError, ValueError, PermissionError, sqlite3.IntegrityError) as error:
                result = (type(error).__name__, str(error))
        with self.connect(path) as conn:
            state = {
                table: [list(row) for row in conn.execute("SELECT * FROM " + table + " ORDER BY rowid")]
                for table in ("rooms", "racks", "cage_slots", "occupancies", "quantity_sheets")
            }
            audit = []
            for row in conn.execute("SELECT id FROM audit_events ORDER BY rowid"):
                item = json.loads(read_payload(conn, row[0]))
                item.pop("id")
                item.pop("at")
                audit.append(item)
        return result, state, audit

    def test_targeted_commands_match_full_context_permissions_references_cascades_and_audits(self):
        spec = {"id_prefix": "entity"}
        scenarios = [
            lambda: infra.write_infrastructure(
                {"roomUpdates": [{"id": "a", "name": "renamed", "roomManager": "a"}]}, ADMIN
            ),
            lambda: infra.write_infrastructure(
                {"racks": [{"id": "new", "roomId": "a", "name": "架"}], "slots": [{"id": "new-slot", "rackId": "new"}]},
                STAFF,
            ),
            lambda: infra.write_infrastructure(
                {"rackUpdates": [{"id": "b", "roomId": "b", "name": "unauthorized"}]}, STAFF
            ),
            lambda: infra.write_infrastructure({"racks": [{"id": "new", "roomId": "missing", "name": "架"}]}, ADMIN),
            lambda: infra.write_infrastructure({"slots": [{"id": "a1", "rackId": "a"}]}, ADMIN),
            lambda: infra.write_infrastructure({"slotDeletes": ["a1"]}, ADMIN),
            lambda: infra.write_infrastructure({"slotDeletes": ["missing"]}, ADMIN),
            lambda: infra.write_infrastructure({"rackDeletes": ["a"]}, STAFF),
            lambda: infra.write_infrastructure_entity("rooms", "DELETE", "b", {}, ADMIN, spec),
            lambda: infra.write_infrastructure_entity("rooms", "DELETE", "a", {}, STAFF, spec),
            lambda: infra.write_infrastructure_entity(
                "racks", "PUT", "a", {"id": "a", "name": "移动", "roomId": "b"}, ADMIN, spec
            ),
            lambda: infra.write_infrastructure_entity(
                "slots", "PUT", "a1", {"id": "a1", "rackId": "b", "status": "empty"}, STAFF, spec
            ),
        ]
        for index, operation in enumerate(scenarios):
            with self.subTest(scenario=index):
                self.assertEqual(self.outcome(operation, True), self.outcome(operation, False))

    def test_later_database_failure_rolls_back_earlier_room_update_and_audit(self):
        with self.connect(self.base) as conn:
            before = list(conn.iterdump())
        with (
            patch.object(infra, "connect_db", side_effect=lambda: self.connect(self.base)),
            patch.object(infra, "insert_slot_record", side_effect=RuntimeError("late failure")),
        ):
            with self.assertRaisesRegex(RuntimeError, "late failure"):
                infra.write_infrastructure(
                    {"roomUpdates": [{"id": "a", "name": "must rollback"}], "slots": [{"id": "new", "rackId": "a"}]},
                    ADMIN,
                )
        with self.connect(self.base) as conn:
            self.assertEqual(list(conn.iterdump()), before)

    def test_scoped_staff_backfill_keeps_trim_fallback_and_unrelated_rows(self):
        with self.connect(self.base) as conn:
            for identity, room in [("target", "\u3000a\t"), ("other", "b")]:
                item = {"id": identity, "roomId": room}
                conn.execute(
                    "INSERT INTO quantity_sheets(id,month,iacuc,room_id,room_name,manager,updated_at,payload) VALUES(?,'2026-01',? ,?,'a','','v',?)",
                    (identity, identity, room, json.dumps(item)),
                )
            for actor in ("old", "new"):
                write_audit_events(
                    conn,
                    [
                        audit_event(
                            {**ADMIN, "displayName": actor},
                            "test",
                            "quantity_sheet",
                            " target ",
                            "fixture",
                            [],
                            "same",
                            None,
                            None,
                        )
                    ],
                )
            self.assertEqual(backfill_quantity_sheet_staff(conn, ["a"]), 1)
            values = dict(conn.execute("SELECT id,payload FROM quantity_sheets"))
            self.assertEqual(json.loads(values["target"])["manager"], "new")
            self.assertEqual(json.loads(values["target"])["roomManager"], "a")
            self.assertNotIn("manager", json.loads(values["other"]))
            self.assertEqual(backfill_quantity_sheet_staff(conn, []), 1)
            insert_room_record(conn, {"id": "a b", "name": "legacy room", "roomManager": "旧房间管理员"})
            item = {"id": "sheet\t  legacy", "roomId": "a\t  b"}
            conn.execute(
                "INSERT INTO quantity_sheets(id,month,iacuc,room_id,room_name,manager,updated_at,payload) VALUES(?,'2026-01','Zlegacy',?,'legacy room','','v',?)",
                (item["id"], item["roomId"], json.dumps(item)),
            )
            write_audit_events(
                conn,
                [audit_event(ADMIN, "test", "quantity_sheet", "sheet\n legacy", "fixture", [], "same", None, None)],
            )
            self.assertEqual(backfill_quantity_sheet_staff(conn, ["a b"]), 1)
            saved = json.loads(
                conn.execute("SELECT payload FROM quantity_sheets WHERE id=?", (item["id"],)).fetchone()[0]
            )
            self.assertEqual((saved["manager"], saved["roomManager"]), (ADMIN["displayName"], "旧房间管理员"))


class PasswordLockTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.path = Path(self.temporary.name) / "isolated.sqlite"
        with self.connect() as conn, patch("server_app.persistence.bootstrap.ensure_seed_images"):
            initialize_schema(conn)
            for identity, role in [("admin", "admin"), ("target", "room_admin")]:
                insert_user(
                    conn,
                    {
                        "id": identity,
                        "username": "isolated-" + identity,
                        "display_name": identity,
                        "phone": "",
                        "password_hash": "old-hash",
                        "role": role,
                        "room_ids": "[]",
                        "active": 1,
                        "created_at": "old",
                        "updated_at": "old",
                    },
                )
            self.actor = sanitize_user(conn.execute("SELECT * FROM users WHERE id='admin'").fetchone())

    def connect(self):
        conn = sqlite3.connect(self.path, factory=ClosingConnection)
        conn.row_factory = sqlite3.Row
        return conn

    def test_hash_is_outside_writer_and_final_password_authenticates(self):
        real = users.hash_password

        def hashed(password):
            self.assertFalse(conn.in_transaction)
            with self.connect() as other:
                other.execute("BEGIN IMMEDIATE")
                other.execute("INSERT INTO app_settings VALUES('concurrent','kept','now')")
            return real(password)

        with self.connect() as conn, patch.object(users, "hash_password", side_effect=hashed):
            users.update_user(
                conn, self.actor, "target", {"password": "replacement", "expectedUpdatedAt": "old"}, verify_actor=True
            )
        with self.connect() as conn:
            value = conn.execute("SELECT password_hash FROM users WHERE id='target'").fetchone()[0]
            self.assertTrue(verify_password("replacement", value))
            self.assertEqual(
                conn.execute("SELECT value FROM app_settings WHERE key='concurrent'").fetchone()[0], "kept"
            )

    def test_target_version_and_actor_permissions_are_rechecked_after_hash(self):
        for target, error in [("target", StaleWriteError), ("admin", PermissionError)]:

            def hashed(_, target=target):
                with self.connect() as other:
                    other.execute("UPDATE users SET updated_at=? WHERE id=?", ("changed", target))
                return "prepared-hash"

            with (
                self.subTest(target=target),
                self.assertRaises(error),
                self.connect() as conn,
                patch.object(users, "hash_password", side_effect=hashed),
            ):
                users.update_user(
                    conn,
                    self.actor,
                    "target",
                    {"password": "replacement", "expectedUpdatedAt": "old"},
                    verify_actor=True,
                )
            with self.connect() as conn:
                self.assertEqual(
                    conn.execute("SELECT password_hash FROM users WHERE id='target'").fetchone()[0], "old-hash"
                )
                self.assertEqual(
                    conn.execute("SELECT COUNT(*) FROM audit_events WHERE action='user.updated'").fetchone()[0], 0
                )
                conn.execute("UPDATE users SET updated_at='old'")


class ArchiveProjectionTests(unittest.TestCase):
    def test_cached_views_follow_content_and_never_reuse_mutated_responses_or_evidence(self):
        for summary in ("first", "another database"):
            with sqlite3.connect(":memory:") as conn:
                conn.row_factory = sqlite3.Row
                ensure_schema(conn)
                value = report("same-scan", count=30)
                value["sourceSnapshot"] = {"tables": {"original": 1}}
                value["findings"][0]["summary"] = summary
                save_scan(conn, value)
                conn.commit()
                response = quality.get_issue(conn, ADMIN, "same-scan", "issue-000")
                self.assertEqual(response["item"]["summary"], summary)
                response["scan"]["sourceSnapshot"]["tables"]["original"] = 999
                self.assertEqual(
                    quality.get_issue(conn, ADMIN, "same-scan", "issue-000")["scan"]["sourceSnapshot"]["tables"][
                        "original"
                    ],
                    1,
                )
                value["findings"][0]["summary"] = "changed same id"
                manifest = {
                    **value,
                    "findings": [{k: v for k, v in item.items() if k != "evidence"} for item in value["findings"]],
                }
                conn.execute("UPDATE data_quality_scans SET payload=?", (json.dumps(manifest),))
                self.assertEqual(
                    quality.get_issue(conn, ADMIN, "same-scan", "issue-000")["item"]["summary"], "changed same id"
                )
                # sqlite3 can return a legacy JSON value stored as a BLOB.
                conn.execute("UPDATE data_quality_scans SET payload=?", (json.dumps(manifest).encode(),))
                self.assertEqual(
                    quality.get_issue(conn, ADMIN, "same-scan", "issue-000")["item"]["summary"], "changed same id"
                )
                conn.execute("UPDATE data_quality_observations SET evidence_json='{}' WHERE issue_id='issue-000'")
                with self.assertRaises(ArchiveIntegrityError):
                    quality.get_issue(conn, ADMIN, "same-scan", "issue-000")
                conn.execute("UPDATE data_quality_scans SET finding_count=0")
                with self.assertRaises(ArchiveIntegrityError):
                    quality.list_scans(conn, ADMIN, {})

    def test_projection_cache_evicts_by_size_and_count_and_skips_oversized_inputs(self):
        cache = BoundedCache(2, 5)
        cache.put("a", "A", 2)
        cache.put("b", "B", 2)
        self.assertEqual(cache.get("a"), "A")
        cache.put("c", "C", 2)
        self.assertIsNone(cache.get("b"))
        cache.put("huge", "H", 6)
        self.assertIsNone(cache.get("huge"))
        cache.put("d", "D", 4)
        self.assertIsNone(cache.get("a"))
        self.assertEqual(cache.get("d"), "D")


class ResearcherImportScopeTests(unittest.TestCase):
    def test_scoped_plan_keeps_full_plan_token_and_reads_batches_of_normalized_accounts(self):
        with sqlite3.connect(":memory:") as conn:
            conn.row_factory = sqlite3.Row
            initialize_people(conn)
            rows = []
            for number in range(850):
                item = {
                    **empty_fields(),
                    "id": str(number),
                    "account": f"Person-{number}",
                    "name": str(number),
                    "department": "d",
                    "createdAt": "old",
                    "updatedAt": "v",
                }
                people.put(conn, item)
                if number < 425:
                    rows.append(
                        {
                            "account": item["account"].upper(),
                            "values": {k: item[k] for k in empty_fields()},
                            "errors": [],
                        }
                    )
            conn.commit()
            prepared = ("test.xlsx", "a" * 64, rows)
            full = people.by_account
            with patch.object(people, "by_account", side_effect=lambda connection, accounts: full(connection)):
                expected, _ = imports.plan(conn, prepared)
            traces = []
            conn.set_trace_callback(traces.append)
            actual, existing = imports.plan(conn, prepared)
            self.assertEqual(actual, expected)
            self.assertEqual(len(existing), 425)
            queries = [q for q in traces if q.startswith("SELECT account_key,payload FROM researchers")]
            self.assertEqual(len(queries), 2)
            self.assertTrue(all("WHERE account_key IN" in q for q in queries))
