"""Printable animal-inspection report shared by the server PDF endpoint."""

from html import escape

from server_app.pdf.documents import document_html
from server_app.pdf.renderer import html_to_pdf


def render_animal_inspection_pdf(detail):
    return html_to_pdf(animal_inspection_html(detail))


def animal_inspection_html(detail):
    item = detail["item"]
    nodes = {str(node.get("code")): node for node in detail["catalog"].get("nodes") or []}
    answers_by_module = {}
    for answer in detail.get("answers") or []:
        answers_by_module.setdefault(answer["module_code"], []).append(answer)
    sections = []
    for module in detail["catalog"].get("modules") or []:
        code = str(module.get("code") or "")
        answers = answers_by_module.get(code, [])
        if not answers:
            continue
        rows = "".join(
            f"<tr><td>{h(nodes.get(answer['node_code'], {}).get('name') or answer['node_code'])}</td>"
            f'<td class="center">{h(answer["score"])}</td><td>{h(answer.get("sub_option") or "")}</td>'
            f"<td>{h(answer.get('note') or '')}</td></tr>"
            for answer in answers
        )
        sections.append(
            f'<section class="module"><h2>{h(module.get("name"))}</h2>'
            "<table><thead><tr><th>评估项目</th><th>评分</th><th>子选项</th><th>备注</th></tr></thead>"
            f"<tbody>{rows}</tbody></table></section>"
        )
    finding_rows = (
        "".join(
            f"<tr><td>{h(nodes.get(finding['nodeCode'], {}).get('name') or finding['nodeCode'])}</td>"
            f"<td>{'严重' if finding['severity'] == 1 else '轻微'}</td><td>{h(finding.get('status'))}</td>"
            f"<td>{h(finding.get('locationHint'))}</td><td>{h(finding.get('actionNote'))}</td>"
            f"<td>{h(finding.get('recheckDueAt'))}</td></tr>"
            for finding in detail.get("findings") or []
        )
        or '<tr><td colspan="6" class="center">本次巡检未发现需要处置的评分异常</td></tr>'
    )
    snapshot = item.get("snapshot") or {}
    body = f"""
<section class=\"cover\"><div class=\"kicker\">CageLedger 实验动物中心</div><h1>实验动物巡检报告</h1>
<table class=\"meta\"><tbody>
<tr><th>巡检编号</th><td>{h(item.get("id"))}</td><th>巡检状态</th><td>{"已提交" if item.get("status") == "submitted" else "草稿"}</td></tr>
<tr><th>饲养间</th><td>{h(item.get("roomName"))}</td><th>设施</th><td>{h(item.get("facility"))}</td></tr>
<tr><th>巡检人</th><td>{h(item.get("createdByName"))}</td><th>提交时间</th><td>{h(item.get("submittedAt") or item.get("updatedAt"))}</td></tr>
<tr><th>IACUC</th><td>{h("、".join(snapshot.get("iacucs") or []))}</td><th>项目负责人</th><td>{h("、".join(snapshot.get("pis") or []))}</td></tr>
</tbody></table></section>
{"".join(sections)}
<section class=\"module\"><h2>异常处置与复查</h2><table><thead><tr><th>异常项目</th><th>等级</th><th>状态</th><th>定位</th><th>处置措施</th><th>复查日期</th></tr></thead><tbody>{finding_rows}</tbody></table></section>
<p class=\"notice\">评分标准、图例和建议处置为内部参考资料；医疗与安乐死措施经兽医和伦理流程确认后执行。</p>"""
    return document_html("实验动物巡检报告", styles(), body)


def styles():
    return """
@page { size: A4; margin: 14mm 12mm; }
* { box-sizing: border-box; } body { color: #16262c; font-family: 'Noto Sans CJK SC', 'Microsoft YaHei', sans-serif; font-size: 10pt; }
h1 { margin: 3mm 0 7mm; font-size: 22pt; text-align: center; } h2 { margin: 8mm 0 3mm; color: #0b625d; font-size: 14pt; }
.kicker { color: #0b7a71; font-size: 9pt; text-align: center; } table { border-collapse: collapse; width: 100%; table-layout: fixed; } th, td { border: 1px solid #304a4f; padding: 5px; vertical-align: top; word-break: break-word; } th { background: #eaf4f1; } .meta th { width: 14%; } .meta td { width: 36%; } .center { text-align: center; } .notice { margin-top: 8mm; color: #5d696d; font-size: 9pt; } .module { break-inside: avoid; }
"""


def h(value):
    return escape(str(value or ""))
