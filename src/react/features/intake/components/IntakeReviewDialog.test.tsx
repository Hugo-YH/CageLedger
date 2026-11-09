import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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
it("defaults to a read-only registered acknowledgement and keeps supplement an explicit alternative", async () => {
  const actions = setup();
  const sources = screen.getByRole("region", { name: "预约来源材料" });
  fireEvent.click(within(sources).getByRole("button", { name: /原预约原文与图片/ }));
  fireEvent.click(within(sources).getByRole("button", { name: /本次原文与图片/ }));
  await waitFor(() => {
    expect(within(sources).getByText("原预约原文")).toBeVisible();
    expect(within(sources).getByText("本次采购原文")).toBeVisible();
  });
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
  const footer = screen.getByRole("group", { name: "预约核对操作" });
  fireEvent.click(within(footer).getByRole("button", { name: "编辑已保存的预约" }));
  expect(actions.onEdit).toHaveBeenCalledExactlyOnceWith("original");
  expect(actions.onClose).not.toHaveBeenCalled();
  fireEvent.click(within(footer).getByRole("button", { name: "返回本次录入" }));
  expect(actions.onClose).toHaveBeenCalledExactlyOnceWith();
  expect(actions.onConfirm).not.toHaveBeenCalled();
});
it("previews retained image values and text additions before explicitly supplementing a differing appointment", () => {
  const preview = response();
  const original = {
    ...preview.items[0].item,
    quantity: 15,
    sex: "雄性",
    specification: "6-8w",
    strainRaw: "C57BL/6J",
    strainStandard: "",
    roomName: "",
  };
  preview.outcome = "supplement";
  preview.items[0] = {
    ...preview.items[0],
    item: original,
    reviewStatus: "supplement",
    mergeStrategy: "saved_image_first",
    canAcknowledge: false,
    mergedItem: { ...original, roomName: "房间1" },
    comparisons: [
      { field: "sex", before: "雄性", incoming: "雌性/雄性", status: "different" },
      { field: "specification", before: "6-8w", incoming: "", status: "missing" },
      { field: "strainStandard", before: "C57BL/6J", incoming: "", status: "missing" },
      { field: "roomName", before: "", incoming: "房间1", status: "supplement" },
    ],
  };
  const actions = setup(preview);
  const rowValues = (name: RegExp) =>
    within(screen.getByRole("row", { name }))
      .getAllByRole("cell")
      .map((cell) => cell.textContent);
  expect(screen.getByRole("columnheader", { name: "合并后" })).toBeInTheDocument();
  expect(rowValues(/性别/)).toEqual(["性别", "雄性", "雌性/雄性", "雄性", "不一致"]);
  expect(rowValues(/规格/)).toEqual(["规格", "6-8w", "未填写", "6-8w", "本次缺失"]);
  expect(rowValues(/标准品系/)).toEqual(["标准品系", "C57BL/6J", "未填写", "C57BL/6J", "本次缺失"]);
  expect(rowValues(/房间 未填写/)).toEqual(["房间", "未填写", "房间1", "房间1", "可补充"]);
  expect(screen.queryByRole("button", { name: "已登记，结束本次录入" })).not.toBeInTheDocument();
  expect(actions.onConfirm).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "确认补充原预约" }));
  expect(actions.onConfirm).toHaveBeenCalledExactlyOnceWith("original");
});
it("does not choose the first of multiple ambiguous candidates", async () => {
  const preview = response();
  preview.items = [
    preview.items[0],
    {
      ...preview.items[0],
      item: { ...preview.items[0].item, id: "second", batchNo: "B2", rawMessage: "第二条已保存预约原文" },
    },
  ];
  preview.total = 2;
  const actions = setup(preview);
  const sources = screen.getByRole("region", { name: "预约来源材料" });
  expect(screen.queryByRole("button", { name: "已登记，结束本次录入" })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "编辑已保存的预约" })).not.toBeInTheDocument();
  expect(within(sources).queryByRole("button", { name: /原预约原文与图片/ })).not.toBeInTheDocument();
  fireEvent.click(within(sources).getByRole("button", { name: /本次原文与图片/ }));
  await waitFor(() => expect(within(sources).getByText("本次采购原文")).toBeVisible());
  fireEvent.click(screen.getAllByRole("button", { name: "查看此预约" })[1]);
  fireEvent.click(within(sources).getByRole("button", { name: /原预约原文与图片/ }));
  await waitFor(() => expect(within(sources).getByText("第二条已保存预约原文")).toBeVisible());
  fireEvent.click(screen.getByRole("button", { name: "编辑已保存的预约" }));
  expect(actions.onEdit).toHaveBeenCalledExactlyOnceWith("second");
  fireEvent.click(screen.getByRole("button", { name: "已登记，结束本次录入" }));
  expect(actions.onAcknowledge).toHaveBeenCalledExactlyOnceWith("second");
});
it("keeps the current source available when a source conflict has no saved appointment candidate", async () => {
  const preview = response();
  preview.items = [];
  preview.total = 0;
  preview.outcome = "conflict";
  preview.sourceIssues = [{ field: "quantity", message: "本次图片数量需要核对" }];
  setup(preview);
  const sources = screen.getByRole("region", { name: "预约来源材料" });
  fireEvent.click(within(sources).getByRole("button", { name: /本次原文与图片/ }));
  await waitFor(() => expect(within(sources).getByText("本次采购原文")).toBeVisible());
  expect(within(sources).queryByRole("button", { name: /原预约原文与图片/ })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "编辑已保存的预约" })).not.toBeInTheDocument();
});
it("keeps received records available for read-only acknowledgement without an update action", () => {
  const preview = response();
  preview.items[0].item.status = "received";
  preview.items[0].canMerge = false;
  setup(preview);
  expect(screen.getByRole("button", { name: "已登记，结束本次录入" })).toBeEnabled();
  expect(screen.queryByRole("button", { name: "确认补充原预约" })).not.toBeInTheDocument();
});
