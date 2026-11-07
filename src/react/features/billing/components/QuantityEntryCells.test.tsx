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
            animalDetails
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

it("unmounts animal controls without discarding row values or its live save handle", () => {
  const ref = createRef<QuantityRowHandle>();
  const changed = vi.fn();
  const row = { ...createQuantityRow("2026-10", true), addedType: "转入", removedType: "转出" };
  const editor = (animalDetails: boolean) => (
    <table>
      <tbody>
        <tr>
          <QuantityEntryCells
            ref={ref}
            row={row}
            index={0}
            month="2026-10"
            shortViewport={false}
            showCalculatedPlaceholders
            animalDetails={animalDetails}
            onChanged={changed}
          />
        </tr>
      </tbody>
    </table>
  );
  const { rerender } = render(editor(true));
  for (const [label, value] of [
    ["增加", "8"],
    ["减少", "2"],
    ["结余总数", "6"],
    ["转入伦理号", "Z-IN"],
    ["转出伦理号", "Z-OUT"],
  ]) {
    fireEvent.change(screen.getByLabelText(`第 1 行${label}`), { target: { value } });
  }
  const snapshot = ref.current?.getRow();
  rerender(editor(false));
  for (const label of ["增加", "减少", "结余总数", "增加类型", "减少类型", "转入伦理号", "转出伦理号"]) {
    expect(screen.queryByLabelText(`第 1 行${label}`)).not.toBeInTheDocument();
  }
  expect(ref.current?.getRow()).toEqual(snapshot);
  fireEvent.change(screen.getByLabelText("第 1 行结余笼数"), { target: { value: "3" } });
  expect(ref.current?.getRow()).toMatchObject({ ...snapshot, cageCount: 3 });
  rerender(editor(true));
  for (const [label, value] of [
    ["增加", 8],
    ["减少", 2],
    ["结余总数", 6],
  ] as const) {
    expect(screen.getByLabelText(`第 1 行${label}`)).toHaveValue(value);
  }
  expect(screen.getByLabelText("第 1 行转入伦理号")).toHaveValue("Z-IN");
  expect(screen.getByLabelText("第 1 行转出伦理号")).toHaveValue("Z-OUT");
  expect(screen.getByLabelText("第 1 行结余笼数")).toHaveValue(3);
});
