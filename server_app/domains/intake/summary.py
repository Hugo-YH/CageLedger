"""Word reception notes following the historical date / room / reservation blocks."""

import re
from collections import defaultdict
from datetime import date
from io import BytesIO
from pathlib import Path

from docx import Document
from docx.enum.style import WD_STYLE_TYPE
from docx.enum.text import WD_ALIGN_PARAGRAPH, WD_COLOR_INDEX
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from docx.shared import Mm, Pt, RGBColor

from . import repository
from .rules import species_label

DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
STATUS_LABELS = {"draft": "草稿", "pending_print": "未打印", "printed": "已打印", "received": "已接收"}
TEMPLATE = Path(__file__).resolve().parents[2] / "resources" / "intake" / "reception-summary.docx"


def validate_interval(start_date, end_date):
    for value in (start_date, end_date):
        if not isinstance(value, str) or not re.fullmatch(r"\d{4}-\d{2}-\d{2}", value):
            raise ValueError("请选择有效的开始日期和结束日期")
        try:
            date.fromisoformat(value)
        except ValueError as exc:
            raise ValueError("请选择有效的开始日期和结束日期") from exc
    if start_date > end_date:
        raise ValueError("开始日期不能晚于结束日期")


def snapshot(conn, start_date, end_date):
    validate_interval(start_date, end_date)
    batches = repository.list_summary_batches(conn, start_date, end_date)
    if not batches:
        raise ValueError("所选日期区间没有预约接收批次，请调整日期后重试")
    return {"startDate": start_date, "endDate": end_date, "batches": batches}


def text(value):
    # Preserve user text and line breaks; omit only characters XML cannot represent.
    return re.sub(
        r"[\x00-\x08\x0b\x0c\x0e-\x1f\ud800-\udfff\ufffe\uffff]", "", str(value if value is not None else "")
    ).strip()


def field(value):
    return text(value) or "未填写"


def paragraph(document, value, *, bold=False, size=12, after=0, keep_next=False):
    p = document.add_paragraph()
    p.paragraph_format.space_after = Pt(after)
    p.paragraph_format.line_spacing = Pt(max(15, size * 1.25))
    p.paragraph_format.keep_together = True
    p.paragraph_format.keep_with_next = keep_next
    run = p.add_run(text(value))
    run.bold = bold
    run.font.size = Pt(size)
    return p


def batch_block(document, batch):
    owner, pi = text(batch.get("owner")), text(batch.get("pi"))
    person = f"{owner}（{pi}）" if owner and pi and owner != pi else owner or pi or "负责人未填写"
    cage_count = batch.get("finalCardCount")
    cages = f"　{cage_count}笼" if cage_count is not None else ""
    heading = paragraph(document, f"□ {person}{cages}", bold=True, keep_next=True)
    heading.runs[0].font.highlight_color = WD_COLOR_INDEX.YELLOW
    status = text(batch.get("status"))
    tag = heading.add_run(f"　【{STATUS_LABELS.get(status, status or '状态未填写')}】")
    tag.bold = True
    tag.font.size = Pt(10.5)
    tag.font.color.rgb = RGBColor.from_string(
        {"printed": "0958D9", "received": "237804", "draft": "595959", "pending_print": "595959"}.get(status, "595959")
    )
    lines = [
        f"采购单号：{field(batch.get('purchaseOrderNo'))}　批次号：{field(batch.get('batchNo'))}",
        f"供应商：{field(batch.get('supplier'))}　品系：{field(batch.get('strainRaw') or batch.get('strainStandard'))}"
        f"　数量：{field(batch.get('quantity'))}　饲养房间：{field(batch.get('roomName'))}",
    ]
    optional = [f"IACUC：{field(batch.get('iacuc'))}"]
    if batch.get("species"):
        optional.append(f"动物种类：{species_label(batch['species'])}")
    if batch.get("sex"):
        optional.append(f"性别：{text(batch['sex'])}")
    if batch.get("husbandryDays") is not None:
        optional.append(f"饲养天数：{text(batch['husbandryDays'])}")
    if optional:
        lines.append("　".join(optional))
    if batch.get("project"):
        lines.append(f"项目名称：{text(batch['project'])}")
    contacts = [
        f"{label}：{text(batch[key])}"
        for key, label in (("receiverName", "接收人"), ("vetPhone", "兽医电话"))
        if batch.get(key)
    ]
    if contacts:
        lines.append("　".join(contacts))
    if batch.get("notes"):
        lines.append(f"预约备注：{text(batch['notes'])}")
    paragraph(document, "\n".join(lines), after=12)


def generate(document_snapshot):
    document = Document(TEMPLATE)
    section = document.sections[0]
    section.page_width, section.page_height = Mm(210), Mm(297)
    section.top_margin = section.bottom_margin = Mm(10)
    section.left_margin, section.right_margin = Mm(10), Mm(20)
    section.header_distance = section.footer_distance = Mm(5)
    if "Title" not in document.styles:
        document.styles.add_style("Title", WD_STYLE_TYPE.PARAGRAPH).base_style = document.styles["Normal"]
    for name in ("Normal", "Title"):
        style = document.styles[name]
        style.font.name, style.font.size = "宋体", Pt(12 if name == "Normal" else 16)
        style.font.color.rgb = RGBColor(0, 0, 0)
        fonts = style.element.get_or_add_rPr().get_or_add_rFonts()
        for key in ("asciiTheme", "hAnsiTheme", "eastAsiaTheme", "cstheme"):
            fonts.attrib.pop(qn(f"w:{key}"), None)
        fonts.set(qn("w:eastAsia"), "宋体")
        style.paragraph_format.space_before = Pt(0)
        style.paragraph_format.space_after = Pt(0)
        style.paragraph_format.line_spacing = Pt(15 if name == "Normal" else 20)
        for border in style.element.xpath("./w:pPr/w:pBdr"):
            border.getparent().remove(border)
    title = document.add_paragraph("实验动物接收汇总", "Title")
    title.paragraph_format.keep_with_next = True
    paragraph(
        document,
        f"{document_snapshot['startDate']} 至 {document_snapshot['endDate']}　共 {len(document_snapshot['batches'])} 批",
        after=8,
        keep_next=True,
    )
    grouped = defaultdict(lambda: defaultdict(list))
    for batch in document_snapshot["batches"]:
        grouped[batch["intakeDate"]][text(batch.get("roomName"))].append(batch)
    for intake_date, rooms in sorted(grouped.items()):
        day = date.fromisoformat(intake_date)
        paragraph(document, f"{day.year}年{day.month}月{day.day}日", bold=True, size=14, after=4, keep_next=True)
        for room, batches in sorted(rooms.items()):
            p = paragraph(document, room or "房间未填写", bold=True, after=4, keep_next=True)
            p.runs[0].font.highlight_color = WD_COLOR_INDEX.BRIGHT_GREEN
            for batch in batches:
                batch_block(document, batch)
    footer = section.footer.paragraphs[0]
    footer.alignment = WD_ALIGN_PARAGRAPH.RIGHT
    footer.add_run("第 ")
    number = OxmlElement("w:fldSimple")
    number.set(qn("w:instr"), "PAGE")
    footer._p.append(number)
    footer.add_run(" 页")
    document.core_properties.title = "实验动物接收汇总"
    document.core_properties.author = "CageLedger"
    output = BytesIO()
    document.save(output)
    return output.getvalue()
