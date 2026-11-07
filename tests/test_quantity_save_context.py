"""Save projections preserve financial validation, mirror results and audit atoms."""

import copy
import json
import sqlite3
import unittest
from unittest.mock import patch

from server_app.cache import invalidate_data_cache_prefixes
from server_app.domains.quantity import application as app
from server_app.domains.quantity.validation_context import QuantityValidationContext
from server_app.legacy import initialize_schema
from server_app.repositories import quantity_save_context as repository
from server_app.repositories.quantity_sheets import insert_quantity_sheet

ACTOR = {"id": "context-admin", "username": "admin", "displayName": "保存核对", "role": "admin"}


class QuantitySaveContextTests(unittest.TestCase):
    def setUp(self):
        self.conn = sqlite3.connect(":memory:")
        self.conn.row_factory = sqlite3.Row
        self.conn.execute("PRAGMA foreign_keys=ON")
        initialize_schema(self.conn)
        self.conn.commit()
        self.addCleanup(self.conn.close)
        invalidate_data_cache_prefixes("")
        self.addCleanup(invalidate_data_cache_prefixes, "")

    def sheet(self, identity, iacuc="Z2026001", **fields):
        return {
            "id": identity,
            "iacuc": iacuc,
            "month": "2026-10",
            "pi": "测试PI",
            "roomId": "",
            "roomName": "",
            "rows": [],
            "updatedAt": "original",
            **fields,
        }

    def insert(self, sheet):
        insert_quantity_sheet(self.conn, sheet, app.quantity_sheet_db_values(sheet))
        self.conn.commit()

    def save(self, sheet):
        old = self.conn.execute("SELECT updated_at FROM quantity_sheets WHERE id=?", (sheet["id"],)).fetchone()
        result = app.save_quantity_sheet(
            self.conn, {"sheet": sheet, "expectedUpdatedAt": old[0] if old else ""}, ACTOR, sheet["id"]
        )
        self.conn.commit()
        return result

    def transfers(self, count=8, target="Z2026002"):
        return [
            {
                "id": f"out-{i}",
                "date": f"2026-10-{i + 1:02d}",
                "removedCount": 2,
                "removedType": "转出",
                "transferOutToIacuc": target,
            }
            for i in range(count)
        ]

    def test_existing_transfer_target_skips_directory_and_writes_once_per_target(self):
        self.insert(self.sheet("target", "Z2026002"))
        source = self.sheet("source", rows=self.transfers())
        with (
            patch.object(app, "read_transfer_applications", side_effect=AssertionError("unneeded directory read")),
            patch.object(app, "update_quantity_sheet_repository", wraps=app.update_quantity_sheet_repository) as writes,
        ):
            self.save(source)
            writes.reset_mock()
            self.save(source)
        self.assertEqual([call.args[1]["id"] for call in writes.call_args_list], ["source", "target"])
        target = json.loads(self.conn.execute("SELECT payload FROM quantity_sheets WHERE id='target'").fetchone()[0])
        self.assertEqual(sum(row["addedCount"] for row in target["rows"]), 16)
        self.assertEqual(self.conn.execute("SELECT COUNT(*) FROM quantity_sheet_transfer_links").fetchone()[0], 8)
        self.assertEqual(
            self.conn.execute(
                "SELECT COUNT(*) FROM audit_events WHERE action='quantity_sheet.transfer_synced'"
            ).fetchone()[0],
            16,
        )

    def test_missing_target_decodes_first_normalized_application_and_inserts_final_sheet_once(self):
        for identity, scalar, code, project in (
            ("first", "legacy-scalar", "Z2026002（备注）", "首条项目"),
            ("second", "Z2026002", "Z2026002", "后条项目"),
            ("other", "Z2026999", "Z2026999", "无关项目"),
        ):
            value = {"iacuc": code, "project": project, "pi": "目标PI", "funding": "来源经费"}
            self.conn.execute(
                "INSERT INTO experiment_applications(id,iacuc,imported_at,payload) VALUES(?,?,?,?)",
                (identity, scalar, "2026-10-01", json.dumps(value)),
            )
        self.conn.commit()
        with (
            patch.object(app, "read_transfer_applications", wraps=app.read_transfer_applications) as lookup,
            patch.object(app, "insert_quantity_sheet_repository", wraps=app.insert_quantity_sheet_repository) as writes,
        ):
            self.save(self.sheet("source", rows=self.transfers(3)))
        self.assertEqual(lookup.call_args.args[1], ["Z2026002"])
        self.assertEqual(len(writes.call_args_list), 2)
        target = json.loads(
            self.conn.execute("SELECT payload FROM quantity_sheets WHERE iacuc='Z2026002'").fetchone()[0]
        )
        self.assertEqual(target["project"], "首条项目")
        self.assertEqual(target["funding"], "来源经费")
        self.assertEqual(len(target["rows"]), 3)
        event = json.loads(
            self.conn.execute(
                "SELECT payload FROM audit_events WHERE action='quantity_sheet.transfer_placeholder_created'"
            ).fetchone()[0]
        )
        self.assertEqual(event["after"], target)

    def test_one_light_projection_serves_both_validators_in_the_write_transaction(self):
        self.insert(self.sheet("peer", "Z2026002", preferredFreeCages=3, rows=[{"notes": "x" * 10000}]))
        source = self.sheet("source", preferredFreeCages=2, freeCagePriority=1, tierCagePriority=1)
        with (
            patch.object(app, "list_quantity_sheets_by_month_pi", side_effect=AssertionError("full peers")),
            patch(
                "server_app.domains.quantity.validation_context.read_validation_sheets",
                wraps=repository.read_validation_sheets,
            ) as reads,
        ):
            self.save(source)
        self.assertEqual(reads.call_count, 1)
        self.assertNotIn("rows", repository.read_validation_sheets(self.conn, "2026-10", "测试PI")[0])

    def test_light_context_matches_legacy_limits_and_same_iacuc_maximum(self):
        self.insert(self.sheet("same", preferredFreeCages=6))
        self.insert(self.sheet("other", "Z2026002", preferredFreeCages=4, tierCagePriority=0))
        for preferred, tier in ((2, None), (7, None), (2, 0)):
            source = self.sheet("source", preferredFreeCages=preferred, freeCagePriority=1, tierCagePriority=tier)
            for validator in (
                app.validate_quantity_sheet_free_cage_settings,
                app.validate_quantity_sheet_tier_priority,
            ):
                outcomes = []
                for context in (None, QuantityValidationContext(self.conn, source, {})):
                    try:
                        validator(self.conn, source, context=context)
                        outcomes.append("ok")
                    except ValueError as error:
                        outcomes.append(str(error))
                self.assertEqual(outcomes[0], outcomes[1])

    def test_configuration_is_transaction_local_and_preserves_cleaned_pi_precedence(self):
        for pi, kind in (("测试PI", "independent"), ("\t测试PI\n", "pi")):
            self.conn.execute("INSERT INTO principal_identities VALUES(?,?,?,?)", (pi, kind, "v1", "{}"))
        self.conn.commit()
        app.read_principal_type_by_pi(self.conn)
        self.conn.execute("BEGIN IMMEDIATE")
        self.conn.execute("UPDATE principal_identities SET principal_type='independent' WHERE pi=?", ("\t测试PI\n",))
        context = QuantityValidationContext(self.conn, self.sheet("source"), {})
        self.assertEqual(context.principal_types, {"测试PI": "independent"})
        self.assertEqual(context.principal_types, app.read_principal_type_by_pi(self.conn))
        self.conn.rollback()

    def test_target_write_failure_rolls_back_source_links_and_audit(self):
        self.insert(self.sheet("target", "Z2026002"))
        source = self.sheet("source", rows=self.transfers(2))
        self.save(source)
        before = {
            table: [tuple(row) for row in self.conn.execute(f"SELECT * FROM {table}")]
            for table in ("quantity_sheets", "quantity_sheet_transfer_links", "audit_events")
        }
        original = app.update_quantity_sheet_repository

        def failing_target(conn, sheet, values):
            if sheet["id"] == "target":
                raise RuntimeError("target failed")
            return original(conn, sheet, values)

        modified = copy.deepcopy(source)
        modified["rows"][0]["removedCount"] = 9
        with patch.object(app, "update_quantity_sheet_repository", side_effect=failing_target):
            with self.assertRaisesRegex(RuntimeError, "target failed"):
                self.save(modified)
        self.conn.rollback()
        for table, rows in before.items():
            self.assertEqual([tuple(row) for row in self.conn.execute(f"SELECT * FROM {table}")], rows)
