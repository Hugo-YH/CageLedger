import json
import sqlite3
import unittest

from server_app.domains.animal_management import (
    catalog_payload,
    create_or_update_inspection,
    get_inspection,
    list_findings,
    list_inspections,
    resolve_finding,
    submit_inspection,
    update_finding,
)
from server_app.domains.animal_management.catalog_payload import prepare_catalog_payload
from server_app.domains.animal_management.inspection_repository import (
    _finding_payload,
    _finding_payloads,
    _insert_finding_event,
    _upsert_finding,
)
from server_app.legacy import initialize_schema

ACTOR = {"id": "admin", "username": "admin", "displayName": "系统管理员", "role": "admin", "roomIds": []}


class AnimalInspectionServiceTests(unittest.TestCase):
    def setUp(self):
        self.conn = sqlite3.connect(":memory:")
        self.conn.row_factory = sqlite3.Row
        self.conn.execute("PRAGMA foreign_keys=ON")
        initialize_schema(self.conn)
        room = {"id": "room-1", "name": "测试饲养间", "facility": "测试设施"}
        self.conn.execute(
            "INSERT INTO rooms (id, name, area, rack_count, rows, cols, payload) VALUES (?, ?, ?, ?, ?, ?, ?)",
            ("room-1", "测试饲养间", "测试设施", 0, 0, 0, json.dumps(room, ensure_ascii=False)),
        )
        self.conn.commit()

    def tearDown(self):
        self.conn.close()

    def seed_many_findings(self, count):
        saved = create_or_update_inspection(
            self.conn,
            ACTOR,
            None,
            {
                "roomId": "room-1",
                "moduleCodes": ["abnormalAnimalAssessment"],
                "answers": [
                    {"moduleCode": "abnormalAnimalAssessment", "nodeCode": "abnormal_07_02_01", "outcome": "abnormal"}
                ],
            },
        )
        prototype = submit_inspection(self.conn, ACTOR, saved["item"]["id"])["findings"][0]
        self.conn.execute("DELETE FROM animal_inspection_finding_events")
        self.conn.execute("DELETE FROM animal_inspection_findings")
        for index in range(count):
            finding_id = f"synthetic-finding-{index:04}"
            _upsert_finding(
                self.conn, {**prototype, "id": finding_id, "nodeCode": f"synthetic-{index}", "updatedAt": "2026-10-30"}
            )
            if index < 2:
                for number in (2, 1):
                    _insert_finding_event(
                        self.conn, finding_id, "updated", f"合成事件{number}", ACTOR, f"2026-10-0{number}"
                    )
                    self.conn.execute(
                        "INSERT INTO animal_inspection_attachments VALUES (?,?,?,?,?,?,?,?,?,?)",
                        (
                            f"photo-{index}-{number}",
                            saved["item"]["id"],
                            finding_id,
                            "synthetic.png",
                            "x",
                            "image/png",
                            1,
                            "admin",
                            f"2026-10-0{number}",
                            "{}",
                        ),
                    )
        self.conn.commit()
        return saved["item"]["id"]

    def test_full_finding_reads_batch_related_data_and_preserve_detail_and_permissions(self):
        inspection_id = self.seed_many_findings(25)
        expected = [
            _finding_payload(self.conn, row)
            for row in self.conn.execute("SELECT * FROM animal_inspection_findings ORDER BY id")
        ]
        before = self.conn.total_changes
        statements = []
        self.conn.set_trace_callback(statements.append)
        actual = list_findings(self.conn, ACTOR, {"limit": 50})["items"]
        self.conn.set_trace_callback(None)
        self.assertEqual(actual, expected)
        self.assertEqual(len(statements), 5)
        self.assertEqual(get_inspection(self.conn, ACTOR, inspection_id)["findings"], expected)
        self.assertEqual([event["note"] for event in actual[0]["events"]], ["合成事件1", "合成事件2"])
        self.assertEqual(self.conn.total_changes, before)
        stranger = {"id": "other", "role": "user", "roomIds": []}
        self.assertEqual(list_findings(self.conn, stranger, {"limit": 50})["items"], [])
        with self.assertRaises(PermissionError):
            get_inspection(self.conn, stranger, inspection_id)

    def test_tied_finding_pages_are_stable_and_bulk_parameters_are_bounded(self):
        self.seed_many_findings(401)
        rows = self.conn.execute("SELECT * FROM animal_inspection_findings ORDER BY id").fetchall()
        statements = []
        self.conn.set_trace_callback(statements.append)
        bulk = _finding_payloads(self.conn, rows)
        self.conn.set_trace_callback(None)
        self.assertEqual(len(bulk), 401)
        self.assertEqual(len(statements), 5)
        self.assertEqual(bulk[0], _finding_payload(self.conn, rows[0]))
        self.assertEqual(bulk[-1], _finding_payload(self.conn, rows[-1]))
        ids = []
        for offset in range(0, 401, 100):
            full = list_findings(self.conn, ACTOR, {"limit": 100, "offset": offset})
            summary = list_findings(self.conn, ACTOR, {"limit": 100, "offset": offset, "view": "summary"})
            self.assertEqual([item["id"] for item in full["items"]], [item["id"] for item in summary["items"]])
            ids.extend(item["id"] for item in full["items"])
        self.assertEqual(ids, sorted(row["id"] for row in rows))
        self.assertEqual(len(set(ids)), 401)

    def test_summary_lists_are_equivalent_bounded_and_read_only(self):
        for index in range(80):
            saved = create_or_update_inspection(
                self.conn,
                ACTOR,
                None,
                {
                    "roomId": "room-1",
                    "moduleCodes": ["abnormalAnimalAssessment"],
                    "answers": [
                        {
                            "moduleCode": "abnormalAnimalAssessment",
                            "nodeCode": "abnormal_07_02_01",
                            "outcome": "abnormal",
                        }
                    ],
                },
            )
            if index < 40:
                submitted = submit_inspection(self.conn, ACTOR, saved["item"]["id"])
                if index == 0:
                    finding_id = submitted["findings"][0]["id"]
                    for _ in range(2):
                        update_finding(self.conn, ACTOR, finding_id, {"actionNote": "处置"})
                    for number in range(2):
                        self.conn.execute(
                            "INSERT INTO animal_inspection_attachments VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                            (
                                f"photo-{number}",
                                saved["item"]["id"],
                                finding_id,
                                "photo.png",
                                "x",
                                "image/png",
                                1,
                                "admin",
                                "2026-01-01",
                                "{}",
                            ),
                        )
        before = {
            table: [tuple(row) for row in self.conn.execute(f"SELECT * FROM {table} ORDER BY rowid")]
            for table in ("audit_events", "audit_logs")
        }
        for operation in (list_inspections, list_findings):
            counts = []
            for limit in (20, 40):
                statements = []
                self.conn.set_trace_callback(statements.append)
                summary = operation(self.conn, ACTOR, {"limit": limit, "view": "summary"})
                self.conn.set_trace_callback(None)
                counts.append(len(statements))
                full = operation(self.conn, ACTOR, {"limit": limit})
                self.assertEqual(summary["page"], full["page"])
                for small, original in zip(summary["items"], full["items"], strict=False):
                    self.assertEqual(small, {key: original[key] for key in small})
                    self.assertFalse({"snapshot", "answers", "attachments", "events"} & small.keys())
                stranger = {"id": "other", "role": "user", "roomIds": []}
                self.assertEqual(operation(self.conn, stranger, {"view": "summary"})["page"]["total"], 0)
                allowed = {"id": "other", "role": "user", "roomIds": ["room-1"]}
                self.assertEqual(
                    operation(self.conn, allowed, {"view": "summary"})["page"]["total"], full["page"]["total"]
                )
            self.assertEqual(counts, [5, 5] if operation == list_inspections else [2, 2])
        for table, rows in before.items():
            self.assertEqual(rows, [tuple(row) for row in self.conn.execute(f"SELECT * FROM {table} ORDER BY rowid")])
        full_findings = list_findings(self.conn, ACTOR, {"limit": 100})["items"]
        detailed = next(item for item in full_findings if item["id"] == finding_id)
        self.assertEqual(len(detailed["attachments"]), 2)
        self.assertGreaterEqual(len(detailed["events"]), 2)
        resolved = resolve_finding(self.conn, ACTOR, finding_id, {"conclusion": "已完成"})
        self.assertEqual(resolved["item"]["status"], "resolved")
        self.assertEqual(len(resolved["item"]["attachments"]), 2)

    def test_catalog_import_keeps_reference_modules_and_nodes(self):
        catalog = catalog_payload(self.conn, ACTOR)
        self.assertEqual(catalog["version"]["status"], "active")
        self.assertEqual(len(catalog["modules"]), 3)
        self.assertEqual(len(catalog["nodes"]), 233)
        self.assertTrue(all(node["moduleCode"] for node in catalog["nodes"]))

    def test_catalog_reuses_same_module_same_name_reference_images(self):
        catalog = prepare_catalog_payload(
            {
                "nodes": [
                    {
                        "moduleCode": "abnormalAnimalAssessment",
                        "name": "被毛油腻",
                        "config": {"referenceImages": [{"url": "/images/greasy-coat.png"}]},
                    },
                    {
                        "moduleCode": "abnormalAnimalAssessment",
                        "name": "被毛油腻",
                        "config": {},
                    },
                    {
                        "moduleCode": "basicAssessment",
                        "name": "被毛油腻",
                        "config": {},
                    },
                ]
            }
        )
        exact, inherited, other_module = catalog["nodes"]
        self.assertEqual(exact["config"]["referenceOrigin"], "exact")
        self.assertEqual(inherited["config"]["referenceOrigin"], "same_name")
        self.assertEqual(
            inherited["config"]["referenceImages"][0]["url"],
            "/api/animal-inspection-reference/greasy-coat.png",
        )
        self.assertNotIn("referenceImages", other_module["config"])

    def test_abnormal_submission_creates_finding_and_locks_record(self):
        saved = create_or_update_inspection(
            self.conn,
            ACTOR,
            None,
            {
                "roomId": "room-1",
                "moduleCodes": ["abnormalAnimalAssessment"],
                "answers": [
                    {
                        "moduleCode": "abnormalAnimalAssessment",
                        "nodeCode": "abnormal_07_02_01",
                        "outcome": "abnormal",
                        "note": "测试异常",
                        "rackHint": "8101-01",
                        "cageNumber": "B12",
                    }
                ],
            },
        )
        submitted = submit_inspection(self.conn, ACTOR, saved["item"]["id"])
        self.assertEqual(submitted["item"]["status"], "submitted")
        self.assertEqual(len(submitted["findings"]), 1)
        self.assertEqual(submitted["findings"][0]["status"], "pending")
        self.assertEqual(submitted["findings"][0]["rackHint"], "8101-01")
        self.assertEqual(submitted["findings"][0]["cageNumber"], "B12")
        with self.assertRaises(ValueError):
            create_or_update_inspection(self.conn, ACTOR, saved["item"]["id"], {"roomId": "room-1"})
        listed = list_inspections(self.conn, ACTOR, {"limit": 20, "offset": 0})
        self.assertEqual(listed["page"]["total"], 1)

    def test_legacy_scores_and_binary_outcomes_share_the_same_abnormal_path(self):
        saved = create_or_update_inspection(
            self.conn,
            ACTOR,
            None,
            {
                "roomId": "room-1",
                "moduleCodes": ["abnormalAnimalAssessment"],
                "answers": [
                    {"moduleCode": "abnormalAnimalAssessment", "nodeCode": "abnormal_07_02_01", "score": 1},
                    {"moduleCode": "abnormalAnimalAssessment", "nodeCode": "abnormal_07_02_02", "outcome": "normal"},
                ],
            },
        )
        submitted = submit_inspection(self.conn, ACTOR, saved["item"]["id"])
        self.assertEqual(len(submitted["findings"]), 1)
        detail = self.conn.execute(
            "SELECT payload FROM animal_inspection_answers WHERE inspection_id = ? ORDER BY node_code",
            (saved["item"]["id"],),
        ).fetchall()
        self.assertEqual(json.loads(detail[0]["payload"])["outcome"], "abnormal")
        self.assertEqual(json.loads(detail[1]["payload"])["outcome"], "normal")


if __name__ == "__main__":
    unittest.main()
