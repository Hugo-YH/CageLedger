import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, expect, it, vi } from "vitest";

import type { BillingStatementResponse } from "../../../api/contracts";
import parityFixture from "../../../print/fixtures/settlement-parity.json";
import { openSettlementPrint, settlementStatementHtml } from "../../../print/settlement";
import { SettlementPreviewModal } from "./SettlementPreviewModal";

vi.mock("../../../print/settlement", () => ({
  openSettlementPrint: vi.fn(() => true),
  settlementStatementHtml: vi.fn(
    (result: BillingStatementResponse) => `<!doctype html><html><body>${result.statement.id}</body></html>`,
  ),
}));
vi.mock("../../../hooks/useOperationFeedback", () => ({
  useOperationFeedback: () => ({ info: vi.fn(), error: vi.fn() }),
}));
vi.mock("../../../components/ui/Modal", () => ({
  Modal: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
}));
vi.mock("../../../components/ui", () => ({
  CommandBar: ({ actions, primaryAction }: { actions?: ReactNode; primaryAction?: ReactNode }) => (
    <div>
      {actions}
      {primaryAction}
    </div>
  ),
}));
vi.mock("./BatchWithdrawConfirmModal", () => ({ BatchWithdrawConfirmModal: () => null }));
vi.mock("antd", () => ({
  Alert: () => null,
  Button: ({ children, onClick, disabled }: { children?: ReactNode; onClick?: () => void; disabled?: boolean }) => (
    <button type="button" onClick={onClick} disabled={disabled}>
      {children}
    </button>
  ),
  Tooltip: ({ children }: { children?: ReactNode }) => children,
  Typography: { Text: ({ children }: { children?: ReactNode }) => <span>{children}</span> },
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

it("reuses only the displayed result's document across progress renders and refreshes it for a new result", () => {
  const result = parityFixture as BillingStatementResponse;
  const props = {
    selected: {
      id: "candidate",
      month: result.statement.month,
      pi: result.statement.pi,
      iacucs: [],
      manager: "",
      totalAmount: 90,
    },
    result,
    generatePending: false,
    pdfExporting: false,
    hasWorkflow: false,
    revertPending: false,
    canWithdraw: false,
    onClose: vi.fn(),
    onExportPdf: vi.fn(),
    onRevert: vi.fn<() => Promise<void>>(),
    onStartSettlement: vi.fn(),
  };
  const { rerender } = render(<SettlementPreviewModal {...props} />);
  const original = screen.getByTitle("结算单预览").getAttribute("srcdoc");
  expect(settlementStatementHtml).toHaveBeenCalledOnce();
  rerender(<SettlementPreviewModal {...props} generatePending pdfExporting />);
  fireEvent.click(screen.getByRole("button", { name: "打印结算单" }));
  fireEvent.click(screen.getByRole("button", { name: "打印结算单" }));
  expect(settlementStatementHtml).toHaveBeenCalledOnce();
  expect(openSettlementPrint).toHaveBeenNthCalledWith(1, result, original);
  expect(openSettlementPrint).toHaveBeenNthCalledWith(2, result, original);

  const next = { ...result, statement: { ...result.statement, id: "next-version" } };
  rerender(<SettlementPreviewModal {...props} result={next} />);
  expect(settlementStatementHtml).toHaveBeenCalledTimes(2);
  const updated = screen.getByTitle("结算单预览").getAttribute("srcdoc");
  expect(updated).not.toBe(original);
  fireEvent.click(screen.getByRole("button", { name: "打印结算单" }));
  expect(openSettlementPrint).toHaveBeenLastCalledWith(next, updated);
});
