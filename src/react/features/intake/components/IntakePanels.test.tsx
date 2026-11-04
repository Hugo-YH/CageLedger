import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { normalizeIntakeBatch } from "../../../../domain/intake";
import { IntakeEntryPanel } from "./IntakePanels";

beforeEach(() => {
  vi.stubGlobal("matchMedia", () => ({
    matches: false,
    addListener() {},
    removeListener() {},
    addEventListener() {},
    removeEventListener() {},
  }));
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it.each([false, true])("keeps purchase and order inputs separate in the entry form (editing=%s)", (editing) => {
  const draft = normalizeIntakeBatch({ purchaseOrderNo: "DC202611022948607", supplier: "供应商", roomName: "8014" });
  const onUpdate = vi.fn();
  render(
    <IntakeEntryPanel
      editing={editing}
      draft={draft}
      roomNames={["8014"]}
      notice=""
      saving={false}
      onSubmit={vi.fn()}
      onParse={vi.fn()}
      onAiParse={vi.fn()}
      aiPending={false}
      onPrint={vi.fn()}
      onUpdate={onUpdate}
      recognitionImages={[]}
      recognitionError=""
      onAddImages={vi.fn()}
      onRemoveImage={vi.fn()}
    />,
  );
  expect(screen.getByRole("textbox", { name: "采购单号" })).toHaveValue("C2026110229486");
  const order = screen.getByRole("textbox", { name: "订单编号" });
  expect(order).toHaveValue("DC202611022948607");
  fireEvent.change(order, { target: { value: "DC202611022948601" } });
  expect(onUpdate).toHaveBeenLastCalledWith("orderNo", "DC202611022948601");
  const groupedOrders = "DC202609212926501\nDC202609212923401";
  fireEvent.change(order, { target: { value: groupedOrders } });
  expect(onUpdate).toHaveBeenLastCalledWith("orderNo", groupedOrders);
  const groupedBatches = "（Z2025034）2025090302；（Z2025034）2025090313";
  fireEvent.change(screen.getByRole("textbox", { name: "饲养需求批次编号" }), { target: { value: groupedBatches } });
  expect(onUpdate).toHaveBeenLastCalledWith("batchNo", groupedBatches);
  fireEvent.change(screen.getByRole("textbox", { name: "采购单号" }), { target: { value: "线下采购" } });
  expect(onUpdate).toHaveBeenLastCalledWith("purchaseOrderNo", "线下采购");
  expect(draft.orderNo).toBe("DC202611022948607");
});
