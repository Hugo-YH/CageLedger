import type { BillingStatementResponse } from "../api/contracts";
import { technicalServiceMarkup, technicalServiceHtml } from "./technicalServices";
import { settlementNotesMarkup } from "./settlementNotes";
import {
  displayUnitLabel,
  documentNumberFor,
  escapeHtml,
  money,
  settlementPrintStyles,
  settlementSpeciesHeaders,
  settlementStatementDocumentTitle,
} from "./settlementSupport";
import { collectColumns, emptySummary, modelLine, resolveUnit, summarizeColumns } from "./settlementModel";
import { paginateColumns } from "./settlementPagination";
import { GROUP_GRID_UNITS, renderGroupCells, renderGroupHeaders } from "./settlementGroupCells";

export function settlementStatementMarkup(result: BillingStatementResponse) {
  if (result.statement.sourceType === "pi_merged_technical_service") return technicalServiceMarkup(result.statement);
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
  const allMouseSlots = columns
    .filter((column) => column.speciesLabel === "小鼠")
    .map((column) => ({ column, summary: totalsByKey.get(column.key) || emptySummary() }));

  const statementPages = pagedColumns
    .map((page, pageIndex) => {
      const resolvedSlots = page.slots.map((slot) => ({
        column: slot.column,
        summary: slot.column ? totals.find((item) => item.key === slot.column?.key) || emptySummary() : emptySummary(),
      }));
      const mouseSlots = page.showLeadingTotals
        ? allMouseSlots
        : resolvedSlots.filter((slot) => slot.column?.speciesLabel === "小鼠");
      const pageHasFree = page.showLeadingTotals
        ? mouseSlots.some((slot) => slot.summary.free > 0)
        : resolvedSlots.some((slot) => slot.summary.free > 0);
      const pageHasTier = page.showLeadingTotals
        ? mouseSlots.some((slot) => slot.summary.tier2Billable > 0)
        : resolvedSlots.some((slot) => slot.summary.tier2Billable > 0);
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
      const pageFooter = `<div class="page-footer">第${pageIndex + 1}页 共${totalPages}页</div>`;
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
  if (result.statement.sourceType === "pi_merged_technical_service") return technicalServiceHtml(result, autoPrint);
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
