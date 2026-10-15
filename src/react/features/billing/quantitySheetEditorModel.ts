import type { QuantitySheet, QuantitySheetRow } from "../../api/contracts";
import { createQuantityRow } from "../../../domain/quantitySheets";

export const todayMonth = new Date().toISOString().slice(0, 7);
export const QUANTITY_ROWS_PER_PAGE = 31;

export function makeEditorRows(sheet: QuantitySheet) {
  const count = Math.max(sheet.pageCount, 1) * QUANTITY_ROWS_PER_PAGE;
  return Array.from({ length: count }, (_, index) => sheet.rows[index] || createQuantityRow(sheet.month, index === 0));
}
export function hasRowContent(row: QuantitySheetRow) {
  return Boolean(row.date || row.addedCount || row.removedCount || row.animalCount != null || row.cageCount != null);
}
export function saveHint(rows: QuantitySheetRow[], animalDetails: boolean) {
  return `${Math.max(rows.length / QUANTITY_ROWS_PER_PAGE, 1)} 页 · ${rows.filter(hasRowContent).length} 行 · ${animalDetails ? "记录动物数量" : "仅记录笼数"}`;
}

export function hasExpandedBillingOptions(sheet: QuantitySheet) {
  return Boolean(
    sheet.fullExemption ||
    sheet.customBillingSegments.length > 0 ||
    sheet.tierCagePriority !== null ||
    Number(sheet.preferredFreeCages || 0) > 0 ||
    sheet.freeCagePriority !== null,
  );
}
