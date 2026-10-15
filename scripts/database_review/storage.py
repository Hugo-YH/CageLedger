"""Read-only input inspection and private output helpers; no application imports."""

import hashlib
import json
import os
import sqlite3
from base64 import b64encode
from contextlib import closing
from pathlib import Path


def digest(value):
    def encode(item):
        if isinstance(item, bytes):
            return {"type": "bytes", "value": b64encode(item).decode()}
        if hasattr(item, "isoformat"):
            return {"type": type(item).__name__, "value": item.isoformat()}
        raise TypeError(f"不能比较的类型: {type(item).__name__}")

    body = json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"), allow_nan=False, default=encode)
    return hashlib.sha256(body.encode()).hexdigest()


def write_json(path, value):
    with Path(path).open("x", encoding="utf-8") as stream:
        os.chmod(path, 0o600)
        json.dump(value, stream, ensure_ascii=False, indent=2, allow_nan=False)
        stream.write("\n")


def fingerprint(source):
    result = {}
    for suffix in ("", "-wal", "-shm", "-journal"):
        path = Path(str(source) + suffix)
        if path.exists():
            with path.open("rb") as stream:
                result[suffix or "main"] = {
                    "bytes": path.stat().st_size,
                    "sha256": hashlib.file_digest(stream, "sha256").hexdigest(),
                }
        else:
            result[suffix or "main"] = None
    return result


def offline_input(source):
    source = Path(source).resolve(strict=True)
    if not source.is_file():
        raise ValueError("输入必须是完整离线SQLite备份")
    before = fingerprint(source)
    if any(before[suffix] and before[suffix]["bytes"] for suffix in ("-wal", "-journal")):
        raise ValueError("存在非空WAL或journal；请先生成一致的完整离线备份，不能忽略伴随文件")
    return source, before


def immutable_connection(source):
    conn = sqlite3.connect(Path(source).as_uri() + "?mode=ro&immutable=1", uri=True)
    conn.row_factory = sqlite3.Row
    return conn


def quote(value):
    return '"' + value.replace('"', '""') + '"'


def table_rows(conn, name, spec):
    # Primary keys survive additive migrations; rowid is only a fallback for
    # tables whose original schema has no primary key.
    columns = spec["columns"]
    selected = ",".join(quote(column) for column in columns)
    prefix = "rowid," if not spec["keys"] else ""
    for row in conn.execute(f"SELECT {prefix}{selected} FROM {quote(name)}"):
        values = tuple(row[column] for column in columns)
        identity = tuple(row[column] for column in spec["keys"]) if spec["keys"] else (row[0],)
        yield digest(identity), values, dict(zip(columns, values, strict=True))


def source_scope(conn):
    scope = {}
    for (name,) in conn.execute("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'"):
        info = conn.execute(f"PRAGMA table_info({quote(name)})").fetchall()
        spec = {
            "columns": [row[1] for row in info],
            "keys": [row[1] for row in sorted(info, key=lambda r: r[5]) if row[5]],
        }
        spec["rows"] = {identity: digest(values) for identity, values, _ in table_rows(conn, name, spec)}
        count = conn.execute(f"SELECT COUNT(*) FROM {quote(name)}").fetchone()[0]
        if len(spec["rows"]) != count:
            # SQLite rowid tables can have NULL in a composite primary key.
            # Never collapse such rows into one identity during review.
            spec["keys"] = []
            spec["rows"] = {identity: digest(values) for identity, values, _ in table_rows(conn, name, spec)}
        if len(spec["rows"]) != count:
            raise ValueError(f"不能完整标识输入记录: {name}")
        scope[name] = spec
    return scope


def original_records(conn, scope, *, synchronized=()):
    result = {}
    synchronized = set(synchronized)
    for name, spec in scope.items():
        rows = {}
        for identity, values, item in table_rows(conn, name, spec):
            if identity not in spec["rows"]:
                continue
            if name == "reimbursement_settlement_obligations" and item.get("id") in synchronized:
                # This timestamp belongs to the existing GET-triggered sync,
                # whose actual amounts and audit contents are compared too.
                item.pop("updated_at", None)
                if item.get("payload"):
                    payload = json.loads(item["payload"])
                    payload.pop("updatedAt", None)
                    item["payload"] = json.dumps(payload, sort_keys=True, ensure_ascii=False)
                values = tuple(item.items())
            rows[identity] = digest(values)
        result[name] = rows
    return result


def require_original_rows(records, scope):
    missing = {name: sorted(set(spec["rows"]) - set(records[name])) for name, spec in scope.items()}
    missing = {name: keys for name, keys in missing.items() if keys}
    if missing:
        raise ValueError(f"原有记录缺失: {missing}")


def backup_copy(source, target):
    with Path(target).open("xb"):
        os.chmod(target, 0o600)
    with closing(immutable_connection(source)) as original, closing(sqlite3.connect(target)) as copied:
        original.backup(copied)


def private_output(output, source, code_root):
    output = Path(output)
    if output.exists() or output.is_symlink():
        raise ValueError("输出目录必须是尚不存在的新目录，不能覆盖历史证据")
    source, code_root = Path(source).resolve(), Path(code_root).resolve()
    output = Path(output).resolve()
    if output.exists() or output.is_symlink():
        raise ValueError("输出目录必须是尚不存在的新目录，不能覆盖历史证据")
    if output == code_root or code_root in output.parents or output == source or output in source.parents:
        raise ValueError("输出必须位于代码仓库之外，且不能包含或覆盖输入数据库")
    output.mkdir(parents=True, mode=0o700)
    return output
