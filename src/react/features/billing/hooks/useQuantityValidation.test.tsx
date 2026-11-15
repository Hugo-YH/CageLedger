import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

import { createQuantityRow, normalizeQuantitySheet } from "../../../../domain/quantitySheets";
import type { QuantityRowHandle } from "../components/quantityEntry";
import { useQuantityValidation } from "./useQuantityValidation";

afterEach(() => cleanup());

it("keeps expanded animal inputs mounted through native invalid after domain errors are corrected until reset", () => {
  const row = { ...createQuantityRow("2026-10", true), addedCount: 2, animalCount: 1.5 };
  const sheet = normalizeQuantitySheet({ month: "2026-10", roomId: "mouse", iacuc: "Z1", rows: [row] });
  const setValidationIssues = vi.fn();
  const rowRefs: { current: Array<QuantityRowHandle | null> } = {
    current: [{ getRow: () => sheet.rows[0], setCalculated: vi.fn(), setValidationIssues }],
  };
  function Editor() {
    const { validateSheet, validationRowsExpanded, resetValidation } = useQuantityValidation(rowRefs);
    return (
      <>
        <button onClick={() => validateSheet(sheet)}>校验</button>
        <button onClick={resetValidation}>新建</button>
        {validationRowsExpanded ? (
          <form onInvalidCapture={() => validateSheet(sheet)}>
            <input aria-label="动物结余" type="number" min={0} defaultValue="1.5" />
          </form>
        ) : null}
      </>
    );
  }
  render(<Editor />);
  fireEvent.click(screen.getByRole("button", { name: "校验" }));
  expect(setValidationIssues).toHaveBeenLastCalledWith([expect.objectContaining({ field: "addedType" })]);
  sheet.rows[0].addedType = "购入";
  const input = screen.getByRole<HTMLInputElement>("spinbutton", { name: "动物结余" });
  let valid = true;
  act(() => {
    valid = input.checkValidity();
  });
  expect(valid).toBe(false);
  expect(input.validity.stepMismatch).toBe(true);
  expect(setValidationIssues).toHaveBeenLastCalledWith([]);
  expect(screen.getByRole("spinbutton", { name: "动物结余" })).toBe(input);
  expect(input).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "新建" }));
  expect(screen.queryByRole("spinbutton", { name: "动物结余" })).not.toBeInTheDocument();
});
