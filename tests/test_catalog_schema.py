import tempfile
import unittest
from pathlib import Path

from server_app.domains.animal_management.catalog_schema import (
    CatalogValidationError,
    catalog_errors,
    reference_image_filename,
    validate_catalog,
)


def module(code="basicAssessment", mid="1000023"):
    return {
        "id": mid,
        "code": code,
        "name": "基础评估",
        "version": 1,
        "sortOrder": 1,
        "status": 0,
    }


def node(
    code,
    node_type,
    parent_id=None,
    module_code="basicAssessment",
    module_id="1000023",
    input_type=None,
    config=None,
    **overrides,
):
    payload = {
        "id": code,
        "code": code,
        "moduleId": module_id,
        "moduleCode": module_code,
        "parentId": parent_id,
        "nodeType": node_type,
        "inputType": input_type,
        "name": f"条目 {code}",
        "sortOrder": 0,
        "config": config or {},
    }
    payload.update(overrides)
    return payload


def valid_catalog():
    category = node("basic_01", "CATEGORY", module_code="basicAssessment")
    subcategory = node("basic_01_01", "SUBCATEGORY", "basic_01", module_code="basicAssessment")
    item = node("basic_01_01_01", "ITEM", "basic_01_01", module_code="basicAssessment", input_type="score")
    return [module()], [category, subcategory, item]


class CatalogSchemaTests(unittest.TestCase):
    def test_valid_catalog_passes(self):
        modules, nodes = valid_catalog()
        self.assertEqual(catalog_errors(modules, nodes), [])
        self.assertTrue(validate_catalog(modules, nodes))

    def test_missing_modules_fails(self):
        self.assertNotEqual(catalog_errors([], [node("a", "CATEGORY")]), [])

    def test_duplicate_module_code_fails(self):
        self.assertIn("模块 code 重复", "; ".join(catalog_errors([module(), module()], [node("a", "CATEGORY")])))

    def test_node_code_must_be_unique(self):
        category = node("basic_01", "CATEGORY")
        duplicate = node("basic_01", "CATEGORY")
        errors = catalog_errors([module()], [category, duplicate])
        self.assertTrue(any("条目 code 重复" in error for error in errors))

    def test_unknown_module_fails(self):
        modules, nodes = valid_catalog()
        nodes[2]["moduleCode"] = "missingModule"
        self.assertTrue(any("不存在的模块" in error for error in catalog_errors(modules, nodes)))

    def test_module_id_mismatch_fails(self):
        modules, nodes = valid_catalog()
        nodes[2]["moduleId"] = "999999"
        self.assertTrue(any("moduleId" in error for error in catalog_errors(modules, nodes)))

    def test_missing_parent_fails_for_non_category(self):
        modules, nodes = valid_catalog()
        nodes[1]["parentId"] = None
        self.assertTrue(any("缺少 parentId" in error for error in catalog_errors(modules, nodes)))

    def test_unknown_parent_fails(self):
        modules, nodes = valid_catalog()
        nodes[2]["parentId"] = "missing-parent"
        self.assertTrue(any("不存在的父级" in error for error in catalog_errors(modules, nodes)))

    def test_parent_must_be_category_or_subcategory(self):
        modules, nodes = valid_catalog()
        nodes[1]["parentId"] = nodes[2]["code"]
        self.assertTrue(any("必须是分类或子分类" in error for error in catalog_errors(modules, nodes)))

    def test_parent_must_be_same_module(self):
        modules, nodes = valid_catalog()
        nodes[1]["moduleCode"] = "advancedAssessment"
        self.assertTrue(any("不属于同一模块" in error for error in catalog_errors(modules, nodes)))

    def test_parent_can_reference_node_id(self):
        modules, nodes = valid_catalog()
        nodes[1]["parentId"] = nodes[0]["id"]
        self.assertEqual(catalog_errors(modules, nodes), [])

    def test_self_reference_fails(self):
        modules, nodes = valid_catalog()
        nodes[0]["parentId"] = nodes[0]["id"]
        self.assertTrue(any("不能引用自身" in error for error in catalog_errors(modules, nodes)))

    def test_invalid_node_type_fails(self):
        modules, nodes = valid_catalog()
        nodes[2]["nodeType"] = "SECTION"
        self.assertTrue(any("nodeType 非法" in error for error in catalog_errors(modules, nodes)))

    def test_item_requires_input_type(self):
        modules, nodes = valid_catalog()
        nodes[2]["inputType"] = None
        self.assertTrue(any("缺少 inputType" in error for error in catalog_errors(modules, nodes)))

    def test_invalid_input_type_fails(self):
        modules, nodes = valid_catalog()
        nodes[2]["inputType"] = "text"
        self.assertTrue(any("inputType 非法" in error for error in catalog_errors(modules, nodes)))

    def test_category_rejects_input_type(self):
        modules, nodes = valid_catalog()
        nodes[0]["inputType"] = "score"
        self.assertTrue(any("不应设置 inputType" in error for error in catalog_errors(modules, nodes)))

    def test_negative_sort_order_fails(self):
        modules, nodes = valid_catalog()
        nodes[0]["sortOrder"] = -1
        self.assertTrue(any("sortOrder" in error for error in catalog_errors(modules, nodes)))

    def test_reference_images_are_checked_against_image_root(self):
        modules, nodes = valid_catalog()
        nodes[2]["config"] = {"referenceImages": [{"url": "/downloads/images/example.png"}]}
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            errors = catalog_errors(modules, nodes, image_root=root)
            self.assertTrue(any("参考图不存在" in error for error in errors))
            (root / "example.png").write_bytes(b"image")
            self.assertEqual(catalog_errors(modules, nodes, image_root=root), [])

    def test_reference_image_requires_url(self):
        modules, nodes = valid_catalog()
        nodes[2]["config"] = {"referenceImages": [{"desc": "no url"}]}
        self.assertTrue(any("缺少 url" in error for error in catalog_errors(modules, nodes)))

    def test_reference_image_filename_validation(self):
        self.assertEqual(reference_image_filename("/downloads/images/diarrhea.jpg"), "diarrhea.jpg")
        self.assertEqual(reference_image_filename(""), "")
        self.assertEqual(reference_image_filename("../escape.png"), "")

    def test_validate_catalog_raises_structured_error(self):
        modules, nodes = valid_catalog()
        nodes[0]["code"] = ""
        with self.assertRaises(CatalogValidationError) as ctx:
            validate_catalog(modules, nodes)
        self.assertTrue(isinstance(ctx.exception.errors, list))


if __name__ == "__main__":
    unittest.main()
