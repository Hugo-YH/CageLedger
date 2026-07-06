import type { BillingStatementResponse } from "../api/contracts";

export function displayUnitLabel(unit: string) {
  if (unit === "animal_day") return "只/天";
  if (unit === "cage_day") return "笼/天";
  return "混合";
}

export function normalizeIacuc(value: unknown) {
  return String(value || "")
    .trim()
    .toUpperCase();
}

export function documentNumberFor(statement: { sourceType: string; month: string; id?: string }) {
  const source = statement.sourceType.includes("quantity_sheet") ? "QS" : "CM";
  return `CL-${source}-${statement.month.replace(/\D/g, "")}-${String(statement.id || "PREVIEW")
    .replace(/[^a-z0-9-]/gi, "")
    .toUpperCase()}`;
}

export function settlementStatementDocumentTitle(result: BillingStatementResponse) {
  const pi = String(result.statement.pi || "未命名课题组").trim();
  const month = String(result.statement.month || "").trim();
  const monthLabel = month ? `${month.slice(0, 4)}年${month.slice(5, 7)}月` : "";
  return `${pi}课题组实验动物饲养费核算汇总表${monthLabel ? ` ${monthLabel}` : ""}`;
}

export function numberText(value: unknown) {
  const number = Number(value || 0);
  return number ? String(Number(number.toFixed(2))) : "";
}

export function money(value: unknown) {
  return Number(value || 0).toFixed(2);
}

export function escapeHtml(value: unknown) {
  return String(value || "").replace(
    /[&<>"']/g,
    (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character] || character,
  );
}

export function settlementPrintStyles() {
  return `@page{size:A4;margin:10mm}*{box-sizing:border-box}body{color:#111;font-family:"Arial","Helvetica Neue","Noto Sans SC","PingFang SC","Microsoft YaHei",sans-serif;font-size:8.4px;line-height:1.2;margin:0;background:#fff}.document{max-width:190mm;min-height:277mm;margin:0 auto}.document-page-break{page-break-after:always;break-after:page}.header{border:1px solid #000;padding:6px 8px}.header-grid{display:block}.header-main{display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center}h1{font-size:15px;line-height:1.1;margin:0 0 4px;display:flex;align-items:flex-end;justify-content:center;gap:8px;flex-wrap:wrap}.meta{display:grid;grid-template-columns:repeat(3,max-content);justify-content:center;gap:2px 10px;margin-top:4px}.meta-table,.summary-table,.sign-table{border-collapse:collapse;width:100%;table-layout:fixed;margin-top:6px}.meta-table td,.summary-table th,.summary-table td,.sign-table td{border:1px solid #000;padding:3px 4px;vertical-align:middle}.meta-table td{text-align:left}.summary-table th,.summary-table td{text-align:center}.summary-table td:first-child,.summary-table .row-label,.summary-table .meta-summary,.sign-table td{text-align:left}.summary-table .date-column{text-align:center;white-space:nowrap;width:16mm;min-width:16mm;max-width:16mm}.summary-table td:first-child{white-space:nowrap;width:16mm;min-width:16mm;max-width:16mm}.summary-table th{line-height:1.15}.summary-table thead th{white-space:nowrap;text-align:center;vertical-align:middle}.summary-table thead tr:nth-child(2) th{font-size:7.5px;line-height:1.05;padding:2px 1px}.summary-table tbody td{height:7mm}.summary-table tfoot td{font-weight:700}.summary-table .row-label-summary{line-height:1.3;white-space:normal}.summary-table .summary-total-money{vertical-align:middle;text-align:center}.summary-table .meta-summary{line-height:1.35;padding-top:5px;padding-bottom:5px;white-space:normal}.summary-table .meta-summary span{display:block}.summary-table .meta-summary-empty{background:#fff}.summary-table .col-date{width:8.4%;min-width:8.4%;max-width:8.4%}.summary-table .col-group{width:1.526667%}.summary-table .column-empty{color:transparent}.summary-table .group-empty-cell{background:#fff}.note-line{border:1px solid #000;border-top:0;min-height:30px;padding:5px 6px}.sign-table td{height:12mm;vertical-align:top;padding-top:4px}.page-footer{margin-top:4px;text-align:center;font-size:9px;font-weight:700}.num,.money{font-variant-numeric:tabular-nums}.money{white-space:nowrap}@media print{body{font-size:8px;print-color-adjust:exact;-webkit-print-color-adjust:exact}.meta-table td,.summary-table th,.summary-table td,.sign-table td{padding:2px 3px}.summary-table thead tr:nth-child(2) th{font-size:7.1px;padding:1px 1px}.summary-table tbody td{height:6.5mm}.summary-table .meta-summary{padding-top:4px;padding-bottom:4px}}`;
}

export function resolveDisplayLineCount(
  line: { animalCount?: number; cageCount?: number },
  unit: string,
  counts: Array<{ count: number }>,
) {
  if (unit === "animal_day") return Number(line.animalCount || 0);
  if (unit === "cage_day") return Number(line.cageCount || 0);
  return counts.reduce((sum, item) => sum + item.count, 0);
}

export function resolveDisplayTotalCount(
  statement: { totalAnimalDays?: number; totalCageDays?: number },
  unit: string,
  totals: Array<{ count: number }>,
) {
  if (unit === "animal_day") return Number(statement.totalAnimalDays || 0);
  if (unit === "cage_day") return Number(statement.totalCageDays || 0);
  return totals.reduce((sum, item) => sum + item.count, 0);
}
