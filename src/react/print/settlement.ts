import type { BillingStatement, BillingStatementLine, BillingStatementResponse } from "../api/contracts";
import {
  displayUnitLabel,
  documentNumberFor,
  escapeHtml,
  money,
  normalizeIacuc,
  numberText,
  resolveDisplayLineCount,
  resolveDisplayTotalCount,
  settlementPrintStyles,
  settlementStatementDocumentTitle,
} from "./settlementSupport";
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
  tierCagePriority?: number;
  supportAmount?: number;
  payableAmount?: number;
  amount?: number;
  tier1BillableCages?: number;
  tier2BillableCages?: number;
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
  showTiered: boolean;
  span: number;
  label: string;
};

type SettlementPageSlot = { column: SettlementColumn | null; summary: ColumnSummary };

type SettlementPage = { slots: SettlementPageSlot[]; showLeadingTotals: boolean };

const GROUP_GRID_UNITS = 12;

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
      showTiered: summary.tier2Billable > 0,
      span: 2 + (summary.free > 0 ? 1 : 0) + (summary.tier2Billable > 0 ? 1 : 0),
    };
  });
  const pagedColumns = paginateColumns(columns);
  const documentNumber = statement.documentNumber || documentNumberFor(statement);
  const titleSuffix =
    unit === "cage_day" && Number(statement.freeCageAllowance || 0) > 0
      ? `（减免${numberText(statement.freeCageAllowance)}笼）`
      : "";
  const title = `${escapeHtml(statement.pi || "-")}课题组实验动物饲养费核算汇总表${titleSuffix}`;
  const totalCount = resolveDisplayTotalCount(statement, unit, totals);
  const totalFree = Number(statement.totalFreeCageDays || 0);
  const totalTier2 = Number(statement.totalTier2CageDays || 0);
  const totalPayable = totals.reduce((sum, item) => sum + item.amount, 0);
  const allIacucs = [...new Set(columns.map((column) => column.iacuc))];
  const fullExemptionIacucs = [
    ...new Set(columns.filter((column) => column.fullExemption).map((column) => column.iacuc)),
  ];
  const totalPages = Math.max(pagedColumns.length, 1);

  return pagedColumns
    .map((page, pageIndex) => {
      const resolvedSlots = page.slots.map((slot) => ({
        column: slot.column,
        summary: slot.column ? totals.find((item) => item.key === slot.column?.key) || emptySummary() : emptySummary(),
      }));
      const pageHasFree = page.showLeadingTotals
        ? totalFree > 0 || resolvedSlots.some((slot) => slot.summary.free > 0)
        : resolvedSlots.some((slot) => slot.summary.free > 0);
      const pageHasTier = page.showLeadingTotals
        ? totalTier2 > 0 || resolvedSlots.some((slot) => slot.summary.tier2Billable > 0)
        : resolvedSlots.some((slot) => slot.summary.tier2Billable > 0);
      const detailRows = model
        .map((row) => {
          const leadingCells = page.showLeadingTotals
            ? renderGroupCells(
                {
                  count: row.totalCount,
                  free: row.totalFree,
                  support: 0,
                  amount: 0,
                  tier2Billable: row.totalTier2,
                },
                pageHasFree,
                pageHasTier,
                false,
              )
            : "";
          const valueCells = resolvedSlots
            .map((slot) =>
              renderGroupCells(
                slot.column ? row.perColumn.get(slot.column.key) || emptySummary() : emptySummary(),
                slot.column ? slot.column.showFree : false,
                slot.column ? slot.column.showTiered : false,
                true,
              ),
            )
            .join("");
          return `<tr><td>${escapeHtml(row.date)}</td>${leadingCells}${valueCells}</tr>`;
        })
        .join("");
      const detailTotals = resolvedSlots
        .map((slot) =>
          renderGroupCells(
            slot.summary,
            slot.column ? slot.column.showFree : false,
            slot.column ? slot.column.showTiered : false,
            true,
          ),
        )
        .join("");
      const columnsMarkup = resolvedSlots
        .map((slot) => {
          if (!slot.column) return `<th colspan="${GROUP_GRID_UNITS}" class="column-empty"></th>`;
          return `<th colspan="${GROUP_GRID_UNITS}">${escapeHtml(
            `${slot.column.label}${slot.column.showTiered ? "（梯度收费）" : ""}${slot.column.fullExemption ? "（全额减免）" : ""}`,
          )}</th>`;
        })
        .join("");
      const subColumns = resolvedSlots
        .map((slot) =>
          renderGroupHeaders(
            slot.column ? (slot.column.billingUnit === "animal_day" ? "数量" : "笼数") : "",
            slot.column ? slot.column.showFree : false,
            slot.column ? slot.column.showTiered : false,
          ),
        )
        .join("");
      const summaryLabel = pageIndex === 0 ? "本月待缴纳饲养费<br />总计（元）" : "本页汇总";
      const leadingSummaryParts = 1 + (pageHasFree ? 1 : 0) + (pageHasTier ? 1 : 0);
      const [leadingSummaryLabelSpan = GROUP_GRID_UNITS] = splitGroupUnits(leadingSummaryParts);
      const leadingSummaryAmountSpan = Math.max(GROUP_GRID_UNITS - leadingSummaryLabelSpan, 0);
      const summaryLeadingMarkup = page.showLeadingTotals
        ? `<td colspan="${1 + leadingSummaryLabelSpan}" class="row-label row-label-summary row-label-summary-wide">${summaryLabel}</td>${
            leadingSummaryAmountSpan
              ? `<td colspan="${leadingSummaryAmountSpan}" class="money summary-total-money">${money(totalPayable)}</td>`
              : ""
          }`
        : `<td class="row-label row-label-summary">${summaryLabel}</td>`;
      const summaryRow = `<tr>${summaryLeadingMarkup}${resolvedSlots
        .map((slot) =>
          slot.column
            ? `<td colspan="${GROUP_GRID_UNITS}" class="meta-summary"><span>单位支持：${money(slot.summary.support)}</span><span>实际待缴纳：${money(slot.summary.amount)}</span></td>`
            : `<td colspan="${GROUP_GRID_UNITS}" class="meta-summary meta-summary-empty"></td>`,
        )
        .join("")}</tr>`;
      const footerBlock = `<div class="note-line">说明：</div><table class="sign-table"><tbody><tr><td>项目负责人</td><td>实验负责人/经办人</td><td>日期</td></tr></tbody></table>`;
      const pageFooter = `<div class="page-footer">第 ${pageIndex + 1} / ${totalPages} 页</div>`;
      const leadingColMarkup = page.showLeadingTotals
        ? Array.from({ length: GROUP_GRID_UNITS }, () => '<col class="col-group" />').join("")
        : "";
      const leadingHeaderMarkup = page.showLeadingTotals ? `<th colspan="${GROUP_GRID_UNITS}">汇总</th>` : "";
      const leadingSubHeaderMarkup = page.showLeadingTotals
        ? renderGroupHeaders(
            unit === "animal_day" ? "总数量" : unit === "mixed" ? "总量" : "总笼数",
            pageHasFree,
            pageHasTier,
            unit === "animal_day" ? "减免总数量" : unit === "mixed" ? "减免总量" : "减免总笼数",
            unit === "animal_day" ? "阶梯总数量" : unit === "mixed" ? "阶梯总量" : "阶梯总笼数",
            "",
          )
        : "";
      const leadingTotalsRowMarkup = page.showLeadingTotals
        ? renderGroupCells(
            { count: totalCount, free: totalFree, support: 0, amount: 0, tier2Billable: totalTier2 },
            pageHasFree,
            pageHasTier,
            false,
          )
        : "";
      return `<main class="document document-page${pageIndex < totalPages - 1 ? " document-page-break" : ""}"><section class="header"><div class="header-grid"><div class="header-main"><h1>${title}</h1><div class="meta"><div>单据编号：${escapeHtml(documentNumber)}</div><div>结算月份：${escapeHtml(statement.month)}</div><div>项目负责人：${escapeHtml(statement.pi)}</div></div></div></div></section>
<table class="meta-table"><tbody><tr><td>出具科室：实验动物中心</td><td>计费单位：${displayUnitLabel(unit)}</td><td colspan="2">实验负责人：${escapeHtml(statement.owner || "-")}</td></tr><tr><td colspan="4">IACUC 编号：${escapeHtml(allIacucs.join("、") || "-")}${fullExemptionIacucs.length ? `　全额减免：${escapeHtml(fullExemptionIacucs.join("、"))}` : ""}</td></tr><tr><td colspan="4">支撑经费：${escapeHtml(statement.funding || "-")}</td></tr></tbody></table>
<table class="summary-table"><colgroup><col class="col-date" />${leadingColMarkup}${resolvedSlots
        .map(() => Array.from({ length: GROUP_GRID_UNITS }, () => '<col class="col-group" />').join(""))
        .join(
          "",
        )}</colgroup><thead><tr><th class="date-column" rowspan="2">日期</th>${leadingHeaderMarkup}${columnsMarkup}</tr><tr>${leadingSubHeaderMarkup}${subColumns}</tr></thead><tbody>${detailRows}</tbody><tfoot><tr><td class="row-label">单项合计</td>${leadingTotalsRowMarkup}${detailTotals}</tr>${summaryRow}</tfoot></table>${footerBlock}${pageFooter}</main>`;
    })
    .join("");
}

export function settlementStatementHtml(result: BillingStatementResponse, autoPrint = true) {
  const title = settlementStatementDocumentTitle(result);
  return `<!doctype html><html lang="zh-CN"><head><meta charset="UTF-8"><title>${escapeHtml(title)}</title><style>${settlementPrintStyles()}</style></head><body>${settlementStatementMarkup(result)}${autoPrint ? "<script>window.onload=()=>window.print()</script>" : ""}</body></html>`;
}

export function openSettlementPrint(result: BillingStatementResponse) {
  const popup = window.open("", "_blank");
  if (!popup) return false;
  popup.document.write(settlementStatementHtml(result));
  popup.document.close();
  return true;
}

function paginateColumns(columns: SettlementColumn[]) {
  const pages: SettlementPage[] = [];
  const firstPageSlots = columns.slice(0, 4);
  pages.push({
    slots: padPageSlots(firstPageSlots),
    showLeadingTotals: true,
  });
  const rest = columns.slice(4);
  for (let index = 0; index < Math.max(rest.length, 1); index += 5) {
    if (!rest.length && index > 0) break;
    const chunk = rest.slice(index, index + 5);
    if (!chunk.length) break;
    pages.push({
      slots: padPageSlots(chunk, 5),
      showLeadingTotals: false,
    });
  }
  return pages;
}

function padPageSlots(columns: SettlementColumn[], size = 4): SettlementPageSlot[] {
  return Array.from({ length: size }, (_, index) => ({
    column: columns[index] || null,
    summary: columns[index] ? emptySummary() : emptySummary(),
  })).map((slot) => (slot.column ? { ...slot, summary: emptySummary() } : slot));
}

function collectColumns(statement: BillingStatement, lines: BillingStatementLine[]) {
  const iacucOrder = new Map(
    (statement.iacucs || []).map((iacuc, index) => [normalizeIacuc(iacuc), index] as const).filter((entry) => entry[0]),
  );
  const columns = new Map<string, Omit<SettlementColumn, "showFree" | "showTiered" | "span" | "label">>();
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
      showTiered: false,
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

function renderGroupHeaders(
  countLabel: string,
  showFree: boolean,
  showTiered: boolean,
  freeLabel = "减免",
  tierLabel = "梯度",
  amountLabel = "缴纳（元）",
) {
  const labels = [
    countLabel ? escapeHtml(countLabel) : "",
    showFree ? escapeHtml(freeLabel) : "",
    showTiered ? escapeHtml(tierLabel) : "",
    countLabel ? escapeHtml(amountLabel) : "",
  ].filter(Boolean);
  return renderGroupedHeaderCells(labels);
}

function renderGroupCells(summary: ColumnSummary, showFree: boolean, showTiered: boolean, showAmount: boolean) {
  const hasValue = summary.count > 0 || summary.free > 0 || summary.tier2Billable > 0 || summary.amount > 0;
  const cells = [
    { className: "num", value: numberText(summary.count) },
    ...(showFree ? [{ className: "num", value: numberText(summary.free) }] : []),
    ...(showTiered ? [{ className: "num", value: numberText(summary.tier2Billable) }] : []),
    ...(showAmount ? [{ className: "money", value: hasValue ? money(summary.amount) : "" }] : []),
  ];
  return renderGroupedValueCells(cells);
}

function renderGroupedHeaderCells(labels: string[]) {
  if (!labels.length) return `<th colspan="${GROUP_GRID_UNITS}" class="group-empty-cell"></th>`;
  const spans = splitGroupUnits(labels.length);
  return labels.map((label, index) => `<th colspan="${spans[index]}">${label}</th>`).join("");
}

function renderGroupedValueCells(cells: Array<{ className: string; value: string }>) {
  if (!cells.length) return `<td colspan="${GROUP_GRID_UNITS}" class="group-empty-cell"></td>`;
  const spans = splitGroupUnits(cells.length);
  return cells
    .map(
      (cell, index) =>
        `<td colspan="${spans[index]}" class="${cell.className}${cell.value ? "" : " group-empty-cell"}">${cell.value}</td>`,
    )
    .join("");
}

function splitGroupUnits(parts: number) {
  const base = Math.floor(GROUP_GRID_UNITS / parts);
  const remainder = GROUP_GRID_UNITS % parts;
  return Array.from({ length: parts }, (_, index) => base + (index < remainder ? 1 : 0));
}

function modelLine(line: BillingStatementLine, columns: SettlementColumn[], unit: string) {
  const perColumn = new Map(columns.map((column) => [column.key, emptySummary()]));
  const explicitBreakdown = (line.iacucBreakdown || []).filter((raw) => {
    const item = raw as Breakdown;
    return (
      item.supportAmount !== undefined ||
      item.payableAmount !== undefined ||
      item.tier1BillableCages !== undefined ||
      item.tier2BillableCages !== undefined
    );
  });
  if (explicitBreakdown.length) {
    for (const raw of explicitBreakdown) {
      const item = raw as Breakdown;
      const columnKey = breakdownColumnKey(item);
      if (!columnKey || !perColumn.has(columnKey)) continue;
      const current = perColumn.get(columnKey) || emptySummary();
      current.count += Number(item.billingUnit === "animal_day" ? item.animalCount || 0 : item.cageCount || 0);
      current.free += Number(item.freeCages || 0);
      current.support += Number(item.supportAmount || 0);
      current.amount += Number(item.payableAmount ?? item.amount ?? 0);
      current.tier2Billable += Number(item.tier2BillableCages || 0);
      perColumn.set(columnKey, current);
    }
    return {
      date: line.date,
      totalCount: resolveDisplayLineCount(line, unit, [...perColumn.values()]),
      totalFree: Number(line.freeCages || 0),
      totalTier2: Number(line.tier2BillableCages || 0),
      perColumn,
    };
  }
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
    totalCount: resolveDisplayLineCount(line, unit, [...perColumn.values()]),
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

function emptySummary(): ColumnSummary {
  return { count: 0, free: 0, support: 0, amount: 0, tier2Billable: 0 };
}
