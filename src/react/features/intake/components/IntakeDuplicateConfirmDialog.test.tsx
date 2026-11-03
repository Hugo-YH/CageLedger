import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import type { IntakeDuplicateItem } from "../../../../contracts/intake";
import { IntakeDuplicateConfirmDialog } from "./IntakeDuplicateConfirmDialog";

vi.mock("../../../components/WorkspaceUi", () => ({
  ModalShell: ({ children }: { children: ReactNode }) => <section>{children}</section>,
}));
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

it("shows an order-number match with separate purchase and full order IDs before duplicate confirmation", () => {
  const item: IntakeDuplicateItem = {
    id: "original",
    purchaseOrderNo: "DC202611022948607",
    batchNo: "B1",
    intakeDate: "",
    pi: "甲",
    owner: "乙",
    status: "pending_print",
    matchedFields: ["orderNo"],
  };
  const onConfirm = vi.fn();
  render(
    <IntakeDuplicateConfirmDialog
      details={{ items: [item], total: 1, confirmationToken: "token" }}
      error=""
      pending={false}
      onClose={vi.fn()}
      onConfirm={onConfirm}
    />,
  );
  expect(screen.getByRole("columnheader", { name: "采购单号" })).toBeInTheDocument();
  expect(screen.getByRole("columnheader", { name: "订单编号" })).toBeInTheDocument();
  expect(screen.getByRole("cell", { name: "C2026110229486" })).toBeInTheDocument();
  expect(screen.getByRole("cell", { name: "DC202611022948607" })).toBeInTheDocument();
  expect(screen.getByRole("cell", { name: "订单编号" })).toBeInTheDocument();
  expect(onConfirm).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "仍然保存" }));
  expect(onConfirm).toHaveBeenCalledOnce();
  expect(item.purchaseOrderNo).toBe("DC202611022948607");
});
