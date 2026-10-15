import copy
import json
import sqlite3
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from scripts.api_inventory import CATALOG, ROOT, ROUTING_SOURCES, expanded, render, routing_surface, validate


class ApiInventoryTests(unittest.TestCase):
    def setUp(self):
        self.catalog = json.loads(CATALOG.read_text())

    def test_current_catalog_is_complete_for_reviewed_routes_without_loading_a_database(self):
        with patch.object(sqlite3, "connect", side_effect=AssertionError("inventory must be static")):
            self.assertEqual(validate(self.catalog), [])
        routes = {(item["method"], item["path"]) for item in expanded(self.catalog)}
        self.assertIn(("POST", "/api/reimbursement-ledger/claims/{id}/allocations"), routes)
        self.assertIn(("GET", "/api/dashboard/overview"), routes)
        self.assertNotIn(("POST", "/api/reimbursement-ledger/allocations"), routes)

    def test_duplicate_endpoints_and_unknown_protection_are_rejected(self):
        modified = copy.deepcopy(self.catalog)
        entries = modified["groups"][0]["endpoints"]
        entries.append(copy.deepcopy(entries[0]))
        entries[0]["protection"] = "unreviewed"
        errors = validate(modified)
        self.assertTrue(any("重复接口" in message for message in errors))
        self.assertTrue(any("保护信息不完整" in message for message in errors))

    def test_metadata_must_include_permissions_payload_shapes_and_existing_caller_files(self):
        modified = copy.deepcopy(self.catalog)
        group = modified["groups"][0]
        group["clients"] = ["src/react/api/does-not-exist.ts"]
        entry = group["endpoints"][0]
        entry.update(permission="unknown", request="", response="", lifecycle="removed")
        errors = validate(modified)
        for expected in ("鉴权配置不存在", "缺少 request", "缺少 response", "调用模块不存在", "生命周期无效"):
            self.assertTrue(any(expected in message for message in errors), expected)

    def test_registered_and_fixed_paths_cannot_disappear_from_the_catalog(self):
        modified = copy.deepcopy(self.catalog)
        for group in modified["groups"]:
            group["endpoints"] = [entry for entry in group["endpoints"] if entry["path"] != "/api/health"]
        errors = validate(modified)
        self.assertTrue(any("注册表中的接口" in message for message in errors))
        self.assertTrue(any("路径或前缀未登记 /api/health" in message for message in errors))

    def test_route_review_fingerprints_ignore_comments_but_detect_changed_dynamic_conditions(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            for filename in ROUTING_SOURCES:
                target = root / filename
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_text((ROOT / filename).read_text())
            before = routing_surface(root)
            target = root / "server_app/web/technical_services.py"
            original = target.read_text()
            target.write_text(original + "\n# unrelated formatting comment\n")
            self.assertEqual(routing_surface(root), before)
            target.write_text(original.replace('parts == ["catalog"]', 'parts == ["new-catalog"]'))
            self.assertNotEqual(routing_surface(root), before)

    def test_stale_route_review_cannot_pass_validation(self):
        self.catalog["routingSurface"] = {}
        self.assertTrue(any("路由条件已变化" in message for message in validate(self.catalog)))

    def test_read_side_effects_and_legacy_version_boundaries_are_explicit(self):
        entries = {item["path"]: item for item in expanded(self.catalog)}
        self.assertEqual(entries["/api/reimbursement-ledger/obligations"]["protection"], "obligation_read")
        self.assertEqual(entries["/api/feedback/{id}"]["protection"], "cache_read")
        self.assertEqual(entries["/api/technical-services/sheets/{id}"]["protection"], "strict_edit")
        self.assertEqual(self.catalog["protections"]["compat_edit"]["effects"], "business_write")
        self.assertIn("缺省兼容", self.catalog["protections"]["compat_edit"]["version"])
        self.assertIn("原子CAS", self.catalog["protections"]["quantity_save"]["transaction"])

    def test_generated_reference_contains_every_method_path_and_is_deterministic(self):
        reference = render(self.catalog)
        for entry in expanded(self.catalog):
            self.assertIn(f"| {entry['method']} | `{entry['path']}` |", reference)
        self.assertIn("不替代实际HTTP", reference)
        self.assertEqual(render(self.catalog), reference)


if __name__ == "__main__":
    unittest.main()
