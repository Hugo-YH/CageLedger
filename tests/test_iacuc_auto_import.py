import sqlite3
import tempfile
import unittest
from datetime import datetime
from pathlib import Path
from unittest.mock import patch

import openpyxl

from server_app.domains.iacuc.auto_import import (
    _archive_imported,
    import_summary_file,
    latest_summary_path,
    xlsx_to_csv_bytes,
)
from server_app.legacy import initialize_schema


def build_summary_xlsx(path, rows):
    workbook = openpyxl.Workbook()
    worksheet = workbook.active
    worksheet.append(["动物实验申请汇总表"])
    worksheet.append(
        [
            "动物伦理编号",
            "动物实验名称",
            "项目负责人",
            "实验负责人",
            "项目来源",
            "动物伦理通过日期",
            "实验审核通过 饲养费（元）",
        ]
    )
    for row in rows:
        worksheet.append(row)
    workbook.save(path)


class IacucAutoImportTests(unittest.TestCase):
    def setUp(self):
        self.conn = sqlite3.connect(":memory:")
        self.conn.row_factory = sqlite3.Row
        self.conn.execute("PRAGMA foreign_keys=ON")
        initialize_schema(self.conn)
        self.tmpdir = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmpdir.cleanup)

    def tearDown(self):
        self.conn.close()

    def test_xlsx_to_csv_bytes_skips_title_row_and_formats_cells(self):
        path = Path(self.tmpdir.name) / "summary.xlsx"
        build_summary_xlsx(
            path,
            [
                ["Z2026001", "近视研究", "张三", "李四", "国自然", datetime(2025, 11, 7), 12960.0],
                ["", "", "", "", "", "", ""],
            ],
        )
        raw = xlsx_to_csv_bytes(path)
        text = raw.decode("utf-8-sig")
        lines = [line for line in text.splitlines() if line.strip()]
        self.assertEqual(
            lines[0],
            "动物伦理编号,动物实验名称,项目负责人,实验负责人,项目来源,动物伦理通过日期,实验审核通过 饲养费（元）",
        )
        self.assertEqual(lines[1], "Z2026001,近视研究,张三,李四,国自然,2025/11/07,12960")

    def test_latest_summary_path_returns_newest_file(self):
        inbox = Path(self.tmpdir.name) / "inbox"
        inbox.mkdir()
        (inbox / "old.xlsx").touch()
        (inbox / "new.csv").touch()
        Path(self.tmpdir.name, "ignored.txt").write_text("x", encoding="utf-8")
        latest = latest_summary_path(inbox)
        self.assertEqual(latest.name, "new.csv")
        self.assertIsNone(latest_summary_path(Path(self.tmpdir.name) / "missing"))

    @patch("server_app.domains.iacuc.auto_import.save_iacuc_index_file")
    def test_import_summary_file_writes_applications_and_audit(self, save_index):
        path = Path(self.tmpdir.name) / "summary.xlsx"
        build_summary_xlsx(path, [["Z2026001", "近视研究", "张三", "李四", "国自然", "2025/11/7", 12960]])
        result = import_summary_file(
            path,
            conn=self.conn,
            now="2026-08-19T16:00:00",
            actor={
                "id": "system",
                "username": "system",
                "displayName": "系统自动导入",
                "role": "admin",
                "roomIds": [],
            },
        )
        self.assertEqual(result["count"], 1)
        row = self.conn.execute("SELECT iacuc, project, pi, owner, funding FROM experiment_applications").fetchone()
        self.assertEqual(row["iacuc"], "Z2026001")
        self.assertEqual(row["pi"], "张三")
        save_index.assert_called_once()
        audit = self.conn.execute(
            "SELECT action, entity_type, payload FROM audit_events WHERE action='iacuc_index.auto_imported'"
        ).fetchone()
        self.assertIsNotNone(audit)

    def test_archive_imported_moves_file_with_timestamp(self):
        inbox = Path(self.tmpdir.name) / "inbox"
        archive = Path(self.tmpdir.name) / "archive"
        inbox.mkdir()
        source = inbox / "动物实验申请汇总表-20260819090000.xlsx"
        source.write_bytes(b"x")
        target = _archive_imported(source, archive, "2026-08-19T17:00:00")
        self.assertTrue(target.exists())
        self.assertFalse(source.exists())
        self.assertTrue(target.name.startswith("动物实验申请汇总表"))


if __name__ == "__main__":
    unittest.main()
