import type { BillingStatement, BillingStatementLine, BillingStatementResponse } from "../api/contracts";
import { settlementNotesMarkup } from "./settlementNotes";
import {
  displayUnitLabel,
  documentNumberFor,
  escapeHtml,
  money,
  normalizeIacuc,
  compareSettlementSpecies,
  settlementPrintStyles,
  settlementSpeciesHeaders,
  settlementStatementDocumentTitle,
  speciesLabelFor,
} from "./settlementSupport";
type Breakdown = {
  iacuc?: string;
  species?: string;
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
  statementUnitPrice?: number;
  statementOverageUnitPrice?: number;
  statementTiered?: boolean;
  statementFreeAllowance?: boolean;
  statementFullExemption?: boolean;
  supportAmount?: number;
  payableAmount?: number;
  amount?: number;
  tier2Cages?: number;
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
  hasTieredCharge: boolean;
  freeAllowance: boolean;
  fullExemption: boolean;
  showFree: boolean;
  showTiered: boolean;
  span: number;
  label: string;
  needsWideAmount: boolean;
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
  hasRecord: boolean;
};

type SettlementRow = {
  date: string;
  perColumn: Map<string, ColumnSummary>;
};

export function settlementStatementMarkup(result: BillingStatementResponse) {
  const { statement } = result;
  const lines = result.lines.filter(
    (line) => line.animalCount || line.cageCount || line.amount || Boolean(line.quantitySheetRowIds?.length),
  );
  const unit = resolveUnit(statement, lines);
  const rawColumns = collectColumns(statement, lines);
  const model = lines.map((line) => modelLine(line, rawColumns));
  const totals = summarizeColumns(rawColumns, model);
  const totalsByKey = new Map(totals.map((item) => [item.key, item]));
  const columns = rawColumns.map((column) => {
    const summary = totalsByKey.get(column.key) || emptySummary();
    return {
      ...column,
      showFree: column.speciesLabel === "小鼠" && summary.free > 0,
      showTiered: column.speciesLabel === "小鼠" && summary.tier2Billable > 0,
      span: 2 + (summary.free > 0 ? 1 : 0) + (summary.tier2Billable > 0 ? 1 : 0),
      needsWideAmount: summary.amount >= 100,
    };
  });
  const pagedColumns = paginateColumns(columns);
  const documentNumber = statement.documentNumber || documentNumberFor(statement);
  const title = `${escapeHtml(statement.pi || "-")}课题组实验动物饲养费核算汇总表`;
  const totalPayable = totals.reduce((sum, item) => sum + item.amount, 0);
  const allIacucs = [...new Set(columns.map((column) => column.iacuc))];
  const fullExemptionIacucs = [
    ...new Set(columns.filter((column) => column.fullExemption).map((column) => column.iacuc)),
  ];
  const statementNotes = settlementNotesMarkup(columns, statement.notes, lines);
  const totalPages = Math.max(pagedColumns.length, 1);

  const statementPages = pagedColumns
    .map((page, pageIndex) => {
      const resolvedSlots = page.slots.map((slot) => ({
        column: slot.column,
        summary: slot.column ? totals.find((item) => item.key === slot.column?.key) || emptySummary() : emptySummary(),
      }));
      const pageHasFree = page.showLeadingTotals
        ? resolvedSlots.filter((slot) => slot.column?.speciesLabel === "小鼠").some((slot) => slot.summary.free > 0)
        : resolvedSlots.some((slot) => slot.summary.free > 0);
      const pageHasTier = page.showLeadingTotals
        ? resolvedSlots
            .filter((slot) => slot.column?.speciesLabel === "小鼠")
            .some((slot) => slot.summary.tier2Billable > 0)
        : resolvedSlots.some((slot) => slot.summary.tier2Billable > 0);
      const mouseSlots = resolvedSlots.filter((slot) => slot.column?.speciesLabel === "小鼠");
      const mouseTotals = mouseSlots.reduce(
        (summary, slot) => ({
          count: summary.count + slot.summary.count,
          free: summary.free + slot.summary.free,
          amount: summary.amount + slot.summary.amount,
          tier2Billable: summary.tier2Billable + slot.summary.tier2Billable,
        }),
        { count: 0, free: 0, amount: 0, tier2Billable: 0 },
      );
      const detailRows = model
        .map((row) => {
          const leadingCells = page.showLeadingTotals
            ? renderGroupCells(
                {
                  count: mouseSlots.reduce(
                    (sum, slot) => sum + (slot.column ? row.perColumn.get(slot.column.key)?.count || 0 : 0),
                    0,
                  ),
                  free: mouseSlots.reduce(
                    (sum, slot) => sum + (slot.column ? row.perColumn.get(slot.column.key)?.free || 0 : 0),
                    0,
                  ),
                  support: 0,
                  amount: mouseSlots.reduce(
                    (sum, slot) => sum + (slot.column ? row.perColumn.get(slot.column.key)?.amount || 0 : 0),
                    0,
                  ),
                  tier2Billable: mouseSlots.reduce(
                    (sum, slot) => sum + (slot.column ? row.perColumn.get(slot.column.key)?.tier2Billable || 0 : 0),
                    0,
                  ),
                  hasRecord: false,
                },
                pageHasFree,
                pageHasTier,
                true,
                mouseTotals.amount >= 100,
              )
            : "";
          const valueCells = resolvedSlots
            .map((slot) =>
              renderGroupCells(
                slot.column ? row.perColumn.get(slot.column.key) || emptySummary() : emptySummary(),
                slot.column ? slot.column.showFree : false,
                slot.column ? slot.column.showTiered : false,
                true,
                slot.column ? slot.column.needsWideAmount : false,
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
            slot.column ? slot.column.needsWideAmount : false,
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
      const speciesMarkup = settlementSpeciesHeaders(resolvedSlots, page.showLeadingTotals, GROUP_GRID_UNITS);
      const subColumns = resolvedSlots
        .map((slot) =>
          renderGroupHeaders(
            slot.column ? (slot.column.billingUnit === "animal_day" ? "只数" : "笼数") : "",
            slot.column ? slot.column.showFree : false,
            slot.column ? slot.column.showTiered : false,
            slot.column ? slot.column.needsWideAmount : false,
          ),
        )
        .join("");
      const summaryLabel = pageIndex === 0 ? "本月待缴纳饲养费<br />总计（元）" : "本页汇总";
      // The payable amount stays visible even when the summary has no free or tiered subcolumns.
      const leadingSummaryLabelSpan = GROUP_GRID_UNITS / 2;
      const leadingSummaryAmountSpan = GROUP_GRID_UNITS / 2;
      const summaryLeadingMarkup = page.showLeadingTotals
        ? `<td colspan="${1 + leadingSummaryLabelSpan}" class="row-label row-label-summary row-label-summary-wide">${summaryLabel}</td><td colspan="${leadingSummaryAmountSpan}" class="money summary-total-money">${money(totalPayable)}</td>`
        : `<td class="row-label row-label-summary">${summaryLabel}</td>`;
      const summaryRow = `<tr>${summaryLeadingMarkup}${resolvedSlots
        .map((slot) =>
          slot.column
            ? `<td colspan="${GROUP_GRID_UNITS}" class="meta-summary"><span>单位支持：${money(slot.summary.support)}</span><span>实际待缴纳：${money(slot.summary.amount)}</span></td>`
            : `<td colspan="${GROUP_GRID_UNITS}" class="meta-summary meta-summary-empty"></td>`,
        )
        .join("")}</tr>`;
      const footerBlock = `${statementNotes}<table class="sign-table"><tbody><tr><td>项目负责人</td><td>实验负责人/经办人</td><td>日期</td></tr></tbody></table>`;
      const pageFooter = `<div class="page-footer">第 ${pageIndex + 1} / ${totalPages} 页</div>`;
      const leadingColMarkup = page.showLeadingTotals
        ? Array.from({ length: GROUP_GRID_UNITS }, () => '<col class="col-group" />').join("")
        : "";
      const leadingHeaderMarkup = page.showLeadingTotals ? `<th colspan="${GROUP_GRID_UNITS}">汇总</th>` : "";
      const leadingSubHeaderMarkup = page.showLeadingTotals
        ? renderGroupHeaders("笼数", pageHasFree, pageHasTier, mouseTotals.amount >= 100)
        : "";
      const leadingTotalsRowMarkup = page.showLeadingTotals
        ? renderGroupCells(
            {
              count: mouseTotals.count,
              free: mouseTotals.free,
              support: 0,
              amount: mouseTotals.amount,
              tier2Billable: mouseTotals.tier2Billable,
              hasRecord: false,
            },
            pageHasFree,
            pageHasTier,
            true,
            mouseTotals.amount >= 100,
          )
        : "";
      return `<main class="document document-page${pageIndex < totalPages - 1 ? " document-page-break" : ""}"><section class="header"><div class="header-grid"><div class="header-main"><h1>${title}</h1><div class="meta"><div>单据编号：${escapeHtml(documentNumber)}</div><div>结算月份：${escapeHtml(statement.month)}</div><div>项目负责人：${escapeHtml(statement.pi)}</div></div></div></div></section>
<table class="meta-table"><tbody><tr><td>出具科室：实验动物中心</td><td>计费单位：${displayUnitLabel(unit)}</td><td colspan="2">实验负责人：${escapeHtml(statement.owner || "-")}</td></tr><tr><td colspan="4">IACUC 编号：${escapeHtml(allIacucs.join("、") || "-")}${fullExemptionIacucs.length ? `　全额减免：${escapeHtml(fullExemptionIacucs.join("、"))}` : ""}</td></tr><tr><td colspan="4">支撑经费：${escapeHtml(statement.funding || "-")}</td></tr></tbody></table>
<table class="summary-table"><colgroup><col class="col-date" />${leadingColMarkup}${resolvedSlots
        .map(() => Array.from({ length: GROUP_GRID_UNITS }, () => '<col class="col-group" />').join(""))
        .join(
          "",
        )}</colgroup><thead><tr><th class="date-column" rowspan="3">日期</th>${speciesMarkup}</tr><tr>${leadingHeaderMarkup}${columnsMarkup}</tr><tr>${leadingSubHeaderMarkup}${subColumns}</tr></thead><tbody>${detailRows}</tbody><tfoot><tr><td class="row-label">单项合计</td>${leadingTotalsRowMarkup}${detailTotals}</tr>${summaryRow}</tfoot></table>${footerBlock}${pageFooter}</main>`;
    })
    .join("");
  return statementPages;
}

export function settlementStatementHtml(result: BillingStatementResponse, autoPrint = true) {
  const title = settlementStatementDocumentTitle(result);
  return `<!doctype html><html lang="zh-CN"><head><meta charset="UTF-8"><title>${escapeHtml(title)}</title><style>${settlementPrintStyles()}.summary-table .summary-total-money{font-weight:800}.note-line .note-entry{line-height:1.35}.note-line .note-entry strong{font-weight:700}.note-line .note-detail{margin-left:0}</style></head><body>${settlementStatementMarkup(result)}${autoPrint ? "<script>window.onload=()=>window.print()</script>" : ""}</body></html>`;
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
    showLeadingTotals: firstPageSlots.some((column) => column.speciesLabel === "小鼠"),
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
  const columns = new Map<
    string,
    Omit<SettlementColumn, "showFree" | "showTiered" | "span" | "label" | "needsWideAmount">
  >();
  lines.forEach((line) =>
    (line.iacucBreakdown || []).forEach((raw) => {
      const item = raw as Breakdown;
      const iacuc = normalizeIacuc(item.iacuc);
      const key = breakdownColumnKey(item);
      if (!iacuc || !key) return;
      const existing = columns.get(key);
      if (existing) {
        existing.hasTieredCharge ||= Number(item.tier2BillableCages || 0) > 0;
        return;
      }
      columns.set(key, {
        key,
        iacuc,
        speciesLabel: speciesLabelFor(item),
        billingUnit: String(item.billingUnit || ""),
        unitPrice: Number(item.statementUnitPrice ?? item.unitPrice ?? 0),
        overageUnitPrice: Number(item.statementOverageUnitPrice ?? item.overageUnitPrice ?? 0),
        // A statement snapshots the standard mouse rate, while a line can opt
        // out of tiered charging (for example, a custom billing segment).
        // Use the effective line rule when it exists so its headers and note
        // disclose the rate that was actually applied.
        tiered: typeof item.tiered === "boolean" ? item.tiered : Boolean(item.statementTiered),
        hasTieredCharge: Number(item.tier2BillableCages || 0) > 0,
        freeAllowance: Boolean(item.statementFreeAllowance ?? item.freeAllowance),
        fullExemption: Boolean(item.statementFullExemption ?? item.fullExemption),
      });
    }),
  );
  const sorted = [...columns.values()].sort((left, right) => {
    const speciesSort = compareSettlementSpecies(left.speciesLabel, right.speciesLabel);
    if (speciesSort) return speciesSort;
    const iacucSort =
      (iacucOrder.get(left.iacuc) ?? Number.MAX_SAFE_INTEGER) -
      (iacucOrder.get(right.iacuc) ?? Number.MAX_SAFE_INTEGER);
    if (iacucSort) return iacucSort;
    const iacucTextSort = left.iacuc.localeCompare(right.iacuc, "zh-CN");
    if (iacucTextSort) return iacucTextSort;
    const unitSort = left.billingUnit.localeCompare(right.billingUnit, "zh-CN");
    if (unitSort) return unitSort;
    if (left.unitPrice !== right.unitPrice) return left.unitPrice - right.unitPrice;
    return left.key.localeCompare(right.key, "zh-CN");
  });
  const duplicateCounts = new Map<string, number>();
  sorted.forEach((column) => {
    const baseLabel = column.iacuc;
    duplicateCounts.set(baseLabel, (duplicateCounts.get(baseLabel) || 0) + 1);
  });
  return sorted.map((column) => {
    const baseLabel = column.iacuc;
    const hasDuplicate = (duplicateCounts.get(baseLabel) || 0) > 1;
    const suffix = hasDuplicate ? ` / ¥${money(column.unitPrice)}` : "";
    return {
      ...column,
      showFree: false,
      showTiered: false,
      span: 2,
      label: `${baseLabel}${suffix}`,
      needsWideAmount: false,
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
    hasRecord: false,
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
      current.hasRecord = current.hasRecord || item.hasRecord;
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
  needsWideAmount = false,
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
  return renderGroupedHeaderCells(labels, showFree, showTiered, needsWideAmount);
}

function renderGroupCells(
  summary: ColumnSummary,
  showFree: boolean,
  showTiered: boolean,
  showAmount: boolean,
  needsWideAmount = false,
) {
  const hasValue =
    summary.hasRecord || summary.count > 0 || summary.free > 0 || summary.tier2Billable > 0 || summary.amount > 0;
  // 有笼数（含沿用的笼数）或当天有统计记录时，减免/梯度列也显示数值；
  // 未分配到减免/梯度的日期显示 0 而不是空，便于对账。
  const hasCount = summary.count > 0 || summary.hasRecord;
  const countValue = hasCount ? String(summary.count) : "";
  const freeValue = hasCount ? String(summary.free) : "";
  const tierValue = hasCount ? String(summary.tier2Billable) : "";
  const cells = [
    { className: "num", value: countValue },
    ...(showFree ? [{ className: "num", value: freeValue }] : []),
    ...(showTiered ? [{ className: "num", value: tierValue }] : []),
    ...(showAmount ? [{ className: "money", value: hasValue ? money(summary.amount) : "" }] : []),
  ];
  return renderGroupedValueCells(cells, showFree, showTiered, needsWideAmount);
}

function renderGroupedHeaderCells(labels: string[], showFree: boolean, showTiered: boolean, needsWideAmount: boolean) {
  if (!labels.length) return `<th colspan="${GROUP_GRID_UNITS}" class="group-empty-cell"></th>`;
  const spans = groupFieldSpans(showFree, showTiered, needsWideAmount);
  return labels.map((label, index) => `<th colspan="${spans[index]}">${label}</th>`).join("");
}

function renderGroupedValueCells(
  cells: Array<{ className: string; value: string }>,
  showFree: boolean,
  showTiered: boolean,
  needsWideAmount: boolean,
) {
  if (!cells.length) return `<td colspan="${GROUP_GRID_UNITS}" class="group-empty-cell"></td>`;
  const spans = groupFieldSpans(showFree, showTiered, needsWideAmount);
  return cells
    .map(
      (cell, index) =>
        `<td colspan="${spans[index]}" class="${cell.className}${cell.value ? "" : " group-empty-cell"}">${cell.value}</td>`,
    )
    .join("");
}

// 伦理列子字段默认均分（四等分/三等分/二等分），保证同名字段在各列宽度一致；
// 当该列金额较大时给金额列多借 1 单位（从减免/梯度列扣），避免大额数字溢出。
function groupFieldSpans(showFree: boolean, showTiered: boolean, needsWideAmount: boolean) {
  const parts = 1 + (showFree ? 1 : 0) + (showTiered ? 1 : 0) + 1;
  const base = Math.floor(GROUP_GRID_UNITS / parts);
  const remainder = GROUP_GRID_UNITS % parts;
  const spans = Array.from({ length: parts }, (_, index) => base + (index < remainder ? 1 : 0));
  if (needsWideAmount && parts >= 3) {
    spans[spans.length - 1] += 1;
    for (let index = 1; index < spans.length - 1; index += 1) {
      if (spans[index] > 1) {
        spans[index] -= 1;
        break;
      }
    }
  }
  return spans;
}

function modelLine(line: BillingStatementLine, columns: SettlementColumn[]) {
  const perColumn = new Map(columns.map((column) => [column.key, emptySummary()]));
  const explicitBreakdown = (line.iacucBreakdown || []).filter((raw) => {
    const item = raw as Breakdown;
    return (
      item.supportAmount !== undefined ||
      item.payableAmount !== undefined ||
      item.tier2Cages !== undefined ||
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
      current.hasRecord = true;
      perColumn.set(columnKey, current);
    }
    return {
      date: line.date,
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
      let tier2Count = 0;
      let tier2Billable = 0;
      if (group.tiered) {
        const tier1Count = Math.min(remainingTier1Slots, count);
        tier2Count = Math.max(count - tier1Count, 0);
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
      current.tier2Billable += tier2Count;
      perColumn.set(column.key, current);
    }
  }

  return {
    date: line.date,
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
    Number(item.statementUnitPrice ?? item.unitPrice ?? 0).toFixed(2),
    Number(item.statementOverageUnitPrice ?? item.overageUnitPrice ?? 0).toFixed(2),
    (item.statementTiered ?? item.tiered) ? "1" : "0",
    (item.statementFreeAllowance ?? item.freeAllowance) ? "1" : "0",
    (item.statementFullExemption ?? item.fullExemption) ? "1" : "0",
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
  return { count: 0, free: 0, support: 0, amount: 0, tier2Billable: 0, hasRecord: false };
}
