import copy
import sqlite3
import unittest
from io import BytesIO
from unittest.mock import Mock, patch
from zipfile import ZipFile

from docx import Document
from docx.oxml.ns import qn

from server_app.domains.intake import summary
from server_app.repositories.entities import upsert_intake_batch
from server_app.web import intake_summary


def reservation(index=1, **overrides):
    return {
        "id": f"summary-{index}",
        "batchNo": f"（Z2026001）202610{index:04d}",
        "purchaseOrderNo": f"PO-{index}",
        "iacuc": "Z2026001",
        "owner": "预约人",
        "pi": "项目负责人",
        "supplier": "实验供应单位",
        "strainRaw": "C57 <原文> & ICR",
        "strainStandard": "标准化品系",
        "species": "mouse",
        "sex": "雌雄各半",
        "quantity": 6,
        "finalCardCount": 2,
        "intakeDate": "2026-10-12",
        "roomName": "8105",
        "status": "pending_print",
        "updatedAt": "2026-10-10T10:00:00",
        "husbandryDays": 30,
        "notes": "请核对耳标\n保持分笼",
        "rawMessage": "预约原文含8周龄，20–22克\n下午送达",
        **overrides,
    }


class IntakeSummaryTests(unittest.TestCase):
    def setUp(self):
        self.conn = sqlite3.connect(":memory:")
        self.conn.row_factory = sqlite3.Row
        self.conn.execute("""CREATE TABLE intake_batches (
            id TEXT PRIMARY KEY, batch_no TEXT, iacuc TEXT, supplier TEXT, pi TEXT, owner TEXT,
            quantity INTEGER, card_count INTEGER, room_name TEXT, intake_date TEXT,
            status TEXT, updated_at TEXT, payload TEXT)""")
        self.conn.execute("CREATE INDEX idx_intake_date ON intake_batches(intake_date)")
        self.addCleanup(self.conn.close)

    def test_interval_includes_both_days_and_all_statuses_without_page_limit_or_writes(self):
        for index in range(125):
            upsert_intake_batch(
                self.conn, reservation(index, status=["draft", "pending_print", "printed", "received"][index % 4])
            )
        upsert_intake_batch(self.conn, reservation(200, intakeDate="2026-10-13", roomName="8103"))
        for index, day in [(201, "2026-10-11"), (202, "2026-10-14"), (203, "")]:
            upsert_intake_batch(self.conn, reservation(index, intakeDate=day))
        changes = self.conn.total_changes
        before = [tuple(row) for row in self.conn.execute("SELECT * FROM intake_batches")]
        snapshot = summary.snapshot(self.conn, "2026-10-12", "2026-10-13")
        self.assertEqual(len(snapshot["batches"]), 126)
        self.assertEqual(snapshot["batches"][-1]["id"], "summary-200")
        summary.generate(snapshot)
        self.assertEqual(changes, self.conn.total_changes)
        self.assertEqual(before, [tuple(row) for row in self.conn.execute("SELECT * FROM intake_batches")])
        plan = self.conn.execute(
            "EXPLAIN QUERY PLAN SELECT payload FROM intake_batches WHERE intake_date >= ? AND intake_date <= ?",
            ("2026-10-12", "2026-10-13"),
        ).fetchall()
        self.assertIn("idx_intake_date", " ".join(row["detail"] for row in plan))

    def test_invalid_or_empty_intervals_fail_before_generating_a_blank_document(self):
        for start, end in [
            ("", "2026-10-12"),
            ("20261012", "2026-10-13"),
            ("2026-02-30", "2026-10-13"),
            ("2026-10-13", "2026-10-12"),
            ("2026-10-12' OR 1=1", "2026-10-13"),
        ]:
            with self.subTest(start=start), self.assertRaises(ValueError):
                summary.snapshot(self.conn, start, end)
        with self.assertRaisesRegex(ValueError, "没有预约接收批次"):
            summary.snapshot(self.conn, "2026-10-12", "2026-10-13")

    def test_word_preserves_reservation_details_and_blanks_and_groups_by_date_room(self):
        entries = [
            reservation(3, intakeDate="2026-10-13"),
            reservation(2, roomName="8105", status="received"),
            reservation(1, roomName="8103", quantity=0, husbandryDays=0),
        ]
        original = copy.deepcopy(entries)
        document = Document(
            BytesIO(summary.generate({"startDate": "2026-10-12", "endDate": "2026-10-13", "batches": entries}))
        )
        content = "\n".join(p.text for p in document.paragraphs)
        for value in [
            "共 3 批",
            "预约人（项目负责人）",
            "2笼",
            "C57 <原文> & ICR",
            "数量：0",
            "饲养天数：0",
            "雌雄各半",
            "Z2026001",
            "请核对耳标\n保持分笼",
            "【已接收】",
        ]:
            self.assertIn(value, content)
        self.assertNotIn("标准化品系", content)
        self.assertIn("【未打印】", content)
        for removed in ("预约原文：", "8周龄", "签收：", "实收数量：", "备注：________________"):
            self.assertNotIn(removed, content)
        self.assertNotIn("✔", content)
        self.assertLess(content.index("PO-1"), content.index("PO-2"))
        self.assertLess(content.index("PO-2"), content.index("PO-3"))
        self.assertEqual(entries, original)
        self.assertFalse(document.tables)
        self.assertAlmostEqual(document.sections[0].page_width.mm, 210, places=1)
        self.assertAlmostEqual(document.sections[0].page_height.mm, 297, places=1)
        self.assertEqual(document.styles["Normal"].element.rPr.rFonts.get(qn("w:eastAsia")), "宋体")
        for p in document.paragraphs:
            if p.text.startswith("□ "):
                self.assertTrue(p.paragraph_format.keep_with_next)
                self.assertTrue(p.paragraph_format.keep_together)
            if p.text.startswith("采购单号："):
                self.assertFalse(p.paragraph_format.keep_with_next)
                self.assertTrue(p.paragraph_format.keep_together)
                self.assertEqual(p.paragraph_format.space_after.pt, 12)
                self.assertEqual(p.paragraph_format.line_spacing.pt, 15)

    def test_missing_fields_are_not_invented_and_xml_control_characters_are_removed(self):
        item = reservation(
            owner="",
            pi="",
            quantity=None,
            strainRaw="",
            strainStandard="备用品系",
            notes="合法\x00文本\x0b\ud800",
            rawMessage="",
            finalCardCount=None,
        )
        document = Document(
            BytesIO(summary.generate({"startDate": "2026-10-12", "endDate": "2026-10-12", "batches": [item]}))
        )
        content = "\n".join(p.text for p in document.paragraphs)
        for value in ["负责人未填写", "数量：未填写", "备用品系", "合法文本"]:
            self.assertIn(value, content)
        self.assertNotIn("预约原文：", content)

    def test_template_contains_only_blank_layout_and_all_status_tags_are_exported(self):
        template = Document(summary.TEMPLATE)
        self.assertFalse(template.paragraphs)
        self.assertEqual(template.core_properties.author, "CageLedger")
        with ZipFile(summary.TEMPLATE) as archive:
            self.assertFalse(
                any("media/" in name or "custom.xml" in name or "comments" in name for name in archive.namelist())
            )
        entries = [reservation(i, status=status) for i, status in enumerate(summary.STATUS_LABELS)]
        document = Document(
            BytesIO(summary.generate({"startDate": "2026-10-12", "endDate": "2026-10-12", "batches": entries}))
        )
        content = "\n".join(p.text for p in document.paragraphs)
        for label in summary.STATUS_LABELS.values():
            self.assertIn(f"【{label}】", content)

    def test_handler_rejects_anonymous_and_allows_list_roles_with_private_word_download(self):
        handler = Mock(path="/api/intake-batches/summary.docx?startDate=2026-10-12&endDate=2026-10-12")
        handler.require_user.return_value = None
        with patch.object(intake_summary, "connect_db") as connect:
            self.assertTrue(intake_summary.handle(handler, "/api/intake-batches/summary.docx"))
            connect.assert_not_called()
        handler.send_download.assert_not_called()
        upsert_intake_batch(self.conn, reservation())
        for role in ("admin", "room_admin"):
            handler.require_user.return_value = {"role": role, "roomIds": []}
            with patch.object(intake_summary, "connect_db") as connect:
                connect.return_value.__enter__.return_value = self.conn
                self.assertTrue(intake_summary.handle(handler, "/api/intake-batches/summary.docx"))
            data, name, mime = handler.send_download.call_args.args
            self.assertEqual(name, "接收汇总_2026-10-12_2026-10-12.docx")
            self.assertEqual(mime, summary.DOCX_MIME)
            self.assertTrue(Document(BytesIO(data)).paragraphs)
        handler.path = "/api/intake-batches/summary.docx?startDate=bad"
        self.assertTrue(intake_summary.handle(handler, "/api/intake-batches/summary.docx"))
        self.assertEqual(handler.send_json.call_args.args[1], 400)
        self.assertFalse(intake_summary.handle(handler, "/api/intake-batches"))


if __name__ == "__main__":
    unittest.main()
