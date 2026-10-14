"""A4 technical service statements; the first page total includes all pages."""

from html import escape

FACILITIES = {"zhujiang": "珠江新城", "bioisland": "生物岛"}


def technical_service_markup(statement):
    rows = statement.get("technicalServiceRows", [])
    pages = [rows[i : i + 15] for i in range(0, len(rows), 15)] or [[]]
    body = []
    for index, page in enumerate(pages):
        table = "".join(
            "<tr>"
            + "".join(
                f"<td>{escape(str(v))}</td>"
                for v in (
                    r["date"],
                    r["iacuc"],
                    FACILITIES.get(r["facility"], r["facility"]),
                    r["serviceName"],
                    f"{r['quantity']:g}",
                    r["unit"],
                    f"{r['unitPrice']:.2f}",
                    f"{r['amount']:.2f}",
                )
            )
            + "</tr>"
            for r in page
        )
        body.append(f"""<section class="technical-service-print-page">
            <h1>实验动物技术服务费结算单</h1>
            <p>项目负责人：{escape(str(statement.get("pi", "")))}　月份：{escape(str(statement.get("month", "")))}</p>
            <p>单据编号：{escape(str(statement.get("documentNumber", "预览")))}</p>
            <p>服务日数：{statement.get("serviceDayCount", 0)}　合计：{statement.get("totalAmount", 0):.2f} 元</p>
            <table><thead><tr><th>日期</th><th>IACUC</th><th>设施</th><th>服务项目</th><th>数量</th><th>单位</th><th>单价</th><th>金额</th></tr></thead>
            <tbody>{table}</tbody></table><p>项目负责人确认签名：________________</p>
            <footer>第 {index + 1} / {len(pages)} 页</footer></section>""")
    return "".join(body)


def technical_service_styles():
    return """@page{size:A4;margin:12mm}body{font-family:'Noto Sans CJK SC',sans-serif;font-size:11px;color:#111}
        .technical-service-print-page{break-after:page}.technical-service-print-page:last-child{break-after:auto}
        h1{text-align:center;font-size:20px}table{border-collapse:collapse;width:100%;table-layout:fixed}
        th,td{border:1px solid #444;padding:4px;overflow-wrap:anywhere;font-size:11px;line-height:1.3}th:first-child{width:13%}th:nth-child(2){width:15%}th:nth-child(3){width:9%}th:nth-child(4){width:25%}th:nth-child(5),th:nth-child(6){width:8%}th:nth-child(7),th:nth-child(8){width:11%}td:first-child{white-space:nowrap}
        tr{break-inside:avoid}footer{text-align:right;margin-top:12px}"""
