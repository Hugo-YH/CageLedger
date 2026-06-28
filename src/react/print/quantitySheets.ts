import type { QuantitySheet, QuantitySheetRow } from "../api/contracts";

export function quantitySheetPagesMarkup(sheets: QuantitySheet[]) {
  return sheets.flatMap((sheet) => pagesForSheet(sheet).map((rows, pageIndex) => renderPage(sheet, rows, pageIndex))).join("");
}

export function quantitySheetsPrintHtml(sheets: QuantitySheet[]) {
  return `<!doctype html><html lang="zh-CN"><head><meta charset="UTF-8"><title>实验动物数量统计表</title><style>${printStyles()}</style></head><body>${quantitySheetPagesMarkup(sheets)}<script>window.onload=()=>window.print()<\/script></body></html>`;
}

export function openQuantitySheetsPrint(sheets: QuantitySheet[]) {
  if (!sheets.length) return false;
  const popup = window.open("", "_blank");
  if (!popup) return false;
  popup.document.write(quantitySheetsPrintHtml(sheets));
  popup.document.close();
  return true;
}

function pagesForSheet(sheet: QuantitySheet) {
  const count = Math.max(sheet.pageCount || 1, Math.ceil(sheet.rows.length / 30), 1);
  return Array.from({ length: count }, (_, pageIndex) => Array.from({ length: 30 }, (_, rowIndex) => sheet.rows[pageIndex * 30 + rowIndex] || null));
}

function renderPage(sheet: QuantitySheet, rows: Array<QuantitySheetRow | null>, pageIndex: number) {
  const left = rows.slice(0, 15);
  const right = rows.slice(15, 30);
  return `<section class="sheet-page"><div class="sheet-topline">中山大学中山眼科中心 实验动物中心</div><table class="sheet-table"><colgroup><col style="width:8%"><col style="width:11%"><col style="width:11%"><col style="width:6%"><col style="width:6%"><col style="width:10%"><col style="width:8%"><col style="width:11%"><col style="width:11%"><col style="width:6%"><col style="width:6%"><col style="width:10%"></colgroup>
<tr><th class="title" colspan="12">实验动物数量统计表</th></tr>
<tr><td class="note" colspan="8">备注：饲养费计算以此表动物数量为准，请如实填写。填写说明：购：购入　转：转移　分：分笼　取：取材或处理　死：死亡</td><td class="meta" colspan="2">房间号：${escapeHtml(sheet.roomName)}</td><td class="meta" colspan="2">管理员：${escapeHtml(sheet.manager)}</td></tr>
<tr><td class="label" colspan="2">IACUC编号</td><td colspan="2">${escapeHtml(sheet.iacuc)}</td><td class="label" colspan="2">项目负责人</td><td colspan="2">${escapeHtml(sheet.pi)}</td><td class="label" colspan="2">实验负责人及电话</td><td colspan="2">${escapeHtml(sheet.owner)}</td></tr>
<tr>${headers()}${headers()}</tr>${left.map((row, index) => `<tr>${dayCells(row)}${dayCells(right[index])}</tr>`).join("")}
<tr><td class="footer-row" colspan="12">项目名称：${escapeHtml(sheet.project)}${sheet.pageCount > 1 ? `　（第 ${pageIndex + 1} 页）` : ""}</td></tr></table></section>`;
}

function headers() { return "<td>日期</td><td>新增（购/转/分）</td><td>减少（取/死/转）</td><td>结余总数</td><td>结余笼数</td><td>经手人</td>"; }
function dayCells(row: QuantitySheetRow | null) {
  if (!row) return "<td></td><td></td><td></td><td></td><td></td><td></td>";
  return `<td>${escapeHtml(formatDate(row.date))}</td><td>${escapeHtml(formatChange(row.addedCount, row.addedType, row.transferInFromIacuc, "转入"))}</td><td>${escapeHtml(formatChange(row.removedCount, row.removedType, row.transferOutToIacuc, "转出"))}</td><td class="num">${row.animalCount ?? ""}</td><td class="num">${row.cageCount ?? ""}</td><td>${escapeHtml(row.handler || "")}</td>`;
}
function formatChange(count: number | null, type: string, transfer: string, transferType: string) { if (!count) return ""; const short = ({ "购入": "购", "转入": "转", "分笼": "分", "取材": "取", "死亡": "死", "转出": "转" } as Record<string, string>)[type] || type; return `${count}${short ? `（${short}${type === transferType && transfer ? ` ${transfer}` : ""}）` : ""}`; }
function formatDate(value: string) { const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/); return match ? `${Number(match[1])}.${Number(match[2])}.${Number(match[3])}` : value; }
function escapeHtml(value: unknown) { return String(value || "").replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character] || character); }
function printStyles() { return `@page{size:A4 portrait;margin:10mm}*{box-sizing:border-box}body{margin:0;color:#000;background:#fff;font-family:"Arial","Helvetica Neue","Noto Sans SC","PingFang SC","Microsoft YaHei",sans-serif;font-size:9px}.sheet-page{min-height:276mm;page-break-after:always}.sheet-page:last-child{page-break-after:auto}.sheet-topline{font-size:8px;margin-bottom:4px}.sheet-table{border-collapse:collapse;width:100%;table-layout:fixed}.sheet-table th,.sheet-table td{border:1px solid #000;padding:3px 4px;text-align:center;vertical-align:middle;word-break:break-all}.sheet-table .title{font-size:18px;padding:8px 0;font-weight:700}.sheet-table .note{color:#c80000;font-weight:700;text-align:left;line-height:1.35}.sheet-table .meta,.sheet-table .label,.sheet-table .footer-row{font-weight:700}.sheet-table .footer-row{text-align:left;height:26px}.sheet-table .num{font-variant-numeric:tabular-nums}@media print{body{print-color-adjust:exact;-webkit-print-color-adjust:exact}}`; }
