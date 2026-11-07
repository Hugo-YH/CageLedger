import io
import json
import sqlite3
import unittest
from unittest.mock import patch

from openpyxl import load_workbook

from server_app.cache import invalidate_data_cache, invalidate_data_cache_prefixes
from server_app.domains.billing.monthly_summary import build_monthly_summary_xlsx, build_pi_reimbursement_context
from server_app.domains.reimbursement_ledger.service import (
    confirm_allocation,
    create_allocation,
    list_obligations,
    save_claim,
)
from server_app.domains.technical_services import repository as repo
from server_app.domains.technical_services import service, settlement
from server_app.domains.technical_services.rules import daily_rows
from server_app.domains.technical_services.summary import merge_service_rows
from server_app.domains.workflow.application import save_billing_statement_workflow, update_workflow_status
from server_app.domains.workflow.permissions import require_workflow_withdrawal, withdrawal_capabilities
from server_app.pdf.documents import billing_statement_html
from server_app.persistence.bootstrap import initialize_schema
from server_app.shared.concurrency import StaleWriteError

ADMIN = {"id": "admin", "displayName": "管理员", "role": "admin", "username": "admin"}
STAFF = {"id": "staff", "displayName": "同名管理员", "role": "room_admin", "username": "staff"}


class TechnicalServiceTests(unittest.TestCase):
    def setUp(self):
        invalidate_data_cache()
        invalidate_data_cache_prefixes("applications_by_iacuc")
        self.conn = sqlite3.connect(":memory:")
        self.conn.row_factory = sqlite3.Row
        self.conn.execute("PRAGMA foreign_keys=ON")
        with patch("server_app.persistence.bootstrap.ensure_seed_images"):
            initialize_schema(self.conn)
        application = {"id": "app", "iacuc": "Z2026001", "pi": "纪老师", "project": "眼科项目", "funding": "项目来源"}
        self.conn.execute(
            "INSERT INTO experiment_applications(id,iacuc,imported_at,payload) VALUES(?,?,?,?)",
            ("app", "Z2026001", "2026-10-01", json.dumps(application)),
        )
        self.conn.commit()
        self.addCleanup(self.conn.close)
        self.addCleanup(invalidate_data_cache)
        self.addCleanup(invalidate_data_cache_prefixes, "applications_by_iacuc")

    def sheet(self, **fields):
        return {
            "id": "service-1",
            "month": "2026-10",
            "iacuc": "Z2026001",
            "facility": "zhujiang",
            "serviceId": "large_eye_drops",
            "customerType": "internal",
            "rows": [
                {"date": f"2026-10-{day:02}", "quantity": quantity}
                for day, quantity in ((1, 2), (2, 2), (3, 4), (10, 2))
            ],
            **fields,
        }

    def save(self, source=None, actor=ADMIN, identity=None, expected=None):
        with self.conn:
            return service.save(
                self.conn, actor, {"sheet": source or self.sheet(), "expectedUpdatedAt": expected}, identity
            )["item"]

    def start(self):
        preview = settlement.preview(self.conn, ADMIN, {"month": "2026-10", "pi": "纪老师"})
        with self.conn:
            return settlement.initiate(
                self.conn, ADMIN, {"month": "2026-10", "pi": "纪老师", "sourceVersions": preview["sourceVersions"]}
            )

    def test_sheet_column_filters_facets_and_pagination(self):
        for index, item in enumerate(repo.catalog(self.conn)[:12]):
            self.save(self.sheet(id=f"sheet-{index}", serviceId=item["id"]))
        first = repo.list_sheets(self.conn, {"limit": 5})
        self.assertEqual(first["page"]["total"], 12)
        target = repo.catalog(self.conn)[11]["name"]
        filters = {"columnFilters": json.dumps({"serviceName": [target]}), "limit": 5}
        selected = repo.list_sheets(self.conn, filters)
        self.assertEqual(selected["page"]["total"], 1)
        self.assertEqual(selected["items"][0]["serviceName"], target)
        facets = repo.sheet_filter_options(self.conn, {**filters, "column": "serviceName"})["items"]
        self.assertEqual(sum(option["count"] for option in facets), 12)
        self.assertEqual(len(facets), 12)
        zero = repo.list_sheets(self.conn, {"columnFilters": {"facility": ["bioisland"]}})
        self.assertEqual(zero["page"]["total"], 0)
        sorted_items = repo.list_sheets(self.conn, {"sortKey": "amount", "sortDir": "asc"})["items"]
        self.assertEqual(
            [item["totalAmount"] for item in sorted_items], sorted(item["totalAmount"] for item in sorted_items)
        )
        with self.assertRaises(ValueError):
            repo.list_sheets(self.conn, {"sortKey": "month; DROP TABLE technical_service_sheets"})
        with self.assertRaises(ValueError):
            repo.sheet_filter_options(self.conn, {"column": "month", "columnFilters": '{"month":"bad"}'})

    def test_candidate_column_filters_keep_full_pi_scope_and_frozen_amount(self):
        self.save()
        application = {"id": "app-2", "iacuc": "Z2026002", "pi": "纪老师", "project": "第二项目", "funding": "经费"}
        self.conn.execute(
            "INSERT INTO experiment_applications(id,iacuc,imported_at,payload) VALUES(?,?,?,?)",
            ("app-2", "Z2026002", "2026-10-01", json.dumps(application)),
        )
        self.conn.commit()
        invalidate_data_cache_prefixes("applications_by_iacuc")
        self.save(self.sheet(id="second", iacuc="Z2026002", facility="bioisland"))
        filtered = settlement.candidates(self.conn, ADMIN, {"columnFilters": {"iacuc": ["Z2026002"]}})
        self.assertEqual(filtered["items"][0]["totalAmount"], 600)
        self.assertEqual(filtered["items"][0]["iacucs"], ["Z2026001", "Z2026002"])
        facets = repo.candidate_filter_options(self.conn, {"column": "iacuc", "columnFilters": {"iacuc": ["Z2026002"]}})
        self.assertEqual({item["value"] for item in facets["items"]}, {"Z2026001", "Z2026002"})
        self.start()
        self.save(self.sheet(id="extra", serviceId="veterinary_observation"))
        frozen_filters = {"columnFilters": {"amount": ["600.0"], "workflow": ["statement_sent"]}}
        scopes = settlement.candidates(self.conn, ADMIN, frozen_filters)
        self.assertEqual(scopes["page"]["total"], 1)
        self.assertEqual(scopes["items"][0]["totalAmount"], 600)
        self.assertEqual(
            repo.sheet_filter_options(self.conn, {"column": "status"})["items"],
            [
                {"value": "editable", "label": "可编辑", "count": 1},
                {"value": "protected", "label": "已发起结算", "count": 2},
            ],
        )
        self.assertEqual(
            repo.candidate_filter_options(self.conn, {"column": "amount"})["items"],
            [{"value": "600.0", "label": "600.00", "count": 1}],
        )

    def test_unified_candidates_keep_fee_identity_filters_and_pagination(self):
        from server_app.domains.billing.unified_candidates import filter_options, list_candidates
        from tests.test_billing_candidates import seed_quantity_sheet

        seed_quantity_sheet(self.conn, "feeding-1", "2026-10", "纪老师", "Z2026001")
        self.conn.commit()
        self.save()
        filters = {"limit": 10, "offset": 0, "sortKey": "month", "sortDir": "desc", "columnFilters": {}}

        def calculate(month, pi):
            return {"totalAmount": 55}

        result = list_candidates(self.conn, ADMIN, filters, calculate)
        self.assertEqual(result["page"]["total"], 2)
        self.assertEqual(len({item["id"] for item in result["items"]}), 2)
        self.assertEqual(
            {(item["feeType"], item["totalAmount"]) for item in result["items"]},
            {("feeding", 55), ("technical_service", 300)},
        )
        self.assertEqual(
            list_candidates(self.conn, ADMIN, {**filters, "limit": 1, "offset": 1}, calculate)["page"]["total"], 2
        )
        selected = {**filters, "columnFilters": {"feeType": ["technical_service"], "amount": ["300.00"]}}
        self.assertEqual(
            list_candidates(self.conn, ADMIN, selected, calculate)["items"][0]["sourceType"], repo.SOURCE_TYPE
        )
        options = filter_options(
            self.conn, ADMIN, {**filters, "columnFilters": {"feeType": ["technical_service"]}}, "feeType", calculate
        )["items"]
        self.assertEqual({item["value"] for item in options}, {"feeding", "technical_service"})
        self.conn.commit()
        self.start()
        self.save(self.sheet(id="new-service", serviceId="veterinary_observation"))
        self.assertEqual(list_candidates(self.conn, ADMIN, selected, calculate)["items"][0]["totalAmount"], 300)
        reader = {**ADMIN, "role": "viewer"}
        self.assertEqual(list_candidates(self.conn, reader, filters, calculate)["page"]["total"], 1)
        with self.assertRaises(ValueError):
            list_candidates(self.conn, ADMIN, {**filters, "sortKey": "bad"}, calculate)

    def test_service_only_candidates_skip_feeding_calculation_but_facets_and_mixed_amounts_keep_it(self):
        from server_app.domains.billing.unified_candidates import filter_options, list_candidates
        from tests.test_billing_candidates import seed_quantity_sheet

        self.save()
        for number in range(6):
            seed_quantity_sheet(self.conn, f"feeding-{number}", "2026-10", f"Feeding PI {number}", f"F{number}")
        self.conn.commit()
        selected = {"limit": 2, "offset": 0, "sortDir": "desc", "columnFilters": {"feeType": ["technical_service"]}}
        for sort in ("month", "amount"):
            with self.subTest(sort=sort):

                def unrelated(*_):
                    self.fail("Service-only results must not calculate feeding amounts")

                result = list_candidates(self.conn, ADMIN, {**selected, "sortKey": sort}, unrelated)
                self.assertEqual(result["page"]["total"], 1)
                self.assertEqual(result["items"][0]["feeType"], "technical_service")
                self.assertEqual(
                    filter_options(self.conn, ADMIN, selected, "amount", unrelated)["items"][0]["value"], "300.00"
                )
        calls = []

        def calculate(month, pi):
            calls.append((month, pi))
            return {"totalAmount": 55 + int(pi.rsplit(" ", 1)[1])}

        facets = filter_options(self.conn, ADMIN, {**selected, "sortKey": "amount"}, "feeType", calculate)
        self.assertEqual({item["value"] for item in facets["items"]}, {"feeding", "technical_service"})
        self.assertEqual(len(calls), 6)
        self.conn.execute("UPDATE billing_candidate_snapshots SET is_stale=1")
        calls.clear()
        result = list_candidates(self.conn, ADMIN, {**selected, "sortKey": "amount", "columnFilters": {}}, calculate)
        self.assertEqual(len(calls), 6)
        self.assertEqual(result["page"]["total"], 7)
        self.assertEqual([item["totalAmount"] for item in result["items"]], [300, 60])

    def test_unified_cold_page_batches_only_its_visible_feeding_groups_before_writing(self):
        from server_app.domains.billing.unified_candidates import list_candidates
        from server_app.repositories.billing_candidates import sync_billing_candidate_snapshot_registry
        from tests.test_billing_candidates import seed_quantity_sheet

        for number in range(15):
            seed_quantity_sheet(self.conn, f"feeding-{number}", "2026-10", f"PI {number:02}", f"F{number}")
        sync_billing_candidate_snapshot_registry(self.conn, "quantity_sheet", "before")
        self.conn.commit()
        calls, prepared = [], []

        def calculate(month, pi):
            calls.append((pi, self.conn.in_transaction))
            return {"totalAmount": int(pi.split()[-1])}

        filters = {"limit": 5, "offset": 5, "sortKey": "month", "sortDir": "desc", "columnFilters": {}}
        result = list_candidates(self.conn, ADMIN, filters, calculate, prepare_calculations=prepared.append)
        self.assertEqual(result["page"]["total"], 15)
        self.assertEqual(calls, [(f"PI {number:02}", False) for number in range(5, 10)])
        self.assertEqual(prepared, [[("2026-10", f"PI {number:02}") for number in range(5, 10)]])
        self.assertEqual([item["totalAmount"] for item in result["items"]], list(range(5, 10)))
        self.assertTrue(self.conn.in_transaction)
        self.conn.rollback()
        self.assertEqual(
            self.conn.execute("SELECT COUNT(*) FROM billing_candidate_snapshots WHERE is_stale=1").fetchone()[0], 15
        )

    def test_unified_amount_filter_and_facet_refresh_matching_groups_before_paging(self):
        from server_app.domains.billing.unified_candidates import filter_options, list_candidates
        from server_app.repositories.billing_candidates import sync_billing_candidate_snapshot_registry
        from tests.test_billing_candidates import seed_quantity_sheet

        for number in range(4):
            seed_quantity_sheet(self.conn, f"feeding-{number}", "2026-10", f"PI {number}", f"F{number}", manager="匹配")
        seed_quantity_sheet(self.conn, "outside", "2026-09", "无关", "OUT", manager="其他")
        sync_billing_candidate_snapshot_registry(self.conn, "quantity_sheet", "before")
        self.conn.commit()
        calls = []

        def calculate(month, pi):
            calls.append(pi)
            return {"totalAmount": int(pi.split()[-1]) * 10}

        filters = {
            "limit": 1,
            "offset": 0,
            "sortKey": "month",
            "sortDir": "desc",
            "columnFilters": {"manager": ["匹配"], "amount": ["30.00"]},
        }
        result = list_candidates(self.conn, ADMIN, filters, calculate)
        self.assertEqual(calls, [f"PI {number}" for number in range(4)])
        self.assertEqual(result["page"]["total"], 1)
        self.assertEqual(result["items"][0]["pi"], "PI 3")
        self.conn.commit()
        self.conn.execute("UPDATE billing_candidate_snapshots SET is_stale=1")
        self.conn.commit()
        calls.clear()
        options = filter_options(self.conn, ADMIN, filters, "amount", calculate)["items"]
        self.assertEqual(calls, [f"PI {number}" for number in range(4)])
        self.assertEqual([row["value"] for row in options], ["0.00", "10.00", "20.00", "30.00"])

    def test_candidate_count_projection_keeps_frozen_amount_and_filter_dimensions(self):
        from server_app.domains.technical_services import listing

        self.save()
        self.start()
        self.save(self.sheet(id="extra", serviceId="veterinary_observation"))
        full, values = listing.candidate_base(repo.SOURCE_TYPE)
        thin, thin_values = listing.candidate_base(repo.SOURCE_TYPE, fields=set())
        complete = self.conn.execute(full, values).fetchone()
        projected = self.conn.execute(thin, thin_values).fetchone()
        for key in ("month", "pi", "amount", "workflow_id", "workflow_status"):
            self.assertEqual(complete[key], projected[key])
        self.assertEqual(projected["amount"], 300)
        self.assertEqual(projected["iacuc_json"], "[]")
        iacuc_only, arguments = listing.candidate_base(repo.SOURCE_TYPE, fields={"iacuc"})
        self.assertEqual(self.conn.execute(iacuc_only, arguments).fetchone()["iacuc_json"], complete["iacuc_json"])
        plan = [row[3] for row in self.conn.execute("EXPLAIN QUERY PLAN " + thin, thin_values)]
        self.assertTrue(
            any("idx_billing_workflows_technical_month_pi" in line and "<expr>=?" in line for line in plan), plan
        )
        self.assertFalse(
            any("group_concat(DISTINCT)" in line or "json_group_array(DISTINCT)" in line for line in plan), plan
        )

    def test_technical_lookup_index_preserves_corrupt_legacy_rows_but_candidate_reads_reject_them(self):
        from server_app.domains.billing.unified_candidates import list_candidates
        from server_app.persistence.indexes import create_performance_indexes

        self.save()
        self.start()
        self.conn.execute("UPDATE billing_workflows SET payload='{broken' WHERE source_type=?", (repo.SOURCE_TYPE,))
        self.conn.execute("DROP INDEX idx_billing_workflows_technical_month_pi")
        create_performance_indexes(self.conn)
        create_performance_indexes(self.conn)
        self.assertEqual(self.conn.execute("SELECT payload FROM billing_workflows").fetchone()[0], "{broken")
        with self.assertRaisesRegex(ValueError, "结算流程数据损坏"):
            list_candidates(
                self.conn, ADMIN, {"limit": 10, "offset": 0, "columnFilters": {"feeType": ["technical_service"]}}, None
            )
        with self.assertRaisesRegex(ValueError, "结算流程数据损坏"):
            repo.candidate_scopes(self.conn, {})

    def test_technical_lookup_keeps_original_text_affinity_for_legacy_pi_values(self):
        from server_app.domains.technical_services import listing

        self.save()
        self.start()
        query, arguments = listing.candidate_base(repo.SOURCE_TYPE)
        for pi, text in (("纪老师", "纪老师"), (123, "123"), (12.5, "12.5"), (True, "1"), (None, "")):
            with self.subTest(pi=pi):
                self.conn.execute("UPDATE technical_service_sheets SET pi=?", (text,))
                self.conn.execute(
                    "UPDATE billing_workflows SET payload=json_set(payload,'$.pi',json(?))", (json.dumps(pi),)
                )
                original = self.conn.execute(
                    """SELECT w.id FROM technical_service_sheets s LEFT JOIN billing_workflows w
                    ON w.month=s.month AND json_extract(w.payload,'$.pi')=s.pi AND w.source_type=?""",
                    (repo.SOURCE_TYPE,),
                ).fetchone()[0]
                self.assertEqual(self.conn.execute(query, arguments).fetchone()["workflow_id"], original)

    def test_protected_ids_project_sources_and_keep_historical_shapes_and_missing_version_guard(self):
        self.save()
        self.start()
        row = self.conn.execute("SELECT id,payload FROM billing_statement_versions LIMIT 1").fetchone()
        version_id = row["id"]
        with patch.object(repo.json, "loads", wraps=json.loads) as decode:
            self.assertEqual(repo.protected_ids(self.conn), {"service-1"})
            self.assertEqual(json.loads(decode.call_args.args[0]), ["service-1"])
        for payload, expected, error in (
            ({}, set(), None),
            ({"statement": {}}, set(), None),
            ({"statement": {"sourceIds": ["one", "two", "one"]}}, {"one", "two"}, None),
            ({"statement": {"sourceIds": "ab"}}, {"a", "b"}, None),
            ({"statement": None}, None, AttributeError),
            ({"statement": {"sourceIds": None}}, None, TypeError),
            ({"statement": {"sourceIds": [{}]}}, None, TypeError),
            ([], None, AttributeError),
        ):
            with self.subTest(payload=payload):
                self.conn.execute(
                    "UPDATE billing_statement_versions SET payload=? WHERE id=?", (json.dumps(payload), version_id)
                )
                if error:
                    with self.assertRaises(error):
                        repo.protected_ids(self.conn)
                else:
                    self.assertEqual(repo.protected_ids(self.conn), expected)
        self.conn.execute("UPDATE billing_statement_versions SET payload='not json' WHERE id=?", (version_id,))
        with self.assertRaises(json.JSONDecodeError):
            repo.protected_ids(self.conn)
        self.conn.execute("UPDATE billing_statement_versions SET version_status='voided' WHERE id=?", (version_id,))
        with self.assertRaisesRegex(ValueError, "版本缺失"):
            repo.protected_ids(self.conn)
        self.conn.execute("UPDATE billing_workflows SET current_version_id='missing'")
        with self.assertRaisesRegex(ValueError, "版本缺失"):
            repo.protected_ids(self.conn)

    def test_service_notice_preview_is_current_small_and_write_response_stays_complete(self):
        from unittest.mock import Mock

        from server_app.web import technical_services as http

        self.save()
        target = {"month": "2026-10", "pi": "纪老师", "view": "notice"}
        handler = Mock(path="/api/technical-services/settlements/preview")
        handler.require_user.return_value = ADMIN
        handler.read_json_body.return_value = target
        with patch.object(http, "connect_db", return_value=self.conn):
            http.handle(handler, "POST", handler.path)
        first = handler.send_json.call_args.args[0]
        self.assertEqual(set(first), {"statement", "sourceVersions"})
        self.assertEqual(first["statement"], {"pi": "纪老师", "month": "2026-10", "totalAmount": 300})
        with patch.object(service, "now_iso", return_value="2026-11-06T16:00:00+08:00"):
            self.save(
                self.sheet(rows=[{"date": "2026-10-01", "quantity": 20}]),
                identity="service-1",
                expected=first["sourceVersions"]["service-1"],
            )
        with patch.object(http, "connect_db", return_value=self.conn):
            http.handle(handler, "POST", handler.path)
        current = handler.send_json.call_args.args[0]
        self.assertEqual(current["statement"]["totalAmount"], 600)
        self.assertNotEqual(current["sourceVersions"], first["sourceVersions"])
        with self.assertRaises(StaleWriteError):
            settlement.initiate(self.conn, ADMIN, {**target, "sourceVersions": first["sourceVersions"]})
        self.conn.rollback()
        handler.path = "/api/technical-services/settlements"
        handler.read_json_body.return_value = {**target, "sourceVersions": current["sourceVersions"]}
        with patch.object(http, "connect_db", return_value=self.conn):
            http.handle(handler, "POST", handler.path)
        self.assertIn("lines", handler.send_json.call_args.args[0])

    def test_service_statement_excel_uses_confirmed_snapshot_and_units(self):
        from server_app.domains.billing.settlement_export import build_settlement_workbook

        self.save()
        preview = settlement.preview(self.conn, ADMIN, {"month": "2026-10", "pi": "纪老师"})
        workbook = load_workbook(io.BytesIO(build_settlement_workbook([(preview["statement"], preview["lines"])])))
        sheet = workbook.active
        self.assertEqual(sheet["B3"].value, 4)
        self.assertEqual(sheet["D3"].value, 300)
        self.assertEqual(sheet["E5"].value, "眼")
        self.assertEqual(sum(sheet[f"F{row}"].value for row in range(5, 9)), 10)
        self.assertEqual(sheet["H9"].value, "=SUM(H5:H8)")
        self.assertEqual(sheet["D3"].number_format, "0.00")

    def test_sample_catalog_migration_and_replay(self):
        repo.ensure_schema(self.conn)
        self.conn.commit()
        self.assertEqual(len(repo.catalog(self.conn)), 21)
        item = self.save()
        self.assertEqual((item["serviceDayCount"], item["totalQuantity"], item["totalAmount"]), (4, 10, 300))
        replay = self.save()
        self.assertEqual(replay["updatedAt"], item["updatedAt"])
        self.assertEqual(
            self.conn.execute("SELECT COUNT(*) FROM audit_events WHERE action='technical_service.created'").fetchone()[
                0
            ],
            1,
        )
        self.assertEqual(self.conn.execute("SELECT COUNT(*) FROM technical_service_rows").fetchone()[0], 4)
        self.assertEqual(item["funding"], "项目来源")

    def test_scope_duplicate_conflict_and_version(self):
        item = self.save()
        with self.assertRaises(StaleWriteError):
            self.save(self.sheet(id="different"))
        with self.assertRaises(StaleWriteError):
            self.save(self.sheet(), identity=item["id"], expected="outdated")
        with self.assertRaises(StaleWriteError):
            self.save(self.sheet(), identity=item["id"])
        revised = self.sheet(rows=[{"date": "2026-10-01", "quantity": 1}])
        self.assertEqual(self.save(revised, identity=item["id"], expected=item["updatedAt"])["totalAmount"], 30)

    def test_unsafe_or_non_string_draft_ids_are_rejected_before_writing(self):
        for identity in ("../", "a/b", True):
            with self.subTest(identity=identity), self.assertRaises(ValueError):
                self.save(self.sheet(id=identity))
        self.assertEqual(repo.list_sheets(self.conn, {})["page"]["total"], 0)

    def test_delete_tombstone_cannot_be_replayed(self):
        item = self.save()
        with self.conn:
            service.delete(self.conn, ADMIN, item["id"], item["updatedAt"])
        with self.assertRaises(StaleWriteError):
            self.save()
        self.assertEqual(repo.list_sheets(self.conn, {})["page"]["total"], 0)

    def test_units_dates_and_permissions(self):
        for value in (True, -1, float("inf"), 1.5):
            with self.assertRaises(ValueError):
                daily_rows([{"date": "2026-10-01", "quantity": value}], "2026-10", "眼", 30)
        with self.assertRaises(ValueError):
            daily_rows([{"date": "2026-11-01", "quantity": 1}], "2026-10", "眼", 30)
        with self.assertRaises(ValueError):
            daily_rows([{"date": "2026-10-01", "quantity": 0.5}], "2026-10", "小时", 200)
        self.assertEqual(
            daily_rows([{"date": "2026-10-01", "quantity": 20.5}], "2026-10", "小时", 200)[0]["amount"], 4100
        )
        with self.assertRaises(PermissionError):
            self.save(actor=None)

    def test_frozen_source_versions_and_distinct_feeding_workflow(self):
        item = self.save(actor=STAFF)
        preview = settlement.preview(self.conn, ADMIN, {"month": "2026-10", "pi": "纪老师"})
        self.save(
            self.sheet(rows=[{"date": "2026-10-01", "quantity": 20}]), identity=item["id"], expected=item["updatedAt"]
        )
        with self.assertRaises(StaleWriteError), self.conn:
            settlement.initiate(
                self.conn, ADMIN, {"month": "2026-10", "pi": "纪老师", "sourceVersions": preview["sourceVersions"]}
            )
        result = self.start()
        with self.assertRaises(ValueError):
            self.save(self.sheet(), identity=item["id"], expected=repo.get(self.conn, item["id"])[1]["updatedAt"])
        with self.conn:
            feeding = {**result["statement"], "sourceType": "pi_merged_quantity_sheet", "totalAmount": 55}
            workflow, *_ = save_billing_statement_workflow(self.conn, feeding, [], ADMIN)
        self.assertNotEqual(workflow["id"], result["workflow"]["id"])
        self.assertEqual(self.start()["statement"]["totalAmount"], 600)
        self.assertTrue(result["statement"]["documentNumber"].startswith("CL-PTS-"))

    def test_shared_workflow_permissions_registration_lock_and_unlock(self):
        self.save(actor=STAFF)
        result = self.start()
        identity = result["workflow"]["id"]
        self.assertTrue(withdrawal_capabilities(self.conn, STAFF, [identity])[identity])
        outsider = {**STAFF, "id": "outsider"}
        self.assertFalse(withdrawal_capabilities(self.conn, outsider, [identity])[identity])
        operator = {**outsider, "billingLockAllowed": True}
        self.assertTrue(withdrawal_capabilities(self.conn, operator, [identity])[identity])
        require_workflow_withdrawal(self.conn, operator, result["workflow"], to_status="statement_generated")
        with self.assertRaises(PermissionError):
            require_workflow_withdrawal(self.conn, outsider, result["workflow"], to_status="statement_generated")
        with self.conn:
            workflow, _, _ = update_workflow_status(
                self.conn,
                identity,
                "statement_archived",
                STAFF,
                registration={
                    "signedStatementReturned": True,
                    "reimbursementFormReturned": True,
                    "reimbursementForms": [{"formNo": "TS-001", "amount": 300, "fundingBookNo": "F001"}],
                },
            )
            self.assertEqual(workflow["workflowStatus"], "statement_archived")
            update_workflow_status(self.conn, identity, "statement_locked", ADMIN)
        self.assertFalse(withdrawal_capabilities(self.conn, STAFF, [identity])[identity])
        with self.conn:
            workflow, _, _ = update_workflow_status(self.conn, identity, "statement_archived", ADMIN)
            self.assertEqual(workflow["workflowStatus"], "statement_archived")
            update_workflow_status(self.conn, identity, "statement_sent", STAFF, note="修正登记")
            update_workflow_status(self.conn, identity, "statement_generated", STAFF, note="修正数量")
        self.assertNotIn("service-1", repo.protected_ids(self.conn))

    def test_price_snapshot_and_summary_facility_only_service(self):
        first = self.save()
        self.save(self.sheet(id="island", facility="bioisland", customerType="external"))
        result = self.start()
        self.assertEqual(result["statement"]["totalAmount"], 700)
        summary = merge_service_rows([], settlement.export_sheets(self.conn, "2026-10"), {}, {})
        self.assertEqual(
            {r["facility"]: r["technicalServiceAmount"] for r in summary}, {"珠江新城": 300, "生物岛": 400}
        )
        workbook = load_workbook(io.BytesIO(build_monthly_summary_xlsx("2026-10", summary)), data_only=False)
        self.assertEqual(workbook.active["S2"].value, "技术服务费（元）")
        self.assertEqual(sum(workbook.active.cell(i, 19).value for i in (3, 4)), 700)
        self.assertEqual(workbook.active["S3"].number_format, "0.00")
        self.assertEqual(first["priceSnapshot"]["version"], "eye-research-2024-4-v1")
        self.assertEqual(result["statement"]["serviceDayCount"], 4)

    def test_pdf_total_all_pages_and_shared_ledger(self):
        self.save(self.sheet(rows=[{"date": f"2026-10-{i:02}", "quantity": 1} for i in range(1, 26)]))
        result = self.start()
        html = billing_statement_html(result["statement"], result["lines"])
        self.assertEqual(html.count('class="technical-service-print-page"'), 2)
        self.assertIn("750.00 元", html)
        self.assertIn("第 2 / 2 页", html)
        self.assertIn("2026-10-25", html)
        obligations = list_obligations(self.conn, ADMIN, {})["items"]
        self.assertEqual(obligations[0]["payableAmount"], 750)
        self.assertEqual(obligations[0]["feeType"], "technical_service")

    def test_saved_price_and_project_snapshot_are_not_repriced(self):
        item = self.save(self.sheet(pi="伪造负责人", funding="伪造经费"))
        self.assertEqual(item["pi"], "纪老师")
        self.assertEqual(item["funding"], "项目来源")
        changed = {**item["priceSnapshot"], "internalPrice": 99}
        self.conn.execute(
            "UPDATE technical_service_catalog SET payload=? WHERE id=?", (json.dumps(changed), item["serviceId"])
        )
        self.conn.commit()
        revised = self.save(
            self.sheet(rows=[{"date": "2026-10-01", "quantity": 1}]), identity=item["id"], expected=item["updatedAt"]
        )
        self.assertEqual(revised["totalAmount"], 30)
        self.assertEqual(revised["priceSnapshot"]["internalPrice"], 30)

    def test_candidate_scope_paging_uses_full_pi_total_and_stable_count(self):
        self.save()
        self.save(self.sheet(id="island", facility="bioisland"))
        application = {"iacuc": "Z2026002", "pi": "另一位负责人", "project": "另一项目", "funding": "另一经费"}
        self.conn.execute(
            "INSERT INTO experiment_applications(id,iacuc,imported_at,payload) VALUES(?,?,?,?)",
            ("app2", "Z2026002", "2026-10-01", json.dumps(application)),
        )
        self.conn.commit()
        invalidate_data_cache()
        invalidate_data_cache_prefixes("applications_by_iacuc")
        self.save(self.sheet(id="another", iacuc="Z2026002"))
        result = settlement.candidates(self.conn, ADMIN, {"month": "2026-10", "limit": 1, "offset": 0})
        self.assertEqual(result["page"]["total"], 2)
        self.assertTrue(result["page"]["hasMore"])
        searched = settlement.candidates(self.conn, ADMIN, {"month": "2026-10", "keyword": "Z2026001"})
        self.assertEqual(searched["items"][0]["totalAmount"], 600)

    def test_shared_claim_allocates_to_separate_fee_obligations_without_collision(self):
        self.save()
        result = self.start()
        with self.conn:
            feeding = {**result["statement"], "sourceType": "pi_merged_quantity_sheet", "totalAmount": 55}
            save_billing_statement_workflow(self.conn, feeding, [], ADMIN)
        obligations = list_obligations(self.conn, ADMIN, {})["items"]
        self.assertEqual({o["feeType"] for o in obligations}, {"feeding", "technical_service"})
        self.assertEqual(len({o["workflowId"] for o in obligations}), 2)
        claim = save_claim(
            self.conn,
            ADMIN,
            None,
            {
                "documentNumber": "SHARED-TS-FEED",
                "fundingLines": [{"fundBookNo": "F1", "fundingOwner": "纪老师", "reimbursementAmount": 355}],
            },
        )["item"]
        line = claim["fundingLines"][0]
        for obligation in obligations:
            allocation = create_allocation(
                self.conn,
                ADMIN,
                {
                    "claimId": claim["id"],
                    "fundingLineId": line["id"],
                    "obligationId": obligation["id"],
                    "amount": obligation["payableAmount"],
                },
            )["item"]
            confirm_allocation(self.conn, ADMIN, allocation["id"])
        items = list_obligations(self.conn, ADMIN, {})["items"]
        self.assertEqual(sum(o["allocatedAmount"] for o in items), 355)
        self.assertTrue(all(o["outstandingAmount"] == 0 for o in items))

    def test_shared_reimbursement_form_not_counted_twice(self):
        form = {"formNo": "F01", "fundingBookNo": "B01", "amount": 300}
        self.assertEqual(
            build_pi_reimbursement_context([{"reimbursementForms": [form]}, {"reimbursementForms": [form]}])[
                "reimbursementAmount"
            ],
            300,
        )


if __name__ == "__main__":
    unittest.main()
