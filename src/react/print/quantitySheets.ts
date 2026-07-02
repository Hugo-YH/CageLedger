import type { QuantitySheet, QuantitySheetRow } from "../api/contracts";

const DAYS_PER_PAGE = 31;
const LEFT_COLUMN_DAYS = 15;
const PRINT_ROWS = 16;

export function quantitySheetPagesMarkup(sheets: QuantitySheet[]) {
  return sheets
    .flatMap((sheet) => pagesForSheet(sheet).map((rows, pageIndex) => renderPage(sheet, rows, pageIndex)))
    .join("");
}

export function quantitySheetsPrintHtml(sheets: QuantitySheet[]) {
  return `<!doctype html><html lang="zh-CN"><head><meta charset="UTF-8"><title>实验动物数量统计表</title><style>${printStyles()}</style></head><body>${quantitySheetPagesMarkup(sheets)}<script>window.onload=()=>window.print()</script></body></html>`;
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
  const count = Math.max(sheet.pageCount || 1, Math.ceil(sheet.rows.length / DAYS_PER_PAGE), 1);
  const pages = Array.from({ length: count }, () => Array<QuantitySheetRow | null>(DAYS_PER_PAGE).fill(null));
  for (const row of sheet.rows) {
    const dayIndex = dayIndexInMonth(row.date, sheet.month);
    if (dayIndex >= 0) {
      let target = pages.find((page) => !page[dayIndex]);
      if (!target) {
        target = Array<QuantitySheetRow | null>(DAYS_PER_PAGE).fill(null);
        pages.push(target);
      }
      target[dayIndex] = row;
      continue;
    }
    let target = pages.find((page) => page.some((item) => !item));
    if (!target) {
      target = Array<QuantitySheetRow | null>(DAYS_PER_PAGE).fill(null);
      pages.push(target);
    }
    target[target.findIndex((item) => !item)] = row;
  }
  return pages.map((page) => fillCalendarPage(sheet, page));
}

function renderPage(sheet: QuantitySheet, rows: Array<QuantitySheetRow | null>, pageIndex: number) {
  const left = rows.slice(0, LEFT_COLUMN_DAYS);
  const right = rows.slice(LEFT_COLUMN_DAYS, DAYS_PER_PAGE);
  return `<section class="sheet-page"><div class="sheet-topline">中山大学中山眼科中心 实验动物中心</div><table class="sheet-table"><colgroup><col style="width:8%"><col style="width:11%"><col style="width:11%"><col style="width:6%"><col style="width:6%"><col style="width:10%"><col style="width:8%"><col style="width:11%"><col style="width:11%"><col style="width:6%"><col style="width:6%"><col style="width:10%"></colgroup>
<tr><th class="title" colspan="12">实验动物数量统计表</th></tr>
<tr><td class="note" colspan="8">备注：饲养费计算以此表动物数量为准，请如实填写。填写说明：购：购入　转：转移　分：分笼　取：取材或处理　死：死亡</td><td class="meta" colspan="2">房间号：${escapeHtml(sheet.roomName)}</td><td class="meta" colspan="2">管理员：${escapeHtml(sheet.manager)}</td></tr>
<tr><td class="label" colspan="2">IACUC编号</td><td colspan="2">${escapeHtml(sheet.iacuc)}</td><td class="label" colspan="2">项目负责人</td><td colspan="2">${escapeHtml(sheet.pi)}</td><td class="label" colspan="2">实验负责人及电话</td><td colspan="2">${escapeHtml(sheet.owner)}</td></tr>
<tr>${headers()}${headers()}</tr>${Array.from({ length: PRINT_ROWS }, (_, index) => `<tr>${dayCells(left[index] || null)}${dayCells(right[index] || null)}</tr>`).join("")}
<tr><td class="footer-row" colspan="12">项目名称：${escapeHtml(sheet.project)}${sheet.customBillingEnabled && sheet.customUnitPrice ? `　计费标准：自定义 ¥${sheet.customUnitPrice.toFixed(2)} / ${sheet.billingUnit === "animal_day" ? "只/天" : "笼/天"}` : ""}${sheet.pageCount > 1 ? `　（第 ${pageIndex + 1} 页）` : ""}</td></tr></table></section>`;
}

function fillCalendarPage(sheet: QuantitySheet, rows: Array<QuantitySheetRow | null>) {
  const days = daysInMonth(sheet.month);
  let animalCount = Number(sheet.initialAnimalCount || 0);
  let cageCount = Number(sheet.initialCageCount || 0);
  let balanceStarted = animalCount > 0 || cageCount > 0;
  return rows.map((row, dayIndex) => {
    if (dayIndex >= days) return null;
    if (row) {
      animalCount =
        row.animalCount == null
          ? Math.max(animalCount + Number(row.addedCount || 0) - Number(row.removedCount || 0), 0)
          : Number(row.animalCount);
      cageCount = row.cageCount == null ? cageCount : Number(row.cageCount);
      balanceStarted =
        balanceStarted ||
        Boolean(row.addedCount || row.removedCount || row.animalCount != null || row.cageCount != null);
    }
    return {
      ...(row || emptyPrintRow()),
      date: `${sheet.month}-${String(dayIndex + 1).padStart(2, "0")}`,
      rawDateInput: `${sheet.month}-${String(dayIndex + 1).padStart(2, "0")}`,
      animalCount: balanceStarted ? animalCount : null,
      cageCount: balanceStarted ? cageCount : null,
      handler: row?.handler || (balanceStarted ? sheet.manager : ""),
    };
  });
}

function emptyPrintRow(): QuantitySheetRow {
  return {
    id: "",
    date: "",
    rawDateInput: "",
    addedCount: null,
    addedType: "",
    transferInFromIacuc: "",
    removedCount: null,
    removedType: "",
    transferOutToIacuc: "",
    animalCount: null,
    cageCount: null,
    handler: "",
    balanceSource: "auto",
    notes: "",
  };
}

function dayIndexInMonth(value: string, month: string) {
  const match = value.match(/^(\d{4}-\d{2})-(\d{2})$/);
  if (!match || match[1] !== month) return -1;
  const day = Number(match[2]);
  return day >= 1 && day <= daysInMonth(month) ? day - 1 : -1;
}

function daysInMonth(month: string) {
  const [year, value] = month.split("-").map(Number);
  return year && value ? new Date(year, value, 0).getDate() : 31;
}

function headers() {
  return "<td>日期</td><td>新增（购/转/分）</td><td>减少（取/死/转）</td><td>结余总数</td><td>结余笼数</td><td>经手人</td>";
}
function dayCells(row: QuantitySheetRow | null) {
  if (!row) return "<td></td><td></td><td></td><td></td><td></td><td></td>";
  return `<td>${escapeHtml(formatDate(row.date))}</td><td>${escapeHtml(formatChange(row.addedCount, row.addedType, row.transferInFromIacuc, "转入"))}</td><td>${escapeHtml(formatChange(row.removedCount, row.removedType, row.transferOutToIacuc, "转出"))}</td><td class="num">${row.animalCount ?? ""}</td><td class="num">${row.cageCount ?? ""}</td><td>${escapeHtml(row.handler || "")}</td>`;
}
function formatChange(count: number | null, type: string, transfer: string, transferType: string) {
  if (!count) return "";
  const short =
    ({ 购入: "购", 转入: "转", 分笼: "分", 取材: "取", 死亡: "死", 转出: "转" } as Record<string, string>)[type] ||
    type;
  return `${count}${short ? `（${short}${type === transferType && transfer ? ` ${transfer}` : ""}）` : ""}`;
}
function formatDate(value: string) {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return match ? `${Number(match[1])}.${Number(match[2])}.${Number(match[3])}` : value;
}
function escapeHtml(value: unknown) {
  return String(value || "").replace(
    /[&<>"']/g,
    (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character] || character,
  );
}
function printStyles() {
  return `@page{size:A4 portrait;margin:10mm}*{box-sizing:border-box}body{margin:0;color:#000;background:#fff;font-family:"Arial","Helvetica Neue","Noto Sans SC","PingFang SC","Microsoft YaHei",sans-serif;font-size:9px}.sheet-page{min-height:276mm;page-break-after:always}.sheet-page:last-child{page-break-after:auto}.sheet-topline{font-size:8px;margin-bottom:4px}.sheet-table{border-collapse:collapse;width:100%;table-layout:fixed}.sheet-table th,.sheet-table td{border:1px solid #000;padding:3px 4px;text-align:center;vertical-align:middle;word-break:break-all}.sheet-table .title{font-size:18px;padding:8px 0;font-weight:700}.sheet-table .note{color:#c80000;font-weight:700;text-align:left;line-height:1.35}.sheet-table .meta,.sheet-table .label,.sheet-table .footer-row{font-weight:700}.sheet-table .footer-row{text-align:left;height:26px}.sheet-table .num{font-variant-numeric:tabular-nums}@media print{body{print-color-adjust:exact;-webkit-print-color-adjust:exact}}`;
}
