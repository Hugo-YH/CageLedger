import type { QuantitySheetRow } from "../../../api/contracts";

export const QUANTITY_ROWS_PER_PAGE = 31;
const QUANTITY_FIELD_ORDER: Record<string, number> = {
  date: 0,
  addedCount: 1,
  addedType: 2,
  addedTransferIn: 3,
  removedCount: 4,
  removedType: 5,
  removedTransferOut: 6,
  animalCount: 7,
  cageCount: 8,
};
export type QuantityRowHandle = {
  getRow: () => QuantitySheetRow;
  setCalculated: (animals: number, cages: number) => void;
};

export function quantityTabTarget(
  scope: HTMLElement,
  current: HTMLElement,
  backwards: boolean,
): HTMLElement | undefined {
  const fields = Array.from(scope.querySelectorAll<HTMLElement>('[data-quantity-focusable="true"]'))
    .map((element) => ({
      element,
      page: Number(element.dataset.quantityPage || 0),
      row: Number(element.dataset.quantityRow || 0),
      field: QUANTITY_FIELD_ORDER[element.dataset.quantityField || ""] ?? 99,
    }))
    .sort((left, right) => left.page - right.page || left.row - right.row || left.field - right.field);
  const index = fields.findIndex(({ element }) => element === current);
  if (index < 0) return undefined;
  const direction = backwards ? -1 : 1;
  // Only measure potential destinations. Reading every input's geometry on
  // each keystroke needlessly forces layout across the entire monthly table.
  for (let next = index + direction; next >= 0 && next < fields.length; next += direction) {
    const element = fields[next].element;
    if (
      !element.hasAttribute("disabled") &&
      element.getAttribute("aria-disabled") !== "true" &&
      element.getClientRects().length
    ) {
      return element;
    }
  }
  return undefined;
}

export function monthEnd(month: string) {
  const [year, value] = month.split("-").map(Number);
  return `${month}-${String(new Date(year, value, 0).getDate()).padStart(2, "0")}`;
}
export function normalizeEditorDate(value: string, month: string) {
  const raw = value.trim().replace(/[０-９]/g, (character) => String.fromCharCode(character.charCodeAt(0) - 0xfee0));
  if (!raw) return "";
  const day = /^\d{1,2}$/.test(raw) ? Number(raw) : null;
  const parts = raw.match(/^(\d{4})[-/.年](\d{1,2})[-/.月](\d{1,2})日?$/);
  const candidate =
    day == null
      ? parts
        ? `${parts[1]}-${String(Number(parts[2])).padStart(2, "0")}-${String(Number(parts[3])).padStart(2, "0")}`
        : ""
      : `${month}-${String(day).padStart(2, "0")}`;
  return candidate >= `${month}-01` && candidate <= monthEnd(month) ? candidate : "";
}
