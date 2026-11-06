import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createRef } from "react";
import { afterEach, expect, it, vi } from "vitest";

import { createQuantityRow } from "../../../../domain/quantitySheets";
import { QuantityEntryCells } from "./QuantityEntryCells";
import type { QuantityRowHandle } from "./quantityEntry";

afterEach(() => cleanup());

it("keeps date and transfer edits local while only numeric changes notify balance propagation", () => {
  const ref = createRef<QuantityRowHandle>();
  const changed = vi.fn();
  render(
    <table>
      <tbody>
        <tr>
          <QuantityEntryCells
            ref={ref}
            row={{ ...createQuantityRow("2026-10", true), addedType: "转入", removedType: "转出" }}
            index={0}
            month="2026-10"
            shortViewport={false}
            showCalculatedPlaceholders
            onChanged={changed}
          />
        </tr>
      </tbody>
    </table>,
  );
  expect(changed).toHaveBeenCalledOnce();
  fireEvent.change(screen.getByRole("textbox", { name: "第 1 行日期" }), { target: { value: "2026-10-12" } });
  fireEvent.change(screen.getByRole("textbox", { name: "第 1 行转入伦理号" }), { target: { value: "Z-IN" } });
  fireEvent.change(screen.getByRole("textbox", { name: "第 1 行转出伦理号" }), { target: { value: "Z-OUT" } });
  expect(changed).toHaveBeenCalledOnce();
  expect(ref.current?.getRow()).toMatchObject({
    date: "2026-10-12",
    transferInFromIacuc: "Z-IN",
    transferOutToIacuc: "Z-OUT",
  });

  for (const [field, value] of [
    ["增加", "5"],
    ["减少", "2"],
    ["结余总数", "9"],
    ["结余笼数", "3"],
  ]) {
    fireEvent.change(screen.getByRole("spinbutton", { name: `第 1 行${field}` }), { target: { value } });
  }
  expect(changed).toHaveBeenCalledTimes(5);
  act(() => ref.current?.setCalculated(99, 33));
  expect(changed).toHaveBeenCalledTimes(5);
  expect(ref.current?.getRow()).toMatchObject({ addedCount: 5, removedCount: 2, animalCount: 9, cageCount: 3 });
});
