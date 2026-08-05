"""Explicit schema validation for the versioned animal inspection catalog.

This module is pure input validation: it has no database, network, or file I/O
dependencies and can be unit-tested without any external service. File-backed
checks (reference image existence) are optional and receive the image root as a
parameter so the caller decides which storage layer to verify.
"""

from pathlib import Path

NODE_TYPES = ("CATEGORY", "SUBCATEGORY", "ITEM")
INPUT_TYPES = ("score", "severity", "severity_with_options")
PARENT_NODE_TYPES = ("CATEGORY", "SUBCATEGORY")


class CatalogValidationError(ValueError):
    """Raised when a catalog draft fails schema validation."""

    def __init__(self, errors):
        self.errors = list(errors)
        super().__init__("; ".join(self.errors))


def catalog_errors(modules, nodes, image_root=None):
    """Return a list of validation error messages; empty means the catalog is valid."""
    errors = []
    module_codes = _module_errors(modules, errors)
    _node_errors(modules, module_codes, nodes, errors)
    _reference_image_errors(nodes, image_root, errors)
    return errors


def validate_catalog(modules, nodes, image_root=None):
    """Validate a catalog draft and raise CatalogValidationError on any problem."""
    errors = catalog_errors(modules, nodes, image_root=image_root)
    if errors:
        raise CatalogValidationError(errors)
    return True


def _module_errors(modules, errors):
    module_codes = {}
    if not isinstance(modules, list) or not modules:
        errors.append("modules 必须是非空数组")
        return module_codes
    for index, module in enumerate(modules):
        if not isinstance(module, dict):
            errors.append(f"modules[{index}] 必须是对象")
            continue
        code = _text(module.get("code"))
        if not code:
            errors.append(f"modules[{index}] 缺少 code")
            continue
        if not _text(module.get("id")):
            errors.append(f"模块 {code} 缺少 id")
        if code in module_codes:
            errors.append(f"模块 code 重复：{code}")
            continue
        module_codes[code] = module
    return module_codes


def _node_errors(modules, module_codes, nodes, errors):
    if not isinstance(nodes, list) or not nodes:
        errors.append("nodes 必须是非空数组")
        return
    seen_codes = set()
    for index, node in enumerate(nodes):
        if not isinstance(node, dict):
            errors.append(f"nodes[{index}] 必须是对象")
            continue
        code = _text(node.get("code"))
        if not code:
            errors.append(f"nodes[{index}] 缺少 code")
            continue
        if code in seen_codes:
            errors.append(f"条目 code 重复：{code}")
            continue
        seen_codes.add(code)
    by_code = {}
    by_id = {}
    for node in nodes:
        if not isinstance(node, dict):
            continue
        code = _text(node.get("code"))
        if code:
            by_code[code] = node
        node_id = _text(node.get("id"))
        if node_id:
            by_id[node_id] = node

    for node in nodes:
        if not isinstance(node, dict):
            continue
        code = _text(node.get("code"))
        if not code:
            continue
        module_code = _text(node.get("moduleCode"))
        if not module_code:
            errors.append(f"条目 {code} 缺少 moduleCode")
        elif module_code not in module_codes:
            errors.append(f"条目 {code} 引用了不存在的模块 {module_code}")
        elif node.get("moduleId") and _text(node.get("moduleId")) != _text(module_codes[module_code].get("id")):
            errors.append(f"条目 {code} 的 moduleId 与模块 {module_code} 不一致")

        node_type = _text(node.get("nodeType"))
        if node_type not in NODE_TYPES:
            errors.append(f"条目 {code} 的 nodeType 非法：{node_type or '空'}")

        input_type = _text(node.get("inputType") or "")
        if input_type and input_type not in INPUT_TYPES:
            errors.append(f"条目 {code} 的 inputType 非法：{input_type}")
        if node_type == "ITEM" and not input_type:
            errors.append(f"条目 {code} 是 ITEM 但缺少 inputType")
        if node_type in ("CATEGORY", "SUBCATEGORY") and input_type:
            errors.append(f"条目 {code} 是 {node_type} 不应设置 inputType")

        if not _text(node.get("name")):
            errors.append(f"条目 {code} 缺少 name")
        sort_order = node.get("sortOrder", 0)
        if not _is_int(sort_order) or sort_order < 0:
            errors.append(f"条目 {code} 的 sortOrder 必须是非负整数")

        parent_id = _text(node.get("parentId") or "")
        if node_type != "CATEGORY" and not parent_id:
            errors.append(f"条目 {code} 是 {node_type} 但缺少 parentId")
        if parent_id:
            parent = by_code.get(parent_id) or by_id.get(parent_id)
            if parent is None:
                errors.append(f"条目 {code} 引用了不存在的父级 {parent_id}")
            elif parent.get("nodeType") not in PARENT_NODE_TYPES:
                errors.append(f"条目 {code} 的父级 {parent_id} 必须是分类或子分类")
            elif parent_id == code or parent_id == _text(node.get("id")):
                errors.append(f"条目 {code} 不能引用自身作为父级")
            elif _text(parent.get("moduleCode")) != module_code:
                errors.append(f"条目 {code} 的父级 {parent_id} 不属于同一模块")

        config = node.get("config")
        if config is not None and not isinstance(config, dict):
            errors.append(f"条目 {code} 的 config 必须是对象")


def _reference_image_errors(nodes, image_root, errors):
    root = Path(image_root).resolve() if image_root is not None else None
    for node in nodes:
        if not isinstance(node, dict):
            continue
        config = node.get("config") or {}
        images = config.get("referenceImages") if isinstance(config, dict) else None
        if not images:
            continue
        if not isinstance(images, list):
            errors.append(f"条目 {node.get('code')} 的 referenceImages 必须是数组")
            continue
        for image in images:
            if not isinstance(image, dict) or not _text(image.get("url")):
                errors.append(f"条目 {node.get('code')} 的 referenceImages 条目缺少 url")
                continue
            filename = reference_image_filename(image.get("url"))
            if not filename:
                errors.append(f"条目 {node.get('code')} 的参考图 url 无法解析文件名")
            elif root is not None and not (root / filename).is_file():
                errors.append(f"条目 {node.get('code')} 的参考图不存在：{filename}")


def reference_image_filename(url):
    """Extract the safe filename from a reference image url ('' when invalid)."""
    value = _text(url)
    if not value:
        return ""
    if ".." in value.split("/"):
        return ""
    filename = value.rsplit("/", 1)[-1]
    if not filename or "/" in filename or "\\" in filename or filename in {".", ".."}:
        return ""
    return filename


def _text(value):
    if value is None:
        return ""
    return str(value).strip()


def _is_int(value):
    return isinstance(value, int) and not isinstance(value, bool)
