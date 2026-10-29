import json
import sqlite3
import unittest

from server_app.domains.animal_management import (
    catalog_payload,
    create_or_update_inspection,
    list_findings,
    list_inspections,
    resolve_finding,
    submit_inspection,
    update_finding,
)
from server_app.domains.animal_management.catalog_payload import prepare_catalog_payload
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
