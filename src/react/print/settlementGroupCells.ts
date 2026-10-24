import { escapeHtml, money } from "./settlementSupport";
import type { ColumnSummary } from "./settlementModel";

export const GROUP_GRID_UNITS = 12;

export function renderGroupHeaders(
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

export function renderGroupCells(
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
