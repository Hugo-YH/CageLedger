import hashlib
import json
import sqlite3
import tempfile
import unittest
import zlib
from contextlib import closing
from pathlib import Path
from unittest.mock import patch

from scripts.compact_billing_snapshots import convert_copy
from server_app.cache import invalidate_data_cache_prefixes
from server_app.domains.billing.snapshot_codec import SnapshotStorageError
from server_app.domains.workflow.application import save_billing_statement_workflow
from server_app.legacy import initialize_schema
from server_app.repositories.billing_snapshot_storage import compact_version, expand_version, read_records
from server_app.repositories.billing_statements import (
    list_billing_statement_line_summaries_for_version,
    list_billing_statement_lines_for_version,
    replace_billing_statement_version_lines,
)
from server_app.repositories.billing_workflows import delete_billing_workflow_tree

ADMIN = {"id": "admin", "username": "admin", "displayName": "测试管理员", "role": "admin"}


class BillingSnapshotStorageTests(unittest.TestCase):
    def setUp(self):
        invalidate_data_cache_prefixes("billing_")
        self.conn = sqlite3.connect(":memory:")
        self.conn.row_factory = sqlite3.Row
        self.conn.execute("PRAGMA foreign_keys=ON")
        initialize_schema(self.conn)
        workflow, version, *_ = save_billing_statement_workflow(
            self.conn,
            {
                "id": "seed",
                "month": "2026-10",
                "pi": "测试负责人",
                "iacuc": "Z2026001",
                "sourceType": "quantity_sheet",
                "totalAmount": 300,
            },
            [],
            ADMIN,
        )
        self.workflow_id, self.version_id = workflow["id"], version["id"]
        self.conn.commit()

    def tearDown(self):
        self.conn.close()
        invalidate_data_cache_prefixes("billing_")

    def lines(self):
        return [
            {
                "id": f"line-{index}",
                "date": "2026-10-02" if index == 0 else "2026-10-01",
                "amount": 0.1,
                "cumulative": 0.1 * index,
                "cageCount": index + 1,
                "billableCount": index,
                "freeCages": 1,
                "custom": {"unicode": "原样保留", "flags": [True, None]},
                "iacucBreakdown": [
                    {
                        "iacuc": "Z2026001",
                        "facility": "珠江新城",
                        "project": "长项目名称" * 100,
                        "quantity": 1.25,
                        "price": 30,
                        "amount": 37.5,
                        "unit": "小时",
                    }
                ],
            }
            for index in range(6)
        ]

    def store(self):
        lines = self.lines()
        replace_billing_statement_version_lines(self.conn, self.version_id, lines)
        self.conn.commit()
        return sorted([{**line, "versionId": self.version_id} for line in lines], key=lambda line: line["date"])

    def block(self):
        return self.conn.execute("SELECT * FROM billing_statement_line_blocks").fetchone()

    def test_new_storage_preserves_full_fields_money_and_same_date_order(self):
        expected = self.store()
        self.assertIsNotNone(self.block())
        self.assertEqual(list_billing_statement_lines_for_version(self.conn, self.version_id), expected)
        summaries = list_billing_statement_line_summaries_for_version(self.conn, self.version_id)
        self.assertEqual([row["amount"] for row in summaries], [0.1] * 6)
        self.assertEqual([row["cageCount"] for row in summaries], [line["cageCount"] for line in expected])
        self.assertEqual([row["billableCages"] for row in summaries], [line["billableCount"] for line in expected])
        stored = json.loads(
            self.conn.execute("SELECT payload FROM billing_statement_version_lines LIMIT 1").fetchone()[0]
        )
        self.assertNotIn("iacucBreakdown", stored)
        self.assertFalse(any("_snapshotStorage" in line for line in expected))

    def test_small_and_empty_snapshots_use_legacy_json_without_extra_block(self):
        replace_billing_statement_version_lines(self.conn, self.version_id, [{"date": "2026-10-01", "amount": 0}])
        self.assertIsNone(self.block())
        self.assertEqual(list_billing_statement_lines_for_version(self.conn, self.version_id)[0]["amount"], 0)
        replace_billing_statement_version_lines(self.conn, self.version_id, [])
        self.assertEqual(read_records(self.conn, self.version_id), [])
        self.assertIsNone(self.block())

    def test_legacy_compaction_and_expansion_preserve_exact_json_and_rowids(self):
        for index, line in enumerate(self.lines()):
            self.conn.execute(
                "INSERT INTO billing_statement_version_lines VALUES (?,?,?,?)",
                (line["id"], self.version_id, line["date"], json.dumps(line, ensure_ascii=True, indent=index + 1)),
            )
        self.conn.commit()
        before = [
            tuple(row)
            for row in self.conn.execute("SELECT rowid,* FROM billing_statement_version_lines ORDER BY rowid")
        ]
        originals = read_records(self.conn, self.version_id)
        self.assertTrue(compact_version(self.conn, self.version_id))
        self.assertFalse(compact_version(self.conn, self.version_id))
        self.assertEqual(read_records(self.conn, self.version_id), originals)
        self.assertTrue(expand_version(self.conn, self.version_id))
        self.assertFalse(expand_version(self.conn, self.version_id))
        self.assertEqual(
            [
                tuple(row)
                for row in self.conn.execute("SELECT rowid,* FROM billing_statement_version_lines ORDER BY rowid")
            ],
            before,
        )

    def test_corrupt_unknown_oversized_and_misidentified_blocks_are_rejected(self):
        expected = self.store()
        original = dict(self.block())
        changes = (
            ("payload", b"broken"),
            ("payload", original["payload"] + b"extra"),
            ("payload", original["payload"][:-3]),
            ("raw_sha256", "0" * 64),
            ("codec", "unknown-v2"),
            ("line_count", 1),
            ("raw_bytes", 1 << 30),
        )
        for column, value in changes:
            with self.subTest(column=column, value=type(value).__name__):
                self.conn.execute(f"UPDATE billing_statement_line_blocks SET {column}=?", (value,))
                with self.assertRaises(SnapshotStorageError):
                    list_billing_statement_lines_for_version(self.conn, self.version_id)
                self.conn.execute(f"UPDATE billing_statement_line_blocks SET {column}=?", (original[column],))
        self.assertEqual(list_billing_statement_lines_for_version(self.conn, self.version_id), expected)

    def test_missing_block_and_altered_summary_never_fall_back_to_partial_details(self):
        self.store()
        list_billing_statement_line_summaries_for_version(self.conn, self.version_id)
        self.conn.execute("UPDATE billing_statement_version_lines SET payload=json_set(payload,'$.amount',99)")
        with self.assertRaises(SnapshotStorageError):
            list_billing_statement_lines_for_version(self.conn, self.version_id)
        self.conn.execute("DELETE FROM billing_statement_line_blocks")
        for read in (list_billing_statement_lines_for_version, list_billing_statement_line_summaries_for_version):
            with self.assertRaises(SnapshotStorageError):
                read(self.conn, self.version_id)

    def test_other_version_block_is_rejected_even_with_matching_checksum(self):
        self.store()
        block = self.block()
        document = json.loads(zlib.decompress(block["payload"]))
        document["versionId"] = "different-version"
        raw = json.dumps(document, ensure_ascii=False, separators=(",", ":")).encode()
        self.conn.execute(
            "UPDATE billing_statement_line_blocks SET payload=?,raw_bytes=?,raw_sha256=?",
            (zlib.compress(raw), len(raw), hashlib.sha256(raw).hexdigest()),
        )
        with self.assertRaises(SnapshotStorageError):
            list_billing_statement_lines_for_version(self.conn, self.version_id)

    def test_replacement_failure_rolls_back_block_and_rows_without_committing_caller(self):
        before = self.store()
        block_before = tuple(self.block())
        with patch("server_app.repositories.billing_snapshot_storage.store_block", side_effect=RuntimeError("failed")):
            with self.assertRaises(RuntimeError):
                replace_billing_statement_version_lines(self.conn, self.version_id, self.lines())
        self.assertEqual(tuple(self.block()), block_before)
        self.assertEqual(list_billing_statement_lines_for_version(self.conn, self.version_id), before)
        self.conn.rollback()
        self.assertEqual(list_billing_statement_lines_for_version(self.conn, self.version_id), before)

    def test_workflow_deletion_cleans_blocks_without_relying_on_foreign_keys(self):
        self.store()
        self.conn.execute("PRAGMA foreign_keys=OFF")
        delete_billing_workflow_tree(self.conn, self.workflow_id)
        self.assertIsNone(self.block())
        self.assertEqual(read_records(self.conn, self.version_id), [])

    def test_copy_tool_is_reversible_and_refuses_to_overwrite_input_or_output(self):
        self.store()
        expand_version(self.conn, self.version_id)
        self.conn.commit()
        with tempfile.TemporaryDirectory() as directory:
            source, compacted, expanded = [
                Path(directory) / name for name in ("source.sqlite", "compact.sqlite", "expand.sqlite")
            ]
            with closing(sqlite3.connect(source)) as file:
                self.conn.backup(file)
            original_bytes = source.read_bytes()
            result = convert_copy(source, compacted, vacuum=True)
            self.assertEqual(result["converted_versions"], 1)
            self.assertEqual(source.read_bytes(), original_bytes)
            restored = convert_copy(compacted, expanded, mode="expand", vacuum=True)
            self.assertEqual(restored["converted_versions"], 1)
            with closing(sqlite3.connect(source)) as a, closing(sqlite3.connect(expanded)) as b:
                query = "SELECT * FROM billing_statement_version_lines ORDER BY line_date,rowid"
                self.assertEqual(a.execute(query).fetchall(), b.execute(query).fetchall())
            for target in (source, compacted):
                with self.assertRaises(ValueError):
                    convert_copy(source, target)
            self.assertEqual(source.read_bytes(), original_bytes)


if __name__ == "__main__":
    unittest.main()
