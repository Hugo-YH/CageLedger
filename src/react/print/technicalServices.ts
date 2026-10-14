import type { BillingStatement, BillingStatementResponse } from "../../contracts/billing";
import { escapeHtml } from "./settlementSupport";

export function technicalServiceStyles() {
  return `@page{size:A4;margin:12mm}body{font-family:'Noto Sans CJK SC',sans-serif;font-size:11px;color:#111}.technical-service-print-page{break-after:page}.technical-service-print-page:last-child{break-after:auto}h1{text-align:center;font-size:20px}table{border-collapse:collapse;width:100%;table-layout:fixed}th,td{border:1px solid #444;padding:4px;overflow-wrap:anywhere;font-size:11px;line-height:1.3}th:first-child{width:13%}th:nth-child(2){width:15%}th:nth-child(3){width:9%}th:nth-child(4){width:25%}th:nth-child(5),th:nth-child(6){width:8%}th:nth-child(7),th:nth-child(8){width:11%}td:first-child{white-space:nowrap}tr{break-inside:avoid}footer{text-align:right;margin-top:12px}`;
}

export function technicalServiceMarkup(statement: BillingStatement) {
  const rows = statement.technicalServiceRows ?? [];
  const pages = Array.from({ length: Math.max(1, Math.ceil(rows.length / 15)) }, (_, i) =>
    rows.slice(i * 15, (i + 1) * 15),
  );
  return pages
    .map(
      (page, index) =>
        `<section class="technical-service-print-page"><h1>实验动物技术服务费结算单</h1><p>项目负责人：${escapeHtml(statement.pi)}　月份：${escapeHtml(statement.month)}</p><p>单据编号：${escapeHtml(statement.documentNumber || "预览")}</p><p>服务日数：${statement.serviceDayCount ?? 0}　合计：${statement.totalAmount.toFixed(2)} 元</p><table><thead><tr><th>日期</th><th>IACUC</th><th>设施</th><th>服务项目</th><th>数量</th><th>单位</th><th>单价</th><th>金额</th></tr></thead><tbody>${page.map((r) => `<tr>${[r.date, r.iacuc, r.facility === "zhujiang" ? "珠江新城" : "生物岛", r.serviceName, r.quantity, r.unit, r.unitPrice.toFixed(2), r.amount.toFixed(2)].map((v) => `<td>${escapeHtml(String(v))}</td>`).join("")}</tr>`).join("")}</tbody></table><p>项目负责人确认签名：________________</p><footer>第 ${index + 1} / ${pages.length} 页</footer></section>`,
    )
    .join("");
}

export function technicalServiceHtml(result: BillingStatementResponse, autoPrint: boolean) {
  return `<!doctype html><html lang="zh-CN"><head><meta charset="UTF-8"><title>${escapeHtml(result.statement.pi)}技术服务费结算单</title><style>${technicalServiceStyles()}</style></head><body>${technicalServiceMarkup(result.statement)}${autoPrint ? "<script>window.onload=()=>window.print()</script>" : ""}</body></html>`;
}
