#!/usr/bin/env python3
"""Review the API catalog and generate its developer-facing reference; never open a database."""

import argparse
import ast
import hashlib
import json
import re
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CATALOG = ROOT / "docs/contracts/api-inventory.json"
REFERENCE = ROOT / "wiki/API接口清单.md"
ROUTING_SOURCES = (
    "server_app/web/router.py",
    "server_app/web/router_registry.py",
    "server_app/web/route_registration.py",
    "server_app/web/route_specs.py",
    "server_app/web/read_routes.py",
    "server_app/web/write_routes.py",
    "server_app/web/entity_contracts.py",
    "server_app/web/route_matchers.py",
    "server_app/web/technical_services.py",
    "server_app/web/data_quality.py",
    "server_app/web/system_features.py",
    "server_app/web/feedback.py",
    "server_app/web/quarantine.py",
    "server_app/web/animal_inspection.py",
    "server_app/web/settlement_candidates.py",
    "server_app/web/intake_summary.py",
    "server_app/web/pdf_exports.py",
    "server_app/repositories/filter_options.py",
    *tuple(str(path.relative_to(ROOT)) for path in sorted((ROOT / "server_app/web/route_definitions").glob("*.py"))),
)
METHODS = {"GET", "POST", "PUT", "DELETE", "PATCH"}
EFFECTS = {
    "read",
    "derived_write",
    "business_sync",
    "remote_read",
    "file_cache",
    "session_write",
    "metadata_write",
    "business_write",
    "conditional_write",
    "file_and_business_write",
    "export_audit",
}


def tree(root, filename):
    return ast.parse((root / filename).read_text(), filename=filename)


def routing_surface(root=ROOT):
    """Guard reviewed route conditions, registrations and pure matcher bodies, not entire source files."""
    result = {}
    names = {"path", "parts", "method", "endpoint", "list_name", "action"}
    for filename in ROUTING_SOURCES:
        syntax = tree(root, filename)
        surface = []
        for node in ast.walk(syntax):
            if isinstance(node, ast.Constant) and isinstance(node.value, str) and node.value.startswith("/api/"):
                surface.append(["path", node.value])
            elif isinstance(node, ast.If) and any(
                isinstance(item, ast.Name) and item.id in names for item in ast.walk(node.test)
            ):
                surface.append(["condition", ast.dump(node.test, include_attributes=False)])
            elif (
                isinstance(node, ast.Call)
                and isinstance(node.func, ast.Attribute)
                and node.func.attr in {"add", "add_handled"}
            ):
                surface.append(["registration", ast.dump(node, include_attributes=False)])
            elif filename.startswith("server_app/web/route_definitions/") and isinstance(node, ast.Assign):
                surface.append(["declarations", ast.dump(node, include_attributes=False)])
            elif filename.endswith(("/route_registration.py", "/route_specs.py", "/router.py")) and isinstance(
                node, ast.FunctionDef | ast.ImportFrom
            ):
                surface.append(["dispatcher", ast.dump(node, include_attributes=False)])
            elif isinstance(node, ast.FunctionDef) and (
                node.name.endswith("_route") or node.name in {"_between", "_after_prefix", "_single_segment"}
            ):
                surface.append(["matcher", ast.dump(node, include_attributes=False)])
        result[filename] = hashlib.sha256(json.dumps(surface, ensure_ascii=False).encode()).hexdigest()
    return result


def normalized_path(value):
    return re.sub(r"\(\?P<(\w+)>[^)]*\)", lambda match: "{" + match[1] + "}", value)


def primary_boundary(method, path, registered):
    return registered.get((method, path), "server_app/web/router_registry.py")


def read_action_boundary(action, root=ROOT):
    """Resolve the explicit read-action mixin statically, without importing the application."""
    filename = "server_app/web/read_actions.py"
    syntax = tree(root, filename)
    composition = next(
        node for node in syntax.body if isinstance(node, ast.ClassDef) and node.name == "ReadActionsMixin"
    )
    if any(isinstance(node, ast.FunctionDef) and node.name == action for node in composition.body):
        return f"{filename}:{action}"
    imports = {
        alias.asname or alias.name: (node.module, alias.name)
        for node in syntax.body
        if isinstance(node, ast.ImportFrom) and node.level == 1
        for alias in node.names
    }
    owners = []
    for base in composition.bases:
        if not isinstance(base, ast.Name) or base.id not in imports:
            raise ValueError(f"未支持的GET组合入口: {ast.unparse(base)}")
        module, name = imports[base.id]
        target = f"server_app/web/{module}.py"
        owner = next(node for node in tree(root, target).body if isinstance(node, ast.ClassDef) and node.name == name)
        if any(isinstance(node, ast.FunctionDef) and node.name == action for node in owner.body):
            owners.append(f"{target}:{action}")
    if len(owners) != 1:
        raise ValueError(f"GET动作必须有唯一实现: {action} ({len(owners)})")
    return owners[0]


def registered_routes(root=ROOT):
    registered = {
        (node.args[0].value, normalized_path(node.args[1].value)): "server_app/web/router_registry.py"
        for node in ast.walk(tree(root, "server_app/web/router_registry.py"))
        if isinstance(node, ast.Call)
        and isinstance(node.func, ast.Attribute)
        and node.func.attr == "add"
        and len(node.args) >= 2
        and all(isinstance(arg, ast.Constant) for arg in node.args[:2])
    }
    for filename in ROUTING_SOURCES:
        if not filename.startswith("server_app/web/route_definitions/"):
            continue
        for node in tree(root, filename).body:
            if not isinstance(node, ast.Assign):
                continue
            for specs in ast.literal_eval(node.value).values():
                for spec in specs:
                    if name := spec.get("delegate"):
                        boundary = (
                            "server_app/repositories/filter_options.py:route_column_filter_options"
                            if name == "filter_options"
                            else f"server_app/web/{name}.py:{'handle_get' if name == 'animal_inspection' else 'handle'}"
                        )
                    else:
                        boundary = (
                            read_action_boundary(spec["action"], root)
                            if spec["method"] == "GET"
                            else f"server_app/web/write_actions.py:{spec['action']}"
                        )
                    for path in spec["paths"]:
                        identity = spec["method"], path
                        if identity in registered:
                            raise ValueError(f"重复路由登记: {identity}")
                        registered[identity] = boundary
    return registered


def expanded(catalog, root=ROOT):
    registered = registered_routes(root)
    return [
        {
            "domain": group["id"],
            "title": group["title"],
            "permission": group["permission"],
            "lifecycle": group["lifecycle"],
            "clients": group["clients"],
            **entry,
            "boundary": primary_boundary(entry["method"], entry["path"], registered),
        }
        for group in catalog["groups"]
        for entry in group["endpoints"]
    ]


def validate(catalog, root=ROOT):
    errors = []
    if catalog.get("schemaVersion") != 1:
        return ["接口清单schemaVersion不支持"]
    entries = expanded(catalog, root)
    identities = set()
    for item in entries:
        label = f"{item.get('method')} {item.get('path')}"
        for key in ("purpose", "request", "response", "domain", "title"):
            if not isinstance(item.get(key), str) or not item[key].strip():
                errors.append(f"{label}: 缺少 {key}")
        if item["method"] not in METHODS or not re.fullmatch(r"/api/[^?#\s]+", item["path"]):
            errors.append(f"{label}: 方法或路径无效")
        if "undefined" in item["path"] or re.search(r"\{(?![A-Za-z][A-Za-z0-9]*\})", item["path"]):
            errors.append(f"{label}: 路径模板无效")
        identity = item["method"], item["path"]
        if identity in identities:
            errors.append(f"{label}: 重复接口")
        identities.add(identity)
        if item["permission"] not in catalog["permissions"]:
            errors.append(f"{label}: 鉴权配置不存在")
        if item["lifecycle"] not in {"supported", "compatibility"}:
            errors.append(f"{label}: 生命周期无效")
        protection = catalog["protections"].get(item["protection"], {})
        if any(not protection.get(key) for key in ("version", "idempotency", "transaction", "audit", "effects")):
            errors.append(f"{label}: 写入保护信息不完整")
        if protection.get("effects") not in EFFECTS:
            errors.append(f"{label}: 读写属性无效")
        for filename in item["clients"]:
            if not (root / filename).is_file():
                errors.append(f"{label}: 调用模块不存在 {filename}")
        filename, _, function = item["boundary"].partition(":")
        if (
            not (root / filename).is_file()
            or function
            and not any(
                isinstance(node, ast.FunctionDef) and node.name == function for node in ast.walk(tree(root, filename))
            )
        ):
            errors.append(f"{label}: HTTP入口不存在 {item['boundary']}")
    registered = registered_routes(root)
    if not registered.keys() <= identities:
        errors.append("注册表中的接口未全部登记")
    if not identities <= registered.keys():
        errors.append("清单中的接口未全部注册到共用路由")
    paths = {entry["path"] for entry in entries}
    for filename in ROUTING_SOURCES:
        for node in ast.walk(tree(root, filename)):
            if isinstance(node, ast.Constant) and isinstance(node.value, str) and node.value.startswith("/api/"):
                path = normalized_path(node.value)
                covered = path in paths if not path.endswith("/") else any(value.startswith(path) for value in paths)
                if not covered:
                    errors.append(f"{filename}: 路径或前缀未登记 {path}")
    if catalog.get("routingSurface") != routing_surface(root):
        errors.append("路由条件已变化：先逐项复核清单，再使用 --refresh-routing-surface 更新复核指纹")
    return sorted(set(errors))


def cell(value):
    return str(value).replace("|", "\\|").replace("\n", " ")


def render(catalog):
    entries = expanded(catalog)
    lines = [
        "# API接口清单",
        "",
        "<!-- Generated by scripts/api_inventory.py; edit docs/contracts/api-inventory.json. -->",
        "",
        f"当前登记 **{len(entries)}** 个“HTTP方法＋路径”组合，范围为业务 `/api`，公共OPTIONS及静态资源不计入。",
        "",
        "本页由仓库的 `docs/contracts/api-inventory.json` 生成。字段为摘要，完整业务规则和类型见 [[API与数据模型]] 及仓库API契约。",
        "",
        "`supported` 表示当前支持，`compatibility` 表示保留兼容；两者均不能直接作为删除依据。调用方列是仓库静态入口线索，不证明外部客户端已全部盘点。",
        "",
        "清单按当前实现人工复核。检查器校验元数据、文件/函数引用、注册表覆盖、固定路径/前缀覆盖及路由条件漂移；不替代实际HTTP权限、参数、幂等及业务测试。",
        "",
        "维护命令：`npm run api:inventory` 重新生成本页；`npm run check:api` 只检查。路由条件变化后，须先复核接口与保护信息，再显式运行 `node scripts/run_python.mjs scripts/api_inventory.py --refresh-routing-surface --write`。",
        "",
        "## 鉴权代号",
        "",
        "| 代号 | 现有权限 |",
        "| --- | --- |",
        *[f"| `{key}` | {cell(value)} |" for key, value in catalog["permissions"].items()],
        "",
        "## 接口目录",
        "",
    ]
    for group in catalog["groups"]:
        lines += [
            f"### {group['title']}",
            "",
            "调用模块线索：" + "、".join(f"`{p}`" for p in group["clients"]) + "。",
            "",
            "| 方法 | 路径 | 用途／生命周期 | 鉴权 | 请求 → 响应 | 保护／读写属性 | HTTP入口 |",
            "| --- | --- | --- | --- | --- | --- | --- |",
        ]
        for item in (entry for entry in entries if entry["domain"] == group["id"]):
            protection = catalog["protections"][item["protection"]]
            lines.append(
                "| "
                + " | ".join(
                    cell(value)
                    for value in (
                        item["method"],
                        f"`{item['path']}`",
                        f"{item['purpose']} / {item['lifecycle']}",
                        f"`{item['permission']}`",
                        f"{item['request']} → {item['response']}",
                        f"[{item['protection']}](#{item['protection'].replace('_', '-')}) / `{protection['effects']}`",
                        f"`{item['boundary']}`",
                    )
                )
                + " |"
            )
        lines.append("")
        for item in (entry for entry in entries if entry["domain"] == group["id"] and entry.get("notes")):
            lines += [f"`{item['method']} {item['path']}`：{item['notes']}", ""]
    lines += [
        "## 保护与副作用说明",
        "",
        "缺省版本兼容、精确必填版本、状态动作、幂等请求和资金校验各有适用入口；本清单记录现状，不自动收紧旧接口。",
        "",
    ]
    for key, profile in catalog["protections"].items():
        lines += [
            f"### {key.replace('_', '-')}",
            "",
            *[
                f"- {label}：{profile[field]}。"
                for field, label in (
                    ("version", "版本"),
                    ("idempotency", "重放"),
                    ("transaction", "事务"),
                    ("audit", "审计"),
                    ("effects", "读写属性"),
                )
            ],
            "",
        ]
    return "\n".join(lines)


def formatted(text):
    return subprocess.run(
        [str(ROOT / "node_modules/.bin/prettier"), "--parser", "markdown"],
        input=text,
        text=True,
        capture_output=True,
        check=True,
        cwd=ROOT,
    ).stdout


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument("--write", action="store_true")
    mode.add_argument("--check", action="store_true")
    parser.add_argument("--refresh-routing-surface", action="store_true", help="完成接口逐项复核后显式更新路由条件指纹")
    args = parser.parse_args()
    catalog = json.loads(CATALOG.read_text())
    if args.refresh_routing_surface:
        catalog["routingSurface"] = routing_surface()
    errors = validate(catalog)
    if errors:
        parser.exit(1, "\n".join(errors) + "\n")
    reference = formatted(render(catalog))
    if args.write:
        if args.refresh_routing_surface:
            CATALOG.write_text(json.dumps(catalog, ensure_ascii=False, indent=2) + "\n")
        REFERENCE.write_text(reference)
    elif args.refresh_routing_surface:
        parser.error("更新复核指纹需同时使用 --write")
    elif not REFERENCE.is_file() or REFERENCE.read_text() != reference:
        parser.exit(1, "接口参考页与清单不一致，请运行 npm run api:inventory\n")
    print(f"API inventory: {len(expanded(catalog))} endpoints; metadata and route review checks passed.")


if __name__ == "__main__":
    main()
