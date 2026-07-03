import type { BillingStatement, BillingStatementLine, BillingStatementResponse } from "../api/contracts";
import { qrCodeSvg } from "./qrCode";

type Breakdown = {
  iacuc?: string;
  animalCount?: number;
  cageCount?: number;
  freeCages?: number;
  billingItem?: string;
  billingUnit?: string;
  customerType?: string;
  unitPrice?: number;
  overageUnitPrice?: number;
  tiered?: boolean;
  freeAllowance?: boolean;
};

export function settlementStatementMarkup(result: BillingStatementResponse) {
  const { statement } = result;
  const lines = result.lines.filter((line) => line.animalCount || line.cageCount || line.amount);
  const unit = resolveUnit(statement, lines);
  const iacucs = collectIacucs(statement, lines);
  const model = lines.map((line) => modelLine(line, iacucs, unit));
  const totals = iacucs.map((iacuc) =>
    model.reduce(
      (sum, row) => {
        const item = row.perIacuc.get(iacuc);
        return {
          count: sum.count + (item?.count || 0),
          free: sum.free + (item?.free || 0),
          amount: sum.amount + (item?.amount || 0),
        };
      },
      { count: 0, free: 0, amount: 0 },
    ),
  );
  const hasTieredCharges = Number(statement.totalTier2CageDays || 0) > 0;
  const iacucColumns = iacucs.map((iacuc, index) => ({
    iacuc,
    showFree: totals[index].free > 0,
    span: totals[index].free > 0 ? 3 : 2,
  }));
  const leadingColumnCount = hasTieredCharges ? 4 : 3;
  const tableColumnCount = leadingColumnCount + iacucColumns.reduce((sum, column) => sum + column.span, 0);
  const documentNumber = statement.documentNumber || documentNumberFor(statement);
  const lookupUrl = `${window.location.origin}${window.location.pathname}?s=${encodeURIComponent(documentNumber)}`;
  const titleSuffix =
    unit === "cage_day" && Number(statement.freeCageAllowance || 0) > 0
      ? `（减免${numberText(statement.freeCageAllowance)}笼）`
      : "";
  const title = `${escapeHtml(statement.pi || "-")}课题组实验动物饲养费核算汇总表${titleSuffix}`;
  const columns = iacucColumns
    .map(
      ({ iacuc, span }, index) =>
        `<th colspan="${span}">${escapeHtml(index === 0 && hasTieredCharges ? `${iacuc}（梯度收费）` : iacuc)}</th>`,
    )
    .join("");
  const subColumns = iacucColumns
    .map(
      ({ showFree }) =>
        `<th>${unit === "animal_day" ? "数量" : "笼数"}</th>${showFree ? "<th>减免</th>" : ""}<th>缴纳（元）</th>`,
    )
    .join("");
  const detailRows = model
    .map(
      (row) =>
        `<tr><td>${escapeHtml(row.date)}</td><td class="num">${numberText(row.totalCount)}</td><td class="num">${numberText(row.totalFree)}</td>${hasTieredCharges ? `<td class="num">${numberText(row.totalTier2)}</td>` : ""}${iacucColumns
          .map(({ iacuc, showFree }) => {
            const item = row.perIacuc.get(iacuc) || { count: 0, free: 0, amount: 0 };
            const dailyAmount = item.count > 0 ? money(item.amount) : "";
            return `<td class="num">${numberText(item.count)}</td>${showFree ? `<td class="num">${numberText(item.free)}</td>` : ""}<td class="money">${dailyAmount}</td>`;
          })
          .join("")}</tr>`,
    )
    .join("");
  const detailTotals = totals
    .map(
      (item, index) =>
        `<td class="num">${numberText(item.count)}</td>${iacucColumns[index].showFree ? `<td class="num">${numberText(item.free)}</td>` : ""}<td class="money">${money(item.amount)}</td>`,
    )
    .join("");
  const totalCount = unit === "animal_day" ? statement.totalAnimalDays : statement.totalCageDays;
  return `<main class="document"><section class="header"><div class="header-grid"><div><h1>${title}</h1><p class="subtitle">实验动物中心</p><div class="meta"><div>单据编号：${escapeHtml(documentNumber)}</div><div>结算月份：${escapeHtml(statement.month)}</div><div>项目负责人：${escapeHtml(statement.pi)}</div></div></div><div class="qr-box">${qrCodeSvg(lookupUrl, "结算单二维码")}<span>扫码访问在线单据</span></div></div></section>
<table class="meta-table"><tbody><tr><td>出具科室：实验动物中心</td><td>计费单位：${unit === "animal_day" ? "只/天" : "笼/天"}</td><td>实验负责人：${escapeHtml(statement.owner || "-")}</td><td>支撑经费：${escapeHtml(statement.funding || "-")}</td></tr><tr><td colspan="4">IACUC 编号：${escapeHtml(iacucs.join("、") || "-")}</td></tr></tbody></table>
<table class="summary-table"><thead><tr><th class="date-column" rowspan="2">日期</th><th rowspan="2">${unit === "animal_day" ? "总数量" : "总笼数"}</th><th rowspan="2">减免总${unit === "animal_day" ? "数量" : "笼数"}</th>${hasTieredCharges ? `<th rowspan="2">梯度${unit === "animal_day" ? "数量" : "笼数"}</th>` : ""}${columns}</tr><tr>${subColumns}</tr></thead><tbody>${detailRows}</tbody><tfoot><tr><td class="row-label">单项合计</td><td class="num">${numberText(totalCount)}</td><td class="num">${numberText(statement.totalFreeCageDays)}</td>${hasTieredCharges ? `<td class="num">${numberText(statement.totalTier2CageDays)}</td>` : ""}${detailTotals}</tr><tr><td class="row-label">本月待缴纳饲养费总计（元）</td><td colspan="${leadingColumnCount - 1}" class="money">${money(statement.totalAmount)}</td>${totals.map((item, index) => `<td colspan="${iacucColumns[index].span}" class="meta-summary">单位支持 ${money(item.free * 4.5)} ／ 实际待缴纳 ${money(item.amount)}</td>`).join("")}</tr><tr><td class="row-label">未缴纳月份</td><td colspan="${tableColumnCount - 1}">　　　　　　　　　　　　　　未缴纳饲养费总计（元）：　　　　　　　　　　　　　　</td></tr></tfoot></table>
<div class="note-line">说明：</div><table class="sign-table"><tbody><tr><td>项目负责人</td><td>实验负责人/经办人</td><td>日期</td></tr></tbody></table><footer class="footer"><span>CageLedger · Apache-2.0</span><span>${escapeHtml(documentNumber)}</span></footer></main>`;
}

export function settlementStatementHtml(result: BillingStatementResponse, autoPrint = true) {
  const title = settlementStatementDocumentTitle(result);
  return `<!doctype html><html lang="zh-CN"><head><meta charset="UTF-8"><title>${escapeHtml(title)}</title><style>${styles()}</style></head><body>${settlementStatementMarkup(result)}${autoPrint ? "<script>window.onload=()=>window.print()</script>" : ""}</body></html>`;
}

export function openSettlementPrint(result: BillingStatementResponse) {
  const popup = window.open("", "_blank");
  if (!popup) return false;
  popup.document.write(settlementStatementHtml(result));
  popup.document.close();
  return true;
}

function modelLine(line: BillingStatementLine, iacucs: string[], unit: string) {
  const perIacuc = new Map(iacucs.map((iacuc) => [iacuc, { count: 0, free: 0, amount: 0 }]));
  const groups = new Map<
    string,
    {
      unitPrice: number;
      overageUnitPrice: number;
      tiered: boolean;
      counts: Map<string, number>;
      free: Map<string, number>;
    }
  >();
  for (const raw of line.iacucBreakdown || []) {
    const item = raw as Breakdown;
    const iacuc = normalizeIacuc(item.iacuc);
    if (!iacuc || !perIacuc.has(iacuc)) continue;
    const count = Number(unit === "animal_day" ? item.animalCount || 0 : item.cageCount || 0);
    const key = [
      item.billingItem,
      item.customerType,
      item.billingUnit,
      item.unitPrice,
      item.overageUnitPrice,
      item.tiered ? 1 : 0,
      item.freeAllowance ? 1 : 0,
    ].join("|");
    const group = groups.get(key) || {
      unitPrice: Number(item.unitPrice || 0),
      overageUnitPrice: Number(item.overageUnitPrice || 6.5),
      tiered: Boolean(item.tiered),
      counts: new Map(),
      free: new Map(),
    };
    group.counts.set(iacuc, (group.counts.get(iacuc) || 0) + count);
    group.free.set(iacuc, (group.free.get(iacuc) || 0) + Number(item.freeCages || 0));
    groups.set(key, group);
  }
  for (const group of groups.values()) {
    let remainingTier1 = group.tiered ? 160 : 0;
    for (const iacuc of iacucs) {
      const count = group.counts.get(iacuc) || 0;
      if (!count) continue;
      const current = perIacuc.get(iacuc)!;
      const free = Math.min(group.free.get(iacuc) || 0, count);
      const billable = Math.max(count - free, 0);
      const tier1 = group.tiered ? Math.min(remainingTier1, billable) : 0;
      const tier2 = group.tiered ? Math.max(billable - tier1, 0) : 0;
      remainingTier1 -= tier1;
      current.count += count;
      current.free += free;
      current.amount += group.tiered
        ? tier1 * group.unitPrice + tier2 * group.overageUnitPrice
        : billable * group.unitPrice;
    }
  }
  return {
    date: line.date,
    amount: Number(line.amount || 0),
    totalCount: unit === "animal_day" ? Number(line.animalCount || 0) : Number(line.cageCount || 0),
    totalFree: Number(line.freeCages || 0),
    totalTier2: Number(line.tier2BillableCages || 0),
    perIacuc,
  };
}

function collectIacucs(statement: BillingStatement, lines: BillingStatementLine[]) {
  const found = new Set((statement.iacucs || []).map(normalizeIacuc).filter(Boolean));
  lines.forEach((line) =>
    (line.iacucBreakdown || []).forEach((item) => {
      const value = normalizeIacuc((item as Breakdown).iacuc);
      if (value) found.add(value);
    }),
  );
  return [...found].sort((a, b) => a.localeCompare(b, "zh-CN"));
}
function resolveUnit(statement: BillingStatement, lines: BillingStatementLine[]) {
  if (statement.billingUnit && statement.billingUnit !== "mixed") return statement.billingUnit;
  return lines.some((line) => line.animalCount > 0 && !line.cageCount) ? "animal_day" : "cage_day";
}
function normalizeIacuc(value: unknown) {
  return String(value || "")
    .trim()
    .toUpperCase();
}
function documentNumberFor(statement: BillingStatement) {
  const source = statement.sourceType.includes("quantity_sheet") ? "QS" : "CM";
  return `CL-${source}-${statement.month.replace(/\D/g, "")}-${String(statement.id || "PREVIEW")
    .replace(/[^a-z0-9-]/gi, "")
    .toUpperCase()}`;
}
function settlementStatementDocumentTitle(result: BillingStatementResponse) {
  const pi = String(result.statement.pi || "未命名课题组").trim();
  const month = String(result.statement.month || "").trim();
  const monthLabel = month ? `${month.slice(0, 4)}年${month.slice(5, 7)}月` : "";
  return `${pi}课题组实验动物饲养费核算汇总表${monthLabel ? ` ${monthLabel}` : ""}`;
}
function numberText(value: unknown) {
  const number = Number(value || 0);
  return number ? String(Number(number.toFixed(2))) : "";
}
function money(value: unknown) {
  return Number(value || 0).toFixed(2);
}
function escapeHtml(value: unknown) {
  return String(value || "").replace(
    /[&<>"']/g,
    (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character] || character,
  );
}
function styles() {
  return `@page{size:A4;margin:10mm}*{box-sizing:border-box}body{color:#111;font-family:"Arial","Helvetica Neue","Noto Sans SC","PingFang SC","Microsoft YaHei",sans-serif;font-size:8.4px;line-height:1.2;margin:0;background:#fff}.document{max-width:190mm;min-height:277mm;margin:0 auto}.header{border:1px solid #000;padding:6px 8px}.header-grid{display:flex;justify-content:space-between;gap:10px}h1{font-size:15px;line-height:1.1;margin:0 0 4px}.subtitle{margin:0}.meta{display:grid;grid-template-columns:repeat(3,max-content);gap:2px 10px;margin-top:4px}.qr-box{display:grid;justify-items:center;gap:2px;text-align:center}.qr-box svg{width:20mm;height:20mm}.meta-table,.summary-table,.sign-table{border-collapse:collapse;width:100%;table-layout:fixed;margin-top:6px}.meta-table td,.summary-table th,.summary-table td,.sign-table td{border:1px solid #000;padding:3px 4px;vertical-align:middle}.meta-table td{text-align:left}.summary-table th,.summary-table td{text-align:center}.summary-table td:first-child,.summary-table .row-label,.summary-table .meta-summary,.sign-table td{text-align:left}.summary-table .date-column{text-align:center}.summary-table tfoot td{font-weight:700}.note-line{border:1px solid #000;border-top:0;min-height:30px;padding:5px 6px}.num,.money{font-variant-numeric:tabular-nums}.money{white-space:nowrap}.footer{border-top:1px solid #000;color:#333;display:flex;justify-content:space-between;margin-top:6px;padding-top:4px}@media print{body{font-size:8px;print-color-adjust:exact;-webkit-print-color-adjust:exact}.meta-table td,.summary-table th,.summary-table td,.sign-table td{padding:2px 3px}}`;
}
