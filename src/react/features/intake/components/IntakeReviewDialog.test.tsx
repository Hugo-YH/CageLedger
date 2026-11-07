import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import type { IntakeReviewPreview } from "../../../../contracts/intake";
import { createIntakeDraft } from "../../../../domain/intake";
import { IntakeReviewDialog } from "./IntakeReviewDialog";

vi.mock("../../../components/WorkspaceUi", () => ({
  ModalShell: ({ children, ariaLabel }: { children: ReactNode; ariaLabel: string }) => (
    <section role="dialog" aria-label={ariaLabel}>
      {children}
    </section>
  ),
}));
beforeEach(() => {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  vi.stubGlobal("matchMedia", () => ({
    matches: false,
    addListener() {},
    removeListener() {},
    addEventListener() {},
    removeEventListener() {},
  }));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
const incoming = { ...createIntakeDraft("录入人"), rawMessage: "本次采购原文", batchNo: "B1" };
function response(): IntakeReviewPreview {
  const original = { ...incoming, id: "original", rawMessage: "原预约原文", updatedAt: "original-v1" };
  return {
    reviewVersion: 2,
    outcome: "registered",
    sourceIssues: [],
    incoming,
    total: 1,
    items: [
      {
        item: original,
        matchedFields: ["batchNo"],
        classification: "same_pair",
        canMerge: true,
        reason: "动物信息一致，可选择补充本次新图片",
        mergedItem: original,
        confirmationToken: "token",
        changes: [],
        reviewStatus: "registered",
        canAcknowledge: true,
        comparisons: [
          { field: "quantity", before: 24, incoming: 24, status: "same" },
          { field: "specification", before: "6周龄", incoming: "6周龄", status: "same" },
        ],
      },
    ],
  };
}
function setup(preview = response()) {
  const actions = {
    onClose: vi.fn(),
    onConfirm: vi.fn(),
    onRefresh: vi.fn(),
    onAcknowledge: vi.fn(),
    onEdit: vi.fn(),
    onCreateAnother: vi.fn(),
  };
  render(
    <IntakeReviewDialog
      preview={preview}
      incoming={incoming}
      images={[]}
      pending={false}
      error=""
      blocked={false}
      {...actions}
    />,
  );
  return actions;
}
it("defaults to a read-only registered acknowledgement and keeps supplement an explicit alternative", () => {
  const actions = setup();
  expect(screen.getAllByText("一致")).toHaveLength(2);
  expect(actions.onConfirm).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "已登记，结束本次录入" }));
  expect(actions.onAcknowledge).toHaveBeenCalledExactlyOnceWith("original");
  expect(actions.onConfirm).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "确认补充原预约" }));
  expect(actions.onConfirm).toHaveBeenCalledExactlyOnceWith("original");
});
it("shows conflicting and unknown fields without offering acknowledgement or supplement", () => {
  const preview = response();
  preview.outcome = "conflict";
  preview.sourceIssues = [{ field: "quantity", message: "同次两张图片的本批数量不一致" }];
  preview.items[0] = {
    ...preview.items[0],
    canMerge: false,
    canAcknowledge: false,
    comparisons: [
      { field: "quantity", before: 24, incoming: 99, status: "different" },
      { field: "strainStandard", before: "C57BL/6J", incoming: "", status: "unknown" },
    ],
  };
  const actions = setup(preview);
  expect(screen.getByText(/同次两张图片的本批数量不一致/)).toBeInTheDocument();
  expect(screen.getByText("不一致")).toBeInTheDocument();
  expect(screen.getByText("无法确认")).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "已登记，结束本次录入" })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "确认补充原预约" })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "在当前页面编辑原预约" }));
  expect(actions.onEdit).toHaveBeenCalledExactlyOnceWith("original");
});
it("does not choose the first of multiple ambiguous candidates", () => {
  const preview = response();
  preview.items = [
    preview.items[0],
    { ...preview.items[0], item: { ...preview.items[0].item, id: "second", batchNo: "B2" } },
  ];
  preview.total = 2;
  const actions = setup(preview);
  expect(screen.queryByRole("button", { name: "已登记，结束本次录入" })).not.toBeInTheDocument();
  fireEvent.click(screen.getAllByRole("button", { name: "查看此预约" })[1]);
  fireEvent.click(screen.getByRole("button", { name: "已登记，结束本次录入" }));
  expect(actions.onAcknowledge).toHaveBeenCalledExactlyOnceWith("second");
});
it("keeps received records available for read-only acknowledgement without an update action", () => {
  const preview = response();
  preview.items[0].item.status = "received";
  preview.items[0].canMerge = false;
  setup(preview);
  expect(screen.getByRole("button", { name: "已登记，结束本次录入" })).toBeEnabled();
  expect(screen.queryByRole("button", { name: "确认补充原预约" })).not.toBeInTheDocument();
});
