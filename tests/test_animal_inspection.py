import json
import sqlite3
import unittest

from server_app.domains.animal_management import (
    catalog_payload,
    create_or_update_inspection,
    list_inspections,
    submit_inspection,
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

    def test_catalog_import_keeps_reference_modules_and_nodes(self):
        catalog = catalog_payload(self.conn, ACTOR)
        self.assertEqual(catalog["version"]["status"], "active")
        self.assertEqual(len(catalog["modules"]), 3)
        self.assertEqual(len(catalog["nodes"]), 245)
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
                        "score": 2,
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


if __name__ == "__main__":
    unittest.main()
