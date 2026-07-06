import type { BillingStatement, BillingStatementLine, BillingStatementResponse } from "../api/contracts";
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
  fullExemption?: boolean;
};

type SettlementColumn = {
  key: string;
  iacuc: string;
  speciesLabel: string;
  billingUnit: string;
  unitPrice: number;
  overageUnitPrice: number;
  tiered: boolean;
  freeAllowance: boolean;
  fullExemption: boolean;
  showFree: boolean;
  showTieredLabel: boolean;
  span: number;
  label: string;
};

type ColumnSummary = {
  count: number;
  free: number;
  support: number;
  amount: number;
  tier2Billable: number;
};

type ColumnLineValue = ColumnSummary;

type SettlementRow = {
  date: string;
  totalCount: number;
  totalFree: number;
  totalTier2: number;
  perColumn: Map<string, ColumnLineValue>;
};

export function settlementStatementMarkup(result: BillingStatementResponse) {
  const { statement } = result;
  const lines = result.lines.filter((line) => line.animalCount || line.cageCount || line.amount);
  const unit = resolveUnit(statement, lines);
  const rawColumns = collectColumns(statement, lines);
  const model = lines.map((line) => modelLine(line, rawColumns, unit));
  const totals = summarizeColumns(rawColumns, model);
  const totalsByKey = new Map(totals.map((item) => [item.key, item]));
  const columns = rawColumns.map((column) => {
    const summary = totalsByKey.get(column.key) || emptySummary();
    return {
      ...column,
      showFree: summary.free > 0,
      showTieredLabel: summary.tier2Billable > 0,
      span: summary.free > 0 ? 3 : 2,
    };
  });
  const pagedColumns = paginateColumns(columns);
  const hasTieredCharges = Number(statement.totalTier2CageDays || 0) > 0;
  const documentNumber = statement.documentNumber || documentNumberFor(statement);
  const titleSuffix =
    unit === "cage_day" && Number(statement.freeCageAllowance || 0) > 0
      ? `（减免${numberText(statement.freeCageAllowance)}笼）`
      : "";
  const title = `${escapeHtml(statement.pi || "-")}课题组实验动物饲养费核算汇总表${titleSuffix}`;
  const totalCount = resolveDisplayTotalCount(statement, unit, totals);
  const totalPayable = totals.reduce((sum, item) => sum + item.amount, 0);
  const allIacucs = [...new Set(columns.map((column) => column.iacuc))];
  const fullExemptionIacucs = [
    ...new Set(columns.filter((column) => column.fullExemption).map((column) => column.iacuc)),
  ];
  const totalPages = Math.max(pagedColumns.length, 1);

  return pagedColumns
    .map((pageColumns, pageIndex) => {
      const pageTotals = pageColumns.map((column) => totals.find((item) => item.key === column.key) || emptySummary());
      const showLeadingTotals = pageIndex === 0;
      const leadingColumnCount = showLeadingTotals ? (hasTieredCharges ? 4 : 3) : 1;
      const detailRows = model
        .map((row) => {
          const valueCells = pageColumns
            .map((column) => {
              const item = row.perColumn.get(column.key) || emptySummary();
              return `<td class="num">${numberText(item.count)}</td>${column.showFree ? `<td class="num">${numberText(item.free)}</td>` : ""}<td class="money">${item.count > 0 || item.free > 0 ? money(item.amount) : ""}</td>`;
            })
            .join("");
          const leadingCells = showLeadingTotals
            ? `<td class="num">${numberText(row.totalCount)}</td><td class="num">${numberText(row.totalFree)}</td>${hasTieredCharges ? `<td class="num">${numberText(row.totalTier2)}</td>` : ""}`
            : "";
          return `<tr><td>${escapeHtml(row.date)}</td>${leadingCells}${valueCells}</tr>`;
        })
        .join("");
      const detailTotals = pageColumns
        .map((column, index) => {
          const item = pageTotals[index];
          return `<td class="num">${numberText(item.count)}</td>${column.showFree ? `<td class="num">${numberText(item.free)}</td>` : ""}<td class="money">${money(item.amount)}</td>`;
        })
        .join("");
      const columnsMarkup = pageColumns
        .map(
          (column) =>
            `<th colspan="${column.span}">${escapeHtml(`${column.label}${column.showTieredLabel ? "（梯度收费）" : ""}${column.fullExemption ? "（全额减免）" : ""}`)}</th>`,
        )
        .join("");
      const subColumns = pageColumns
        .map(
          (column) =>
            `<th>${column.billingUnit === "animal_day" ? "数量" : "笼数"}</th>${column.showFree ? "<th>减免</th>" : ""}<th>缴纳（元）</th>`,
        )
        .join("");
      const summaryLabel = pageIndex === 0 ? "本月待缴纳饲养费<br />总计（元）" : "本页汇总";
      const summaryLeadingCells = showLeadingTotals
        ? `<td colspan="${leadingColumnCount - 1}" class="money summary-total-money">${money(totalPayable)}</td>`
        : "";
      const summaryRow = `<tr><td class="row-label row-label-summary">${summaryLabel}</td>${summaryLeadingCells}${pageTotals
        .map(
          (item, index) =>
            `<td colspan="${pageColumns[index].span}" class="meta-summary"><span>单位支持：${money(item.support)}</span><span>实际待缴纳：${money(item.amount)}</span></td>`,
        )
        .join("")}</tr>`;
      const footerBlock = `<div class="note-line">说明：</div><table class="sign-table"><tbody><tr><td>项目负责人</td><td>实验负责人/经办人</td><td>日期</td></tr></tbody></table>`;
      const pageFooter = `<div class="page-footer">第 ${pageIndex + 1} / ${totalPages} 页</div>`;
      return `<main class="document document-page${pageIndex < totalPages - 1 ? " document-page-break" : ""}"><section class="header"><div class="header-grid"><div class="header-main"><h1>${title}</h1><div class="meta"><div>单据编号：${escapeHtml(documentNumber)}</div><div>结算月份：${escapeHtml(statement.month)}</div><div>项目负责人：${escapeHtml(statement.pi)}</div></div></div></div></section>
<table class="meta-table"><tbody><tr><td>出具科室：实验动物中心</td><td>计费单位：${displayUnitLabel(unit)}</td><td colspan="2">实验负责人：${escapeHtml(statement.owner || "-")}</td></tr><tr><td colspan="4">IACUC 编号：${escapeHtml(allIacucs.join("、") || "-")}${fullExemptionIacucs.length ? `　全额减免：${escapeHtml(fullExemptionIacucs.join("、"))}` : ""}</td></tr><tr><td colspan="4">支撑经费：${escapeHtml(statement.funding || "-")}</td></tr></tbody></table>
<table class="summary-table"><colgroup><col class="col-date" />${showLeadingTotals ? `<col class="col-total" /><col class="col-free" />${hasTieredCharges ? `<col class="col-tier" />` : ""}` : ""}${pageColumns
        .map(
          (column) =>
            `<col class="col-value" />${column.showFree ? `<col class="col-free-value" />` : ""}<col class="col-money" />`,
        )
        .join(
          "",
        )}</colgroup><thead><tr><th class="date-column" rowspan="2">日期</th>${showLeadingTotals ? `<th rowspan="2">${unit === "animal_day" ? "总数量" : unit === "mixed" ? "总量" : "总笼数"}</th><th rowspan="2">${unit === "animal_day" ? "减免总数量" : unit === "mixed" ? "减免总量" : "减免总笼数"}</th>${hasTieredCharges ? `<th rowspan="2">梯度笼数</th>` : ""}` : ""}${columnsMarkup}</tr><tr>${subColumns}</tr></thead><tbody>${detailRows}</tbody><tfoot><tr><td class="row-label">单项合计</td>${showLeadingTotals ? `<td class="num">${numberText(totalCount)}</td><td class="num">${numberText(statement.totalFreeCageDays)}</td>${hasTieredCharges ? `<td class="num">${numberText(statement.totalTier2CageDays)}</td>` : ""}` : ""}${detailTotals}</tr>${summaryRow}</tfoot></table>${footerBlock}${pageFooter}</main>`;
    })
    .join("");
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

function paginateColumns(columns: SettlementColumn[]) {
  if (!columns.length) return [[]];
  const firstPage = columns.slice(0, 4);
  const rest = columns.slice(4);
  const pages = [firstPage];
  for (let index = 0; index < rest.length; index += 5) pages.push(rest.slice(index, index + 5));
  return pages.filter((page) => page.length);
}

function collectColumns(statement: BillingStatement, lines: BillingStatementLine[]) {
  const iacucOrder = new Map(
    (statement.iacucs || []).map((iacuc, index) => [normalizeIacuc(iacuc), index] as const).filter((entry) => entry[0]),
  );
  const columns = new Map<string, Omit<SettlementColumn, "showFree" | "showTieredLabel" | "span" | "label">>();
  lines.forEach((line) =>
    (line.iacucBreakdown || []).forEach((raw) => {
      const item = raw as Breakdown;
      const iacuc = normalizeIacuc(item.iacuc);
      const key = breakdownColumnKey(item);
      if (!iacuc || !key || columns.has(key)) return;
      columns.set(key, {
        key,
        iacuc,
        speciesLabel: speciesLabelFor(item),
        billingUnit: String(item.billingUnit || ""),
        unitPrice: Number(item.unitPrice || 0),
        overageUnitPrice: Number(item.overageUnitPrice || 0),
        tiered: Boolean(item.tiered),
        freeAllowance: Boolean(item.freeAllowance),
        fullExemption: Boolean(item.fullExemption),
      });
    }),
  );
  const sorted = [...columns.values()].sort((left, right) => {
    const iacucSort =
      (iacucOrder.get(left.iacuc) ?? Number.MAX_SAFE_INTEGER) -
      (iacucOrder.get(right.iacuc) ?? Number.MAX_SAFE_INTEGER);
    if (iacucSort) return iacucSort;
    const iacucTextSort = left.iacuc.localeCompare(right.iacuc, "zh-CN");
    if (iacucTextSort) return iacucTextSort;
    const speciesSort = left.speciesLabel.localeCompare(right.speciesLabel, "zh-CN");
    if (speciesSort) return speciesSort;
    const unitSort = left.billingUnit.localeCompare(right.billingUnit, "zh-CN");
    if (unitSort) return unitSort;
    if (left.unitPrice !== right.unitPrice) return left.unitPrice - right.unitPrice;
    return left.key.localeCompare(right.key, "zh-CN");
  });
  const duplicateCounts = new Map<string, number>();
  sorted.forEach((column) => {
    const baseLabel = column.speciesLabel === "小鼠" ? column.iacuc : `${column.iacuc}（${column.speciesLabel}）`;
    duplicateCounts.set(baseLabel, (duplicateCounts.get(baseLabel) || 0) + 1);
  });
  return sorted.map((column) => {
    const baseLabel = column.speciesLabel === "小鼠" ? column.iacuc : `${column.iacuc}（${column.speciesLabel}）`;
    const hasDuplicate = (duplicateCounts.get(baseLabel) || 0) > 1;
    const suffix = hasDuplicate ? ` / ¥${money(column.unitPrice)}` : "";
    return {
      ...column,
      showFree: false,
      showTieredLabel: false,
      span: 2,
      label:
        column.speciesLabel === "小鼠"
          ? `${column.iacuc}${suffix}`
          : `${column.iacuc}（${column.speciesLabel}${suffix}）`,
    };
  });
}

function summarizeColumns(columns: SettlementColumn[], rows: SettlementRow[]) {
  const totals = columns.map((column) => ({
    key: column.key,
    count: 0,
    free: 0,
    support: 0,
    amount: 0,
    tier2Billable: 0,
  }));
  const byKey = new Map(totals.map((item) => [item.key, item]));
  rows.forEach((row) =>
    columns.forEach((column) => {
      const current = byKey.get(column.key);
      const item = row.perColumn.get(column.key);
      if (!current || !item) return;
      current.count += item.count;
      current.free += item.free;
      current.support += item.support;
      current.amount += item.amount;
      current.tier2Billable += item.tier2Billable;
    }),
  );
  return totals.map((item) => ({
    ...item,
    showFree: item.free > 0,
  }));
}

function modelLine(line: BillingStatementLine, columns: SettlementColumn[], unit: string) {
  const perColumn = new Map(columns.map((column) => [column.key, emptySummary()]));
  const groups = new Map<
    string,
    {
      tiered: boolean;
      unitPrice: number;
      overageUnitPrice: number;
      values: Map<string, { count: number; free: number }>;
    }
  >();
  for (const raw of line.iacucBreakdown || []) {
    const item = raw as Breakdown;
    const columnKey = breakdownColumnKey(item);
    if (!columnKey || !perColumn.has(columnKey)) continue;
    const count = Number(item.billingUnit === "animal_day" ? item.animalCount || 0 : item.cageCount || 0);
    const currentGroup:
      | {
          tiered: boolean;
          unitPrice: number;
          overageUnitPrice: number;
          values: Map<string, { count: number; free: number }>;
        }
      | undefined = groups.get(columnGroupKey(item));
    const nextGroup = currentGroup || {
      tiered: Boolean(item.tiered),
      unitPrice: Number(item.unitPrice || 0),
      overageUnitPrice: Number(item.overageUnitPrice || 0),
      values: new Map<string, { count: number; free: number }>(),
    };
    const currentValue = nextGroup.values.get(columnKey) || { count: 0, free: 0 };
    currentValue.count += count;
    currentValue.free += Number(item.freeCages || 0);
    nextGroup.values.set(columnKey, currentValue);
    groups.set(columnGroupKey(item), nextGroup);
  }

  for (const group of groups.values()) {
    let remainingTier1Slots = group.tiered ? 160 : 0;
    for (const column of columns) {
      const slot = group.values.get(column.key);
      if (!slot?.count) continue;
      const count = slot.count;
      const free = Math.min(slot.free, count);
      const current = perColumn.get(column.key) || emptySummary();
      let support = 0;
      let amount = 0;
      let tier2Billable = 0;
      if (group.tiered) {
        const tier1Count = Math.min(remainingTier1Slots, count);
        const tier2Count = Math.max(count - tier1Count, 0);
        const tier1Free = Math.min(free, tier1Count);
        const tier2Free = Math.min(Math.max(free - tier1Free, 0), tier2Count);
        const tier1Billable = Math.max(tier1Count - tier1Free, 0);
        tier2Billable = Math.max(tier2Count - tier2Free, 0);
        support = tier1Free * group.unitPrice + tier2Free * group.overageUnitPrice;
        amount = tier1Billable * group.unitPrice + tier2Billable * group.overageUnitPrice;
        remainingTier1Slots = Math.max(remainingTier1Slots - tier1Count, 0);
      } else {
        support = free * group.unitPrice;
        amount = Math.max(count - free, 0) * group.unitPrice;
      }
      current.count += count;
      current.free += free;
      current.support += support;
      current.amount += amount;
      current.tier2Billable += tier2Billable;
      perColumn.set(column.key, current);
    }
  }

  return {
    date: line.date,
    totalCount: resolveDisplayLineCount(line, unit, perColumn),
    totalFree: Number(line.freeCages || 0),
    totalTier2: Number(line.tier2BillableCages || 0),
    perColumn,
  };
}

function breakdownColumnKey(item: Breakdown) {
  const iacuc = normalizeIacuc(item.iacuc);
  if (!iacuc) return "";
  return [
    iacuc,
    speciesLabelFor(item),
    String(item.billingItem || ""),
    String(item.billingUnit || ""),
    Number(item.unitPrice || 0).toFixed(2),
    Number(item.overageUnitPrice || 0).toFixed(2),
    item.tiered ? "1" : "0",
    item.freeAllowance ? "1" : "0",
    item.fullExemption ? "1" : "0",
  ].join("|");
}

function columnGroupKey(item: Breakdown) {
  return [
    String(item.billingItem || ""),
    String(item.customerType || ""),
    String(item.billingUnit || ""),
    Number(item.unitPrice || 0).toFixed(2),
    Number(item.overageUnitPrice || 0).toFixed(2),
    item.tiered ? "1" : "0",
    item.freeAllowance ? "1" : "0",
  ].join("|");
}

function speciesLabelFor(item: Breakdown) {
  const billingItem = String(item.billingItem || "").trim();
  if (billingItem.includes("小鼠")) return "小鼠";
  if (billingItem.includes("大鼠")) return "大鼠";
  if (billingItem.includes("豚鼠")) return "豚鼠";
  if (billingItem.includes("兔")) return "兔";
  if (billingItem.includes("猴")) return "猴";
  if (billingItem.includes("猪")) return "猪";
  if (billingItem.includes("犬")) return "犬";
  const unitPrice = Number(item.unitPrice || 0);
  const billingUnit = String(item.billingUnit || "");
  if (billingUnit === "animal_day") {
    if (unitPrice === 3) return "豚鼠";
    if (unitPrice === 5) return "兔";
    if (unitPrice === 35 || unitPrice === 65) return "猴";
    if (unitPrice === 15 || unitPrice === 45) return "猪/犬";
    return "动物";
  }
  if (
    unitPrice === 4.5 ||
    unitPrice === 6.5 ||
    unitPrice === 7.2 ||
    unitPrice === 13.5 ||
    unitPrice === 19.5 ||
    unitPrice === 21.6
  ) {
    return "小鼠";
  }
  if (unitPrice === 8.5 || unitPrice === 14 || unitPrice === 25.5 || unitPrice === 42) {
    return "大鼠";
  }
  return "动物";
}

function resolveUnit(statement: BillingStatement, lines: BillingStatementLine[]) {
  if (statement.billingUnit && statement.billingUnit !== "mixed") return statement.billingUnit;
  const hasAnimal = lines.some((line) =>
    (line.iacucBreakdown || []).some((item) => (item as Breakdown).billingUnit === "animal_day"),
  );
  const hasCage = lines.some((line) =>
    (line.iacucBreakdown || []).some((item) => (item as Breakdown).billingUnit !== "animal_day"),
  );
  if (hasAnimal && hasCage) return "mixed";
  return hasAnimal ? "animal_day" : "cage_day";
}

function resolveDisplayLineCount(line: BillingStatementLine, unit: string, perColumn: Map<string, ColumnLineValue>) {
  if (unit === "animal_day") return Number(line.animalCount || 0);
  if (unit === "cage_day") return Number(line.cageCount || 0);
  return [...perColumn.values()].reduce((sum, item) => sum + item.count, 0);
}

function resolveDisplayTotalCount(
  statement: BillingStatement,
  unit: string,
  totals: Array<ColumnSummary & { key: string; showFree: boolean }>,
) {
  if (unit === "animal_day") return Number(statement.totalAnimalDays || 0);
  if (unit === "cage_day") return Number(statement.totalCageDays || 0);
  return totals.reduce((sum, item) => sum + item.count, 0);
}

function displayUnitLabel(unit: string) {
  if (unit === "animal_day") return "只/天";
  if (unit === "cage_day") return "笼/天";
  return "混合";
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

function emptySummary(): ColumnSummary {
  return { count: 0, free: 0, support: 0, amount: 0, tier2Billable: 0 };
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
  return `@page{size:A4;margin:10mm}*{box-sizing:border-box}body{color:#111;font-family:"Arial","Helvetica Neue","Noto Sans SC","PingFang SC","Microsoft YaHei",sans-serif;font-size:8.4px;line-height:1.2;margin:0;background:#fff}.document{max-width:190mm;min-height:277mm;margin:0 auto}.document-page-break{page-break-after:always;break-after:page}.header{border:1px solid #000;padding:6px 8px}.header-grid{display:block}.header-main{display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center}h1{font-size:15px;line-height:1.1;margin:0 0 4px;display:flex;align-items:flex-end;justify-content:center;gap:8px;flex-wrap:wrap}.meta{display:grid;grid-template-columns:repeat(3,max-content);justify-content:center;gap:2px 10px;margin-top:4px}.meta-table,.summary-table,.sign-table{border-collapse:collapse;width:100%;table-layout:fixed;margin-top:6px}.meta-table td,.summary-table th,.summary-table td,.sign-table td{border:1px solid #000;padding:3px 4px;vertical-align:middle}.meta-table td{text-align:left}.summary-table th,.summary-table td{text-align:center}.summary-table td:first-child,.summary-table .row-label,.summary-table .meta-summary,.sign-table td{text-align:left}.summary-table .date-column{text-align:center;white-space:nowrap;width:20mm;min-width:20mm;max-width:20mm}.summary-table td:first-child{white-space:nowrap;width:20mm;min-width:20mm;max-width:20mm}.summary-table th{line-height:1.15}.summary-table tbody td{height:7mm}.summary-table tfoot td{font-weight:700}.summary-table .row-label-summary{line-height:1.3;white-space:normal}.summary-table .summary-total-money{vertical-align:middle}.summary-table .meta-summary{line-height:1.35;padding-top:5px;padding-bottom:5px;white-space:normal}.summary-table .meta-summary span{display:block}.summary-table .col-date{width:20mm;min-width:20mm;max-width:20mm}.summary-table .col-total,.summary-table .col-free,.summary-table .col-tier{width:7.5%}.summary-table .col-value{width:6.2%}.summary-table .col-free-value{width:5.8%}.summary-table .col-money{width:7.2%}.note-line{border:1px solid #000;border-top:0;min-height:30px;padding:5px 6px}.sign-table td{height:12mm;vertical-align:top;padding-top:4px}.page-footer{margin-top:4px;text-align:center;font-size:9px;font-weight:700}.num,.money{font-variant-numeric:tabular-nums}.money{white-space:nowrap}@media print{body{font-size:8px;print-color-adjust:exact;-webkit-print-color-adjust:exact}.meta-table td,.summary-table th,.summary-table td,.sign-table td{padding:2px 3px}.summary-table tbody td{height:6.5mm}.summary-table .meta-summary{padding-top:4px;padding-bottom:4px}}`;
}
