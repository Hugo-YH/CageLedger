import type { SettlementColumn, ColumnSummary } from "./settlementModel";
import { emptySummary } from "./settlementModel";

type SettlementPageSlot = { column: SettlementColumn | null; summary: ColumnSummary };

type SettlementPage = { slots: SettlementPageSlot[]; showLeadingTotals: boolean };

export function paginateColumns(columns: SettlementColumn[]) {
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
