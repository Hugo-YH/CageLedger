import json
import sqlite3
import unittest
from unittest.mock import patch

from server_app.cache import invalidate_data_cache_prefixes
from server_app.domains.billing import unified_candidates
from server_app.domains.technical_services import repository as services
from server_app.persistence.bootstrap import initialize_schema
from server_app.repositories.billing_candidate_queries import (
    list_billing_candidate_scalar_filter_options,
    list_billing_candidate_snapshots_page,
)
from server_app.repositories.billing_workflow_queries import (
    list_billing_workflow_filter_options,
    list_billing_workflows_page,
)
from server_app.repositories.entities import list_intake_batch_filter_options, list_intake_batches_page
from server_app.repositories.filter_options import filtered_where
from server_app.repositories.person_names import person_options, split_person_names
from server_app.repositories.quantity_sheets import list_quantity_sheet_filter_options, list_quantity_sheets_page
from server_app.web.entity_contracts import ENTITY_ORDER_BY

NAMES = ["陈晓卿", "李壮", "陈晓卿；李壮", "陈晓卿/陈晓卿\\李壮", "陈晓卿甲"]


class PersonFilterTests(unittest.TestCase):
    def setUp(self):
        invalidate_data_cache_prefixes("")
        self.addCleanup(invalidate_data_cache_prefixes, "")
        self.conn = sqlite3.connect(":memory:")
        self.conn.row_factory = sqlite3.Row
        self.addCleanup(self.conn.close)
        with patch("server_app.persistence.bootstrap.ensure_seed_images"):
            initialize_schema(self.conn)
        for index, name in enumerate(NAMES):
            payload = json.dumps({"id": str(index), "pi": name, "owner": name, "month": "2026-10", "rows": []})

            def insert(table, fields):
                for col in self.conn.execute(f"PRAGMA table_info({table})"):
                    if col[3] and col[4] is None and col[1] not in fields:
                        fields[col[1]] = 0 if col[2] in {"INTEGER", "REAL"} else ""
                columns = ",".join(fields)
                marks = ",".join("?" for _ in fields)
                self.conn.execute(f"INSERT INTO {table}({columns}) VALUES({marks})", list(fields.values()))

            insert(
                "intake_batches",
                {"id": str(index), "pi": name, "owner": name, "status": "pending_print", "payload": payload},
            )
            insert(
                "quantity_sheets", {"id": str(index), "month": "2026-10", "pi": name, "owner": name, "payload": payload}
            )
            insert(
                "billing_candidate_snapshots",
                {
                    "source_type": "quantity_sheet",
                    "month": "2026-10",
                    "pi": name,
                    "iacucs_json": "[]",
                    "total_amount": 100,
                    "error_message": "",
                    "is_stale": 0,
                    "updated_at": "v1",
                    "source_fingerprint": "test",
                },
            )
            insert(
                "billing_workflows",
                {
                    "id": str(index),
                    "business_key": str(index),
                    "iacuc": "pi::" + name,
                    "month": "2026-10",
                    "source_type": "pi_merged_quantity_sheet",
                    "workflow_status": "statement_sent",
                    "payload": payload,
                },
            )
            insert(
                "technical_service_sheets",
                {
                    "id": str(index),
                    "month": "2026-10",
                    "iacuc": f"Z{index}",
                    "pi": name,
                    "facility": "zhujiang",
                    "service_id": "test",
                    "customer_type": "internal",
                    "total_cents": 10000,
                    "updated_at": "v1",
                    "payload": payload,
                },
            )
        self.conn.commit()
        self.conn.execute("PRAGMA query_only=ON")

    def params(self, people=None, *, mode="individual", column="pi", **extra):
        return {
            "limit": 50,
            "offset": 0,
            "personFilterMode": mode,
            "columnFilters": {column: people} if people else {},
            **extra,
        }

    def intake(self, params):
        return list_intake_batches_page(self.conn, params, filtered_where, ENTITY_ORDER_BY)

    def test_delimiter_parity_deduplicates_and_keeps_name_internals(self):
        self.assertEqual(
            split_person_names(" 陈晓卿、李壮 /陈晓卿\\；|｜／＼,，;\t\nMary Jane·A-B "),
            ("陈晓卿", "李壮", "Mary Jane·A-B"),
        )
        self.assertEqual(split_person_names(None), ())

    def test_intake_exact_legacy_and_individual_modes_have_separate_caches(self):
        for summary in ("", "summary"):
            for mode, expected in (("", 1), ("individual", 3), ("", 1)):
                result = self.intake(self.params(["陈晓卿"], mode=mode, view=summary))
                self.assertEqual(result["page"]["total"], expected)
                self.assertTrue(all(row["pi"] in NAMES for row in result["items"]))
        self.assertEqual(self.intake(self.params(["不存在"]))["page"]["total"], 0)

    def test_multiple_people_or_match_once_and_owner_composes_with_other_filters(self):
        result = self.intake(self.params(["陈晓卿", "李壮"], limit=2))
        self.assertEqual(result["page"]["total"], 4)
        second = self.intake(self.params(["陈晓卿", "李壮"], limit=2, offset=2))
        self.assertEqual(len({r["id"] for r in result["items"] + second["items"]}), 4)
        self.assertEqual(self.intake(self.params(["李壮"], column="owner"))["page"]["total"], 3)
        self.assertEqual(
            self.intake(self.params(columnFilters={"pi": ["陈晓卿"], "owner": ["李壮"]}))["page"]["total"], 2
        )

    def test_person_facets_count_each_row_once_exclude_self_and_compose(self):
        for column in ("pi", "owner"):
            options = list_intake_batch_filter_options(
                self.conn, self.params(["陈晓卿"], column=column), filtered_where, column
            )
            self.assertEqual(
                {o["value"]: o["count"] for o in options["items"]}, {"陈晓卿": 3, "李壮": 3, "陈晓卿甲": 1}
            )
        legacy = list_intake_batch_filter_options(self.conn, self.params(mode=""), filtered_where, "pi")
        self.assertIn("陈晓卿；李壮", {o["value"] for o in legacy["items"]})
        self.assertEqual(person_options(self.params(), "manager", legacy["items"]), legacy["items"])

    def test_quantity_mode_preserves_raw_business_key_and_cache(self):
        for mode, count in (("", 1), ("individual", 3), ("", 1)):
            result = list_quantity_sheets_page(self.conn, self.params(["陈晓卿"], mode=mode), filtered_where)
            self.assertEqual(result["page"]["total"], count)
        options = list_quantity_sheet_filter_options(self.conn, self.params(), filtered_where, "pi")
        self.assertEqual({o["value"] for o in options["items"]}, {"陈晓卿", "李壮", "陈晓卿甲"})

    def test_candidates_keep_joint_pi_groups_and_amounts(self):
        result = list_billing_candidate_snapshots_page(self.conn, "quantity_sheet", self.params(["陈晓卿", "李壮"]))
        self.assertEqual(result["page"]["total"], 4)
        self.assertEqual(sum(r["totalAmount"] for r in result["items"]), 400)
        self.assertIn("陈晓卿；李壮", {r["pi"] for r in result["items"]})
        options = list_billing_candidate_scalar_filter_options(self.conn, "quantity_sheet", self.params(), "pi")
        self.assertEqual(len(options), 3)

    def test_workflows_person_mode_has_no_cache_collision_or_business_key_rewrite(self):
        for mode, count in (("", 1), ("individual", 3), ("", 1)):
            result = list_billing_workflows_page(self.conn, self.params(["陈晓卿"], mode=mode), str, "done")
            self.assertEqual(result["page"]["total"], count)
        options = list_billing_workflow_filter_options(self.conn, self.params(), "pi")
        self.assertEqual({o["value"] for o in options}, {"陈晓卿", "李壮", "陈晓卿甲"})
        self.assertEqual(self.conn.execute("SELECT COUNT(*) FROM billing_workflows").fetchone()[0], 5)

    def test_service_sheets_and_facets_accept_json_filters_and_preserve_snapshot_payload(self):
        with patch.object(services, "protected_ids", return_value=set()):
            for mode, count in (("", 1), ("individual", 3)):
                params = self.params(["陈晓卿"], mode=mode)
                params["columnFilters"] = json.dumps(params["columnFilters"])
                result = services.list_sheets(self.conn, params)
                self.assertEqual(result["page"]["total"], count)
            options = services.sheet_filter_options(self.conn, {**self.params(), "column": "pi"})
            self.assertEqual(len(options["items"]), 3)
            result = services.candidate_scopes(self.conn, self.params(["陈晓卿"]))
            self.assertEqual(result[1]["total"], 3)

    def test_unified_fee_list_retains_both_fee_types_and_raw_groups(self):
        with patch.object(unified_candidates, "prepare"), patch.object(services, "protected_ids", return_value=set()):
            result = unified_candidates.list_candidates(
                self.conn, {"role": "admin"}, self.params(["陈晓卿", "李壮"]), None
            )
            self.assertEqual(result["page"]["total"], 8)
            self.assertEqual(len({r["id"] for r in result["items"]}), 8)
            options = unified_candidates.filter_options(self.conn, {"role": "admin"}, self.params(), "pi", None)
            self.assertEqual(
                {o["value"]: o["count"] for o in options["items"]}, {"陈晓卿": 6, "李壮": 6, "陈晓卿甲": 2}
            )

    def test_person_match_is_read_only_and_query_count_is_bounded(self):
        before = self.conn.total_changes
        statements = []
        self.conn.set_trace_callback(statements.append)
        self.intake(self.params(["陈晓卿"], view="summary"))
        self.assertLessEqual(len([q for q in statements if q.startswith("SELECT")]), 3)
        self.assertEqual(self.conn.total_changes, before)

    def test_iacuc_import_retains_explicit_additions_without_writing_back_source(self):
        from server_app.domains.iacuc.sync import sync_project_derived_fields_after_iacuc_upload

        self.conn.execute("PRAGMA query_only=OFF")
        self.conn.execute("DELETE FROM billing_workflows")
        for identity, pi, owner in (("0", "陈晓卿；李壮", "甲\\乙"), ("1", "陈晓卿", "甲")):
            payload = {"id": identity, "iacuc": "Z1", "pi": pi, "owner": owner, "project": "旧项目"}
            self.conn.execute(
                "UPDATE quantity_sheets SET iacuc='Z1',pi=?,owner=?,payload=? WHERE id=?",
                (pi, owner, json.dumps(payload), identity),
            )
        old = [{"iacuc": "Z1", "pi": "陈晓卿", "owner": "甲", "project": "旧项目"}]
        new = [{"iacuc": "Z1", "pi": "新目录负责人", "owner": "新目录实验负责人", "project": "新项目"}]
        source_before = json.dumps([old, new])
        result = sync_project_derived_fields_after_iacuc_upload(self.conn, old, new, {"id": "admin"}, "v2")
        rows = self.conn.execute(
            "SELECT id,pi,owner,payload FROM quantity_sheets WHERE iacuc='Z1' ORDER BY id"
        ).fetchall()
        self.assertEqual((rows[0]["pi"], rows[0]["owner"]), ("陈晓卿；李壮", "甲\\乙"))
        self.assertEqual((rows[1]["pi"], rows[1]["owner"]), (new[0]["pi"], new[0]["owner"]))
        self.assertTrue(all(json.loads(r["payload"])["project"] == "新项目" for r in rows))
        self.assertEqual(json.dumps([old, new]), source_before)
        snapshot = json.loads(
            self.conn.execute(
                "SELECT payload FROM project_sync_snapshots WHERE id=?", (result["snapshotId"],)
            ).fetchone()[0]
        )
        self.assertEqual(snapshot["updatedRecordCount"], 2)
        self.assertEqual(snapshot["changes"][1]["after"]["pi"], new[0]["pi"])


if __name__ == "__main__":
    unittest.main()
