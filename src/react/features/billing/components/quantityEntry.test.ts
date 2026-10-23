import { afterEach, expect, it, vi } from "vitest";

import { quantityTabTarget } from "./quantityEntry";

afterEach(() => {
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

function field(scope: HTMLElement, row: number, name: string, visible = true, disabled = false) {
  const input = document.createElement("input");
  Object.assign(input.dataset, {
    quantityFocusable: "true",
    quantityPage: Math.floor(row / 31),
    quantityRow: row,
    quantityField: name,
  });
  input.disabled = disabled;
  const measure = vi.fn(() => ({ length: visible ? 1 : 0 }) as DOMRectList);
  input.getClientRects = measure;
  scope.append(input);
  return { input, measure };
}

it("uses logical row order across the two printed columns and pages", () => {
  const scope = document.createElement("div");
  const nextPage = field(scope, 31, "date");
  const rightColumn = field(scope, 15, "date");
  const leftColumn = field(scope, 14, "cageCount");
  const lastRow = field(scope, 30, "cageCount");
  expect(quantityTabTarget(scope, leftColumn.input, false)).toBe(rightColumn.input);
  expect(quantityTabTarget(scope, rightColumn.input, true)).toBe(leftColumn.input);
  expect(quantityTabTarget(scope, lastRow.input, false)).toBe(nextPage.input);
  expect(quantityTabTarget(scope, nextPage.input, false)).toBeUndefined();
  expect(quantityTabTarget(scope, leftColumn.input, true)).toBeUndefined();
});

it("skips hidden, disabled and conditional transfer fields without measuring later rows", () => {
  const scope = document.createElement("div");
  const date = field(scope, 0, "date");
  const hidden = field(scope, 0, "addedCount", false);
  const disabled = field(scope, 0, "addedType", true, true);
  const transfer = field(scope, 0, "addedTransferIn");
  const later = field(scope, 1, "date");
  expect(quantityTabTarget(scope, date.input, false)).toBe(transfer.input);
  expect(hidden.measure).toHaveBeenCalledTimes(1);
  expect(disabled.measure).not.toHaveBeenCalled();
  expect(later.measure).not.toHaveBeenCalled();
  transfer.input.remove();
  expect(quantityTabTarget(scope, date.input, false)).toBe(later.input);
  expect(quantityTabTarget(scope, document.createElement("input"), false)).toBeUndefined();
});
