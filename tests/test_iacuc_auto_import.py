import json
import os
import sqlite3
import tempfile
import unittest
from datetime import datetime
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock, patch

import openpyxl

from server_app.domains.iacuc.auto_import import (
    _archive_imported,
    import_summary_file,
    latest_summary_path,
    scan_and_import_once,
    xlsx_to_csv_bytes,
)
from server_app.legacy import initialize_schema
from server_app.persistence.legacy_migrations import repair_intake_batch_species
from server_app.repositories.iacuc import save_iacuc_index_file
from server_app.web.workflow_actions import WorkflowActionsMixin


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

    @patch("server_app.domains.iacuc.auto_import.save_iacuc_index_file")
    def test_iacuc_species_summary_does_not_overwrite_intake_species(self, _save_index):
        payload = {
            "id": "intake",
            "iacuc": "Z2026001",
            "species": "mouse",
            "strainRaw": "C57/B6J",
            "rawMessage": "品系：C57/B6J",
        }
        self.conn.execute(
            """
            INSERT INTO intake_batches (
                id, batch_no, iacuc, status, updated_at, payload
            ) VALUES (?, ?, ?, ?, ?, ?)
            """,
            ("intake", "batch", "Z2026001", "received", "before", json.dumps(payload)),
        )
        path = Path(self.tmpdir.name) / "summary.csv"
        path.write_text(
            "动物伦理编号,动物实验名称,项目负责人,实验负责人,动物品系\n"
            "Z2026001,近视研究,张三,李四,C57小鼠600只、SD大鼠72只\n",
            encoding="utf-8-sig",
        )
        import_summary_file(path, conn=self.conn, now="2026-09-11T12:00:00")
        stored = json.loads(
            self.conn.execute("SELECT payload FROM intake_batches WHERE id='intake'").fetchone()["payload"]
        )
        self.assertEqual(stored["species"], "mouse")

    def summary_csv(self, name="summary.csv", iacuc="Z2026001"):
        path = Path(self.tmpdir.name) / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(
            "动物伦理编号,动物实验名称,项目负责人,实验负责人,动物品系\n"
            f"{iacuc},近视研究,张三,李四,C57小鼠600只、SD大鼠72只\n",
            encoding="utf-8-sig",
        )
        return path

    @patch("server_app.domains.iacuc.auto_import.save_iacuc_index_file")
    def test_occupancy_sync_preserves_species_and_records_audit(self, _save_index):
        for species in ("mouse", "rat"):
            payload = {"id": species, "iacuc": "Z2026001", "species": species, "pi": "原负责人"}
            self.conn.execute(
                "INSERT INTO occupancies (id, status, iacuc, pi, species, payload) VALUES (?, ?, ?, ?, ?, ?)",
                (species, "occupied", "Z2026001", "原负责人", species, json.dumps(payload)),
            )
        self.conn.commit()
        result = import_summary_file(self.summary_csv(), conn=self.conn, now="2026-10-10T06:00:00+00:00")
        self.assertEqual(result["syncSummary"]["tableCounts"]["occupancies"], 2)
        for row in self.conn.execute("SELECT id, species, pi, payload FROM occupancies"):
            self.assertEqual(row["species"], row["id"])
            self.assertEqual(json.loads(row["payload"])["species"], row["id"])
            self.assertEqual(row["pi"], "张三")
            self.assertEqual(json.loads(row["payload"])["pi"], "张三")
        snapshot = self.conn.execute(
            "SELECT payload FROM project_sync_snapshots WHERE id = ?", (result["syncSummary"]["snapshotId"],)
        ).fetchone()
        changes = json.loads(snapshot["payload"])["changes"]
        self.assertEqual({change["id"] for change in changes}, {"mouse", "rat"})
        self.assertTrue(all("species" not in change["changedFields"] for change in changes))

    @patch("server_app.domains.iacuc.auto_import.save_iacuc_index_file")
    def test_failed_sync_keeps_database_and_index_unchanged(self, save_index):
        import_summary_file(self.summary_csv(iacuc="Z2026001"), conn=self.conn, now="before")
        save_index.reset_mock()
        with patch(
            "server_app.domains.iacuc.auto_import.sync_project_derived_fields_after_iacuc_upload",
            side_effect=RuntimeError("sync failed"),
        ):
            with self.assertRaisesRegex(RuntimeError, "sync failed"), self.conn:
                import_summary_file(self.summary_csv(iacuc="Z2026002"), conn=self.conn, now="after")
        save_index.assert_not_called()
        self.assertEqual(self.conn.execute("SELECT iacuc FROM experiment_applications").fetchone()[0], "Z2026001")
        self.assertEqual(self.conn.execute("SELECT count(*) FROM audit_events").fetchone()[0], 1)

    @patch("server_app.domains.iacuc.auto_import.save_iacuc_index_file")
    def test_failed_commit_does_not_publish_index(self, save_index):
        connection = Mock(wraps=self.conn)
        connection.commit.side_effect = sqlite3.OperationalError("commit failed")
        with self.assertRaisesRegex(sqlite3.OperationalError, "commit failed"), self.conn:
            import_summary_file(self.summary_csv(), conn=connection, now="after")
        save_index.assert_not_called()
        self.assertEqual(self.conn.execute("SELECT count(*) FROM experiment_applications").fetchone()[0], 0)
        self.assertEqual(self.conn.execute("SELECT count(*) FROM audit_events").fetchone()[0], 0)

    def test_index_publication_failure_keeps_committed_import_successful(self):
        with (
            patch("server_app.domains.iacuc.auto_import.save_iacuc_index_file", side_effect=OSError("disk full")),
            patch("builtins.print") as warning,
        ):
            result = import_summary_file(self.summary_csv(), conn=self.conn, now="after")
        self.assertEqual(result["count"], 1)
        self.assertEqual(self.conn.execute("SELECT count(*) FROM experiment_applications").fetchone()[0], 1)
        self.assertEqual(self.conn.execute("SELECT count(*) FROM audit_events").fetchone()[0], 1)
        warning.assert_called_once()

    def test_index_replace_failure_preserves_existing_file_and_cleans_temporary(self):
        path = Path(self.tmpdir.name) / "index.json"
        save_iacuc_index_file(path, [{"iacuc": "old"}])
        with patch("server_app.repositories.iacuc.os.replace", side_effect=OSError("replace failed")):
            with self.assertRaisesRegex(OSError, "replace failed"):
                save_iacuc_index_file(path, [{"iacuc": "new"}])
        self.assertEqual(json.loads(path.read_text()), [{"iacuc": "old"}])
        self.assertEqual(list(path.parent.glob(".iacuc-index-*")), [])

    def scan(self, inbox, archive, **kwargs):
        with (
            patch("server_app.domains.iacuc.auto_import.connect_db", return_value=self.conn),
            patch("server_app.domains.iacuc.auto_import.save_iacuc_index_file"),
        ):
            return scan_and_import_once(inbox, archive, now="2026-10-10T06:00:00+00:00", **kwargs)

    def test_scan_imports_latest_and_preserves_superseded_files_without_replaying(self):
        old = self.summary_csv("inbox/old.csv", "Z2026001")
        latest = self.summary_csv("inbox/latest.csv", "Z2026002")
        os.utime(old, (10, 10))
        os.utime(latest, (20, 20))
        archive = Path(self.tmpdir.name) / "archive"
        result = self.scan(latest.parent, archive)
        self.assertEqual(result["source"], "latest.csv")
        self.assertEqual(result["supersededSources"], ["old.csv"])
        self.assertEqual(len(list((archive / "superseded").glob("*.csv"))), 1)
        self.assertEqual(len(list(archive.glob("*.csv"))), 1)
        self.assertIsNone(self.scan(latest.parent, archive))
        self.assertEqual(self.conn.execute("SELECT iacuc FROM experiment_applications").fetchone()[0], "Z2026002")

    def test_scan_failure_retains_all_pending_files(self):
        old = self.summary_csv("inbox/old.csv")
        latest = self.summary_csv("inbox/latest.csv", "Z2026002")
        with patch(
            "server_app.domains.iacuc.auto_import.sync_project_derived_fields_after_iacuc_upload",
            side_effect=RuntimeError("sync failed"),
        ):
            with self.assertRaisesRegex(RuntimeError, "sync failed"):
                self.scan(latest.parent, Path(self.tmpdir.name) / "archive")
        self.assertTrue(old.exists())
        self.assertTrue(latest.exists())
        self.assertEqual(self.conn.execute("SELECT count(*) FROM experiment_applications").fetchone()[0], 0)

    def test_scan_retains_arriving_and_replaced_files(self):
        old = self.summary_csv("inbox/old.csv")
        latest = self.summary_csv("inbox/latest.csv", "Z2026002")
        os.utime(old, (10, 10))
        os.utime(latest, (20, 20))

        def import_with_arrivals(*args, **kwargs):
            result = import_summary_file(*args, **kwargs)
            self.summary_csv("inbox/arrived.csv", "Z2026003")
            self.summary_csv("inbox/old.csv", "Z2026004")
            return result

        with patch("server_app.domains.iacuc.auto_import.import_summary_file", side_effect=import_with_arrivals):
            result = self.scan(latest.parent, Path(self.tmpdir.name) / "archive")
        self.assertEqual(result["supersededSources"], [])
        self.assertTrue(old.exists())
        self.assertTrue((old.parent / "arrived.csv").exists())
        self.assertFalse(latest.exists())

    def test_archive_failure_leaves_latest_for_retry(self):
        old = self.summary_csv("inbox/old.csv")
        latest = self.summary_csv("inbox/latest.csv", "Z2026002")
        os.utime(old, (10, 10))
        os.utime(latest, (20, 20))
        with (
            patch("server_app.domains.iacuc.auto_import._archive_imported", side_effect=OSError("archive failed")),
            patch("server_app.domains.iacuc.auto_import.invalidate_data_cache") as invalidate,
        ):
            with self.assertRaisesRegex(OSError, "archive failed"):
                self.scan(latest.parent, Path(self.tmpdir.name) / "archive")
        invalidate.assert_called_once_with(
            "assembled_state", "iacuc_index", "principal_identities", "principal_types_by_pi"
        )
        self.assertTrue(latest.exists())
        self.assertTrue(old.exists())
        self.assertEqual(self.conn.execute("SELECT iacuc FROM experiment_applications").fetchone()[0], "Z2026002")

    def test_manual_upload_failure_does_not_publish_index(self):
        path = self.summary_csv()
        handler = SimpleNamespace(
            require_user=lambda: {"id": "admin", "username": "admin", "role": "admin", "displayName": "管理员"},
            read_raw_body=lambda: b"multipart",
            headers={"Content-Type": "multipart/form-data"},
            send_json=Mock(),
        )
        ports = SimpleNamespace(save_iacuc_index_file=Mock())
        with (
            patch("server_app.web.workflow_actions.app_ports", return_value=ports),
            patch(
                "server_app.web.workflow_actions.parse_multipart_upload",
                return_value=("summary.csv", path.read_bytes()),
            ),
            patch("server_app.web.workflow_actions.connect_db", return_value=self.conn),
            patch(
                "server_app.web.workflow_actions.sync_project_derived_fields_after_iacuc_upload",
                side_effect=ValueError("sync failed"),
            ),
        ):
            WorkflowActionsMixin.handle_iacuc_upload(handler)
        ports.save_iacuc_index_file.assert_not_called()
        self.assertEqual(handler.send_json.call_args.args[0], {"error": "sync failed"})
        self.assertEqual(self.conn.execute("SELECT count(*) FROM experiment_applications").fetchone()[0], 0)

    def test_manual_upload_publishes_only_after_database_and_audit_commit(self):
        path = self.summary_csv()
        handler = SimpleNamespace(
            require_user=lambda: {"id": "admin", "username": "admin", "role": "admin", "displayName": "管理员"},
            read_raw_body=lambda: b"multipart",
            headers={"Content-Type": "multipart/form-data"},
            send_json=Mock(),
        )

        def check_committed(items):
            self.assertFalse(self.conn.in_transaction)
            self.assertEqual(items[0]["iacuc"], "Z2026001")
            self.assertEqual(self.conn.execute("SELECT count(*) FROM experiment_applications").fetchone()[0], 1)
            self.assertEqual(
                self.conn.execute("SELECT count(*) FROM audit_events WHERE action='iacuc_index.uploaded'").fetchone()[
                    0
                ],
                1,
            )

        ports = SimpleNamespace(save_iacuc_index_file=Mock(side_effect=check_committed))
        with (
            patch("server_app.web.workflow_actions.app_ports", return_value=ports),
            patch(
                "server_app.web.workflow_actions.parse_multipart_upload",
                return_value=("summary.csv", path.read_bytes()),
            ),
            patch("server_app.web.workflow_actions.connect_db", return_value=self.conn),
        ):
            WorkflowActionsMixin.handle_iacuc_upload(handler)
        ports.save_iacuc_index_file.assert_called_once()
        self.assertTrue(handler.send_json.call_args.args[0]["ok"])

    def test_repairs_polluted_intake_species_from_its_own_strain(self):
        payload = {
            "id": "intake",
            "species": "C57小鼠600只、SD大鼠72只",
            "strainRaw": "SD大鼠",
            "strainStandard": "SD大鼠",
            "rawMessage": "品系：SD大鼠",
        }
        self.conn.execute(
            """
            INSERT INTO intake_batches (
                id, batch_no, status, updated_at, payload
            ) VALUES (?, ?, ?, ?, ?)
            """,
            ("intake", "batch", "received", "before", json.dumps(payload)),
        )
        repair_intake_batch_species(self.conn)
        repair_intake_batch_species(self.conn)
        stored = json.loads(
            self.conn.execute("SELECT payload FROM intake_batches WHERE id='intake'").fetchone()["payload"]
        )
        self.assertEqual(stored["species"], "rat")


if __name__ == "__main__":
    unittest.main()
