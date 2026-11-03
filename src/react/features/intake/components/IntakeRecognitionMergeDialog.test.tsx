import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { ReactNode } from "react";

import type { IntakeRecognitionMergePreview } from "../../../../contracts/intake";
import { createIntakeDraft } from "../../../../domain/intake";
import { IntakeRecognitionMergeDialog } from "./IntakeRecognitionMergeDialog";

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
function response(): IntakeRecognitionMergePreview {
  const item = {
    ...createIntakeDraft("接收人"),
    id: "image-original",
    batchNo: "B-1",
    purchaseOrderNo: "P-1",
    quantity: 30,
  };
  return {
    total: 1,
    items: [
      {
        item,
        matchedFields: ["batchNo", "purchaseOrderNo"],
        classification: "same_pair",
        canMerge: true,
        reason: "已有图片预约",
        mergedItem: item,
        confirmationToken: "token",
        changes: [
          { field: "quantity", before: 30, incoming: 100, after: 30, source: "image" },
          { field: "intakeDate", before: "", incoming: "2026-11-03", after: "2026-11-03", source: "text" },
        ],
      },
    ],
  };
}

it("shows server-produced before/text/after values and only writes through explicit confirmation", () => {
  const onConfirm = vi.fn();
  const onClose = vi.fn();
  const preview = response();
  preview.items[0].item.recognition = {
    extractedText: "原图文字",
    warnings: [],
    fieldSources: {},
    images: [
      {
        id: "original",
        name: "预约原图.png",
        url: "/original-image",
        mime: "image/png",
        size: 10,
        sha256: "hash",
        createdAt: "now",
      },
    ],
  };
  render(
    <IntakeRecognitionMergeDialog
      preview={preview}
      pending={false}
      error=""
      onClose={onClose}
      onConfirm={onConfirm}
      onRefresh={vi.fn()}
    />,
  );
  expect(screen.getByRole("columnheader", { name: "确认后" })).toBeInTheDocument();
  expect(screen.getAllByText("30")).toHaveLength(2);
  expect(screen.getByText("100")).toBeInTheDocument();
  expect(screen.getByRole("img", { name: "原预约图片：预约原图.png" })).toHaveAttribute("src", "/original-image");
  expect(screen.getByText("文字补充")).toBeInTheDocument();
  expect(onConfirm).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "取消合并，保留草稿" }));
  expect(onClose).toHaveBeenCalledOnce();
  fireEvent.click(screen.getByRole("button", { name: /确认更新原预约/ }));
  expect(onConfirm).toHaveBeenCalledOnce();
});

it("requires a refreshed preview after a stale-save error", () => {
  const onRefresh = vi.fn();
  render(
    <IntakeRecognitionMergeDialog
      preview={response()}
      pending={false}
      blocked
      error="预约已更新"
      onClose={vi.fn()}
      onConfirm={vi.fn()}
      onRefresh={onRefresh}
    />,
  );
  expect(screen.getByRole("button", { name: "确认更新原预约" })).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "重新匹配" }));
  expect(onRefresh).toHaveBeenCalledOnce();
});

it("shows blocked and multiple matches without offering an update action", () => {
  const preview = response();
  preview.total = 2;
  preview.items[0].reason = "匹配多条记录，请核对编号";
  render(
    <IntakeRecognitionMergeDialog
      preview={preview}
      pending={false}
      error=""
      onClose={vi.fn()}
      onConfirm={vi.fn()}
      onRefresh={vi.fn()}
    />,
  );
  expect(screen.getByText("匹配多条记录，请核对编号")).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "确认更新原预约" })).not.toBeInTheDocument();
});

it("keeps distinct full order suffixes visible and follows the server's merge conflict", () => {
  const preview = response();
  preview.items[0].item.purchaseOrderNo = "C2026110229486";
  preview.items[0].item.orderNo = "DC202611022948601";
  preview.items[0].matchedFields = ["purchaseOrderNo", "orderNo"];
  preview.items[0].classification = "association_conflict";
  preview.items[0].canMerge = false;
  preview.items[0].reason = "完整订单编号不一致，请核对";
  preview.items[0].changes = [
    {
      field: "orderNo",
      before: "DC202611022948601",
      incoming: "DC202611022948607",
      after: "DC202611022948601",
      source: "image",
    },
  ];
  render(
    <IntakeRecognitionMergeDialog
      preview={preview}
      pending={false}
      error=""
      onClose={vi.fn()}
      onConfirm={vi.fn()}
      onRefresh={vi.fn()}
    />,
  );
  expect(screen.getByText("订单编号：DC202611022948601")).toBeInTheDocument();
  expect(screen.getByRole("cell", { name: "DC202611022948607" })).toBeInTheDocument();
  expect(screen.getByRole("cell", { name: "订单编号" })).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "确认更新原预约" })).not.toBeInTheDocument();
});

it("blocks close and duplicate confirmation while a merge write is pending", () => {
  const onClose = vi.fn();
  const onConfirm = vi.fn();
  render(
    <IntakeRecognitionMergeDialog
      preview={response()}
      pending
      error=""
      onClose={onClose}
      onConfirm={onConfirm}
      onRefresh={vi.fn()}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "取消合并，保留草稿" }));
  fireEvent.click(screen.getByRole("button", { name: /确认更新原预约/ }));
  expect(onClose).not.toHaveBeenCalled();
  expect(onConfirm).not.toHaveBeenCalled();
});
