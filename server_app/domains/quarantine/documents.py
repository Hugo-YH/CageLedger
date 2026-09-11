"""Generate Word by filling the user's retained laboratory forms in place."""

import json
from io import BytesIO
from pathlib import Path

from docx import Document
from docx.oxml.ns import qn
from docx.table import Table
from docx.text.paragraph import Paragraph

from .attachment_metadata import project_ids
from .document_layout import (
    cell_text,
    copy_paragraph,
    horizontal_result,
    image_table,
    paragraph_text,
    reagent_table,
    replace_element,
    sample_table,
)

TEMPLATES = Path(__file__).resolve().parents[2] / "resources" / "quarantine" / "templates"


def chinese_date(value):
    if not value:
        return "____年__月__日"
    year, month, day = value.split("-")
    return f"{year}年{int(month)}月{int(day)}日"


def generate(snapshot, root, *, draft=False):
    test = snapshot["test"]
    method = test["method"]
    template_name = "pcr_small" if method == "pcr" and len(test["samples"]) <= 6 else method
    document = Document(TEMPLATES / f"{template_name}.docx")
    manifest = json.loads((TEMPLATES / "manifest.json").read_text(encoding="utf-8"))[template_name]
    body = list(document.element.body)
    for element in body:
        if element.tag == qn("w:p"):
            paragraph = Paragraph(element, document)
            if any(label in paragraph.text for label in ("样本统计表", "原始记录", "显微观察记录", "实验结果统计表")):
                paragraph.paragraph_format.keep_with_next = True
    tables = [el for el in body if el.tag == qn("w:tbl")]
    metadata = Table(tables[0], document)
    cell_text(
        metadata.cell(1, 0),
        f"1、采样日期：{chinese_date(test['samplingDate'])}         实验日期：{chinese_date(test['testDate'])}",
    )
    materials = test.get("reportMaterial") or "、".join(dict.fromkeys(s["material"] for s in test["samples"]))
    states = test.get("reportSpecimenState") or "、".join(
        dict.fromkeys(s.get("specimenState", "") for s in test["samples"] if s.get("specimenState"))
    )
    pools = sum(s["poolCount"] for s in test["samples"])
    portions = sum(s["portionCount"] for s in test["samples"])
    quantity_material = materials if test.get("reportFormVersion") == 2 else ""
    cell_text(
        metadata.cell(2, 0),
        f"样品名称：{materials}     样品状态：{states}     样品数量：{pools}样（{portions}份{quantity_material}）",
    )
    sample_element = next(t for t in tables[1:] if Table(t, document).cell(0, 0).text == "样本编号")
    source_map = {s["id"]: s for s in snapshot["batch"]["sources"]}
    replace_element(
        sample_element, [sample_table(sample_element, document, test["samples"], source_map, pcr=method == "pcr")]
    )
    if method.startswith("elisa"):
        kit_element = tables[1]
        replace_element(kit_element, [reagent_table(kit_element, document, test["projects"])])
    elif method == "pcr":
        for element in body:
            if element.tag != qn("w:p"):
                continue
            paragraph = Paragraph(element, document)
            if "{{kit}}" in paragraph.text:
                paragraph_text(
                    paragraph, "试剂盒名称：" + "；".join(dict.fromkeys(p.get("kit", "") for p in test["projects"]))
                )
            if "{{lot}}" in paragraph.text:
                paragraph_text(
                    paragraph, "试剂盒批号：" + "；".join(dict.fromkeys(p.get("lot", "") for p in test["projects"]))
                )
    pictures = next(
        t for t in tables[1:] if len(Table(t, document).columns) == 2 and not Table(t, document).cell(0, 0).text
    )
    entries = image_entries(test, snapshot["attachments"])
    replace_element(pictures, [image_table(pictures, document, entries, root, manifest["imageSizes"])])
    result_heading = next(el for el in body if el.tag == qn("w:p") and "实验结果统计表" in Paragraph(el, document).text)
    legend = next(el for el in body if el.tag == qn("w:p") and Paragraph(el, document).text.startswith("注："))
    region = body[body.index(result_heading) + 1 : body.index(legend)]
    heading_pattern = next(el for el in region if el.tag == qn("w:p") and Paragraph(el, document).text.strip())
    result_patterns = [el for el in region if el.tag == qn("w:tbl")]
    for element in region:
        element.getparent().remove(element)
    prefix = "6" if method == "pcr" else "5" if method.startswith("elisa") else "4"
    heading_paragraph = Paragraph(result_heading, document)
    paragraph_text(heading_paragraph, f"{prefix}、实验结果统计表")
    for numbering in result_heading.xpath("./w:pPr/w:numPr"):
        numbering.getparent().remove(numbering)
    for index, project in enumerate(test["projects"]):
        heading = copy_paragraph(heading_pattern, document, f"{prefix}-{index + 1}{project['name']}")
        Paragraph(heading, document).paragraph_format.keep_with_next = True
        legend.addprevious(heading)
        pattern = result_patterns[min(index, len(result_patterns) - 1)]
        for element in horizontal_result(pattern, document, project, test["samples"], controls=method != "parasite"):
            legend.addprevious(element)
    paragraph_text(Paragraph(legend, document), "注：“-”代表阴性，“＋”代表阳性，“±”代表可疑，“/”代表空白。")
    signature = next(el for el in body if el.tag == qn("w:p") and Paragraph(el, document).text.startswith("检测人："))
    # Empty filler paragraphs in the examples located the signature; dynamic content flows naturally instead.
    for element in body[body.index(legend) + 1 : body.index(signature)]:
        if element.tag == qn("w:p") and not Paragraph(element, document).text.strip():
            element.getparent().remove(element)
    if test.get("reportFormVersion") != 2 and test["conclusion"]:
        conclusion = copy_paragraph(legend, document, "结果判定：" + test["conclusion"])
        signature.addprevious(conclusion)
    if test.get("notes"):
        signature.addprevious(copy_paragraph(legend, document, "备注：" + test["notes"]))
    for attachment in snapshot["attachments"]:
        if not attachment["mime"].startswith("image/"):
            signature.addprevious(copy_paragraph(legend, document, "原始附件（系统留档）：" + attachment["name"]))
    # Keep the short closing block with its signature instead of orphaning the signature on a page.
    Paragraph(legend, document).paragraph_format.keep_with_next = True
    # Bring the final result table along when the closing block needs a new page.
    previous = legend.getprevious()
    while previous is not None:
        if previous.tag == qn("w:p"):
            Paragraph(previous, document).paragraph_format.keep_with_next = True
        elif previous.tag == qn("w:tbl"):
            for row in Table(previous, document).rows:
                for cell in row.cells:
                    for paragraph in cell.paragraphs:
                        paragraph.paragraph_format.keep_with_next = True
            break
        previous = previous.getprevious()
    closing = signature.getprevious()
    while closing is not None and closing is not legend:
        if closing.tag == qn("w:p"):
            Paragraph(closing, document).paragraph_format.keep_with_next = True
        closing = closing.getprevious()
    footer_label = "草稿 · 仅供预览" if draft else snapshot["number"]
    # Identification lives in the footer so the original title block and section order remain unchanged.
    for section in document.sections:
        for footer in (section.footer, section.first_page_footer, section.even_page_footer):
            paragraph = footer.paragraphs[0]
            paragraph.add_run(f"  {footer_label}  {snapshot['templateVersion']}")
    output = BytesIO()
    document.save(output)
    return output.getvalue()


def image_entries(test, attachments):
    images = sorted(
        [a for a in attachments if a["mime"].startswith("image/") and not a.get("removed")],
        key=lambda a: (a.get("position", 0), a.get("uploadedAt", a.get("updatedAt", "")), a["id"]),
    )
    entries, used = [], set()
    if test["method"] == "parasite":
        for sample in test["samples"]:
            grouped = [
                [a for a in images if a.get("sampleId") == sample["id"] and a.get("category") == category]
                for category in ("体外", "体内")
            ]
            for index in range(max(1, *(len(group) for group in grouped))):
                for category, group in zip(("体外", "体内"), grouped, strict=True):
                    attachment = group[index] if index < len(group) else None
                    if attachment:
                        used.add(attachment["id"])
                    entries.append(
                        {
                            "attachment": attachment,
                            "caption": " / ".join(
                                filter(
                                    None,
                                    [
                                        f"{sample['number']}{category}寄生虫",
                                        attachment.get("caption") if attachment else "",
                                    ],
                                )
                            ),
                        }
                    )
    for attachment in images:
        if attachment["id"] in used:
            continue
        project = "、".join(p["name"] for p in test["projects"] if p["id"] in project_ids(attachment))
        sample = next((s["number"] for s in test["samples"] if s["id"] == attachment.get("sampleId")), "")
        entries.append(
            {
                "attachment": attachment,
                "caption": " / ".join(
                    filter(None, [project or attachment["name"], sample, attachment.get("caption", "")])
                ),
            }
        )
    return entries
