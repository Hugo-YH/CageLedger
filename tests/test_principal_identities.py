"""Individual identity settings never create identities for whole PI groups."""

import json
import sqlite3
import unittest
from unittest.mock import patch

from server_app.cache import invalidate_data_cache_prefixes
from server_app.domains.billing.allowance import billing_free_cages_for_pi
from server_app.domains.iacuc.sync import list_principal_identities, save_principal_identity
from server_app.persistence.bootstrap import initialize_schema
from server_app.repositories.entities import read_principal_type_by_pi, upsert_principal_identity
from server_app.shared.concurrency import StaleWriteError

ACTOR = {"id": "identity-admin", "username": "admin", "displayName": "身份管理员", "role": "admin"}


class PrincipalIdentityTests(unittest.TestCase):
    def setUp(self):
        invalidate_data_cache_prefixes("")
        self.addCleanup(invalidate_data_cache_prefixes, "")
        self.conn = sqlite3.connect(":memory:")
        self.conn.row_factory = sqlite3.Row
        self.addCleanup(self.conn.close)
        with patch("server_app.persistence.bootstrap.ensure_seed_images"):
            initialize_schema(self.conn)
        self.conn.commit()

    def source(self, table, identity, name):
        fields = {"id": identity, "pi": name, "payload": json.dumps({"id": identity, "pi": name, "amount": 123})}
        for column in self.conn.execute(f"PRAGMA table_info({table})"):
            if column["notnull"] and column["dflt_value"] is None and column["name"] not in fields:
                fields[column["name"]] = 0 if column["type"] in {"INTEGER", "REAL"} else ""
        self.conn.execute(
            f"INSERT INTO {table} ({','.join(fields)}) VALUES ({','.join('?' for _ in fields)})", list(fields.values())
        )

    def saved(self, pi, kind="pi", at="saved-version"):
        payload = {"pi": pi, "principalType": kind, "updatedAt": at}
        upsert_principal_identity(self.conn, pi, kind, at, json.dumps(payload))

    def test_lists_unique_individuals_from_all_sources_preserving_existing_personal_settings(self):
        self.source("experiment_applications", "project", "丁小虎、蔡雯嘉、林浩添")
        self.source("quantity_sheets", "sheet", "丁小虎/林浩添")
        self.source("occupancies", "occupancy", "林浩添；丁小虎|蔡雯嘉\n丁小虎")
        self.source("experiment_applications", "duplicate", "丁小虎、丁小虎")
        self.source("experiment_applications", "foreign", "Mary Jane·A-B")
        self.saved("丁小虎")
        self.saved("林浩添", at="lin-version")
        self.saved("只在身份表的负责人", "independent")
        before = {
            table: [tuple(row) for row in self.conn.execute(f"SELECT * FROM {table}")]
            for table in ("experiment_applications", "quantity_sheets", "occupancies", "principal_identities")
        }
        changes = self.conn.total_changes
        items = {item["pi"]: item for item in list_principal_identities(self.conn)}
        self.assertEqual(set(items), {"丁小虎", "蔡雯嘉", "林浩添", "Mary Jane·A-B", "只在身份表的负责人"})
        self.assertEqual(
            items["丁小虎"],
            {"pi": "丁小虎", "principalType": "pi", "freeCageAllowance": 20, "updatedAt": "saved-version"},
        )
        self.assertEqual(items["林浩添"]["updatedAt"], "lin-version")
        self.assertEqual(items["蔡雯嘉"]["freeCageAllowance"], 10)
        self.assertEqual(items["蔡雯嘉"]["updatedAt"], "")
        self.assertEqual(self.conn.total_changes, changes)
        for table, rows in before.items():
            self.assertEqual([tuple(row) for row in self.conn.execute(f"SELECT * FROM {table}")], rows)

    def test_legacy_combined_settings_are_not_deleted_or_distributed_to_members(self):
        self.saved("甲/乙", "pi")
        self.saved("甲", "independent", "personal")
        items = {item["pi"]: item for item in list_principal_identities(self.conn)}
        self.assertEqual(set(items), {"甲", "乙"})
        self.assertEqual(items["甲"]["principalType"], "independent")
        self.assertEqual(items["乙"]["updatedAt"], "")
        mapping = read_principal_type_by_pi(self.conn)
        self.assertEqual(mapping["甲/乙"], "pi")
        self.assertEqual(billing_free_cages_for_pi(mapping, "甲/乙"), 20)
        # Listing must not silently choose, add or merge personal financial allowances.
        self.assertEqual(billing_free_cages_for_pi(mapping, "乙"), 10)
        self.assertEqual(self.conn.execute("SELECT count(*) FROM principal_identities").fetchone()[0], 2)

    def test_rejects_multi_person_writes_before_any_identity_or_audit_is_changed(self):
        for name in ("甲、乙", "甲/乙", "甲\\乙", "甲；乙", "甲，乙", "甲|乙", "甲\n乙", "、 / "):
            with self.subTest(name=name):
                changes = self.conn.total_changes
                with self.assertRaisesRegex(ValueError, "单个人"):
                    save_principal_identity(self.conn, {"principalType": "pi"}, ACTOR, name)
                self.assertEqual(self.conn.total_changes, changes)
                self.assertFalse(self.conn.in_transaction)
        self.assertEqual(self.conn.execute("SELECT count(*) FROM principal_identities").fetchone()[0], 0)
        self.assertEqual(self.conn.execute("SELECT count(*) FROM audit_events").fetchone()[0], 0)

    def test_personal_save_keeps_version_audit_and_single_member_canonicalization(self):
        item, events = save_principal_identity(self.conn, {"principalType": "pi"}, ACTOR, " 甲 ")
        self.conn.commit()
        self.assertEqual(item["pi"], "甲")
        self.assertEqual(item["freeCageAllowance"], 20)
        self.assertEqual(events[0]["action"], "principal_identity.updated")
        with self.assertRaises(StaleWriteError):
            save_principal_identity(
                self.conn, {"principalType": "independent", "expectedUpdatedAt": "stale"}, ACTOR, "甲"
            )
        self.conn.rollback()
        updated, _ = save_principal_identity(
            self.conn, {"principalType": "independent", "expectedUpdatedAt": item["updatedAt"]}, ACTOR, "甲、甲"
        )
        self.assertEqual(updated["pi"], "甲")
        self.assertEqual(updated["freeCageAllowance"], 10)
        self.assertEqual(self.conn.execute("SELECT count(*) FROM principal_identities").fetchone()[0], 1)
