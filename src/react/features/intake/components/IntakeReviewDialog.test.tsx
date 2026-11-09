import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import type {
  IntakeBatch,
  IntakeRecognitionImageInput,
  IntakeReviewCalculation,
  IntakeReviewPreview,
  IntakeReviewResolutions,
} from "../../../../contracts/intake";
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
const incoming = {
  ...createIntakeDraft("录入人"),
  rawMessage: "本次采购原文",
  batchNo: "B1",
  quantity: 24,
  specification: "6周龄",
};
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
function setup(
  preview = response(),
  options: {
    item?: IntakeBatch;
    images?: IntakeRecognitionImageInput[];
    pending?: boolean;
    checking?: boolean;
    blocked?: boolean;
    error?: string;
    requestedResolutions?: { candidateId: string; values: IntakeReviewResolutions };
  } = {},
) {
  const actions = {
    onClose: vi.fn(),
    onConfirm: vi.fn(),
    onRefresh: vi.fn(),
    onAcknowledge: vi.fn(),
    onEdit: vi.fn(),
    onCreateAnother: vi.fn(),
    onResolve: vi.fn(),
  };
  render(
    <IntakeReviewDialog
      preview={preview}
      incoming={options.item || incoming}
      images={options.images || []}
      pending={options.pending || false}
      checking={options.checking}
      error={options.error || ""}
      blocked={options.blocked || false}
      requestedResolutions={options.requestedResolutions}
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
  expect(within(screen.getByRole("row", { name: /^规格 / })).getByText("本次缺失")).toHaveClass("ant-tag-warning");
  expect(within(screen.getByRole("row", { name: /^房间 / })).getByText("可补充")).toHaveClass("ant-tag-processing");
  expect(screen.queryByRole("button", { name: "已登记，结束本次录入" })).not.toBeInTheDocument();
  expect(actions.onConfirm).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "确认补充原预约" }));
  expect(actions.onConfirm).toHaveBeenCalledExactlyOnceWith("original");
});
it("shows the retained 61-day period and the linked end date before confirming a new intake date", () => {
  const preview = response();
  const calculation: IntakeReviewCalculation = {
    basis: "fixed_days",
    periodSource: "saved",
    startDate: "2026-11-11",
    endDate: "2027-01-11",
    days: 61,
  };
  const original = { ...preview.items[0].item, intakeDate: "", endDate: "2027-01-04", husbandryDays: 61 };
  preview.outcome = "supplement";
  preview.items[0] = {
    ...preview.items[0],
    item: original,
    reviewStatus: "supplement",
    mergeStrategy: "saved_image_first",
    canAcknowledge: false,
    mergedItem: { ...original, intakeDate: calculation.startDate, endDate: calculation.endDate },
    changes: [
      {
        field: "endDate",
        before: original.endDate,
        incoming: "",
        after: calculation.endDate,
        source: "saved",
        calculation,
      },
    ],
    comparisons: [
      { field: "intakeDate", before: "", incoming: calculation.startDate, status: "supplement" },
      { field: "endDate", before: original.endDate, incoming: "", status: "calculated", calculation },
      { field: "husbandryDays", before: 61, incoming: null, status: "retained", calculation },
    ],
  };
  const actions = setup(preview);
  const end = within(screen.getByRole("row", { name: /^结束日期 / }));
  expect(end.getByText("原值 2027-01-04 → 合并后 2027-01-11")).toBeInTheDocument();
  expect(end.getByText("新接收日 2026-11-11 + 保留 61 天 = 新结束日 2027-01-11")).toBeInTheDocument();
  expect(end.getByText("联动计算")).toBeInTheDocument();
  expect(end.queryByText("本次缺失")).not.toBeInTheDocument();
  const days = within(screen.getByRole("row", { name: /^饲养天数 / }));
  expect(days.getByText("保留原值")).toBeInTheDocument();
  expect(days.getByText("原值 61 → 合并后 61")).toBeInTheDocument();
  expect(days.queryByText("本次缺失")).not.toBeInTheDocument();
  expect(within(screen.getByRole("row", { name: /^接收日期 / })).queryByText(/原值 .*→/)).not.toBeInTheDocument();
  expect(actions.onConfirm).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "确认补充原预约" }));
  expect(actions.onConfirm).toHaveBeenCalledExactlyOnceWith("original");
});
it("explains a retained calendar month and the resulting 28-day interval from January 31", () => {
  const preview = response();
  const calculation: IntakeReviewCalculation = {
    basis: "calendar_months",
    periodSource: "saved",
    startDate: "2027-01-31",
    endDate: "2027-02-28",
    days: 28,
    months: 1,
  };
  const original = {
    ...preview.items[0].item,
    intakeDate: "",
    endDate: "2027-02-01",
    husbandryDays: 31,
    husbandryMonths: 1,
  };
  preview.outcome = "supplement";
  preview.items[0] = {
    ...preview.items[0],
    item: original,
    reviewStatus: "supplement",
    canAcknowledge: false,
    mergedItem: { ...original, intakeDate: calculation.startDate, endDate: calculation.endDate, husbandryDays: 28 },
    comparisons: [
      { field: "endDate", before: original.endDate, incoming: "", status: "calculated", calculation },
      { field: "husbandryDays", before: 31, incoming: null, status: "calculated", calculation },
      { field: "husbandryMonths", before: 1, incoming: null, status: "retained", calculation },
    ],
  };
  setup(preview);
  const days = within(screen.getByRole("row", { name: /^饲养天数 / }));
  expect(days.getByText("原值 31 → 合并后 28")).toBeInTheDocument();
  expect(days.getByText("新接收日 2027-01-31 + 保留 1 个自然月 = 新结束日 2027-02-28")).toBeInTheDocument();
  expect(days.getByText("按结束日与接收日的日期差：2027-02-28 − 2027-01-31 = 28 天")).toBeInTheDocument();
  expect(days.getByText("联动计算")).toBeInTheDocument();
  expect(days.queryByText("本次缺失")).not.toBeInTheDocument();
  expect(within(screen.getByRole("row", { name: /^饲养月数 / })).getByText("保留原值")).toBeInTheDocument();
});
it("identifies days derived from the merged date range rather than presenting a missing duration", () => {
  const preview = response();
  const calculation: IntakeReviewCalculation = {
    basis: "date_range",
    startDate: "2026-11-11",
    endDate: "2026-11-28",
    days: 17,
  };
  preview.outcome = "supplement";
  preview.items[0] = {
    ...preview.items[0],
    reviewStatus: "supplement",
    canAcknowledge: false,
    mergedItem: {
      ...preview.items[0].item,
      intakeDate: calculation.startDate,
      endDate: calculation.endDate,
      husbandryDays: 17,
    },
    comparisons: [{ field: "husbandryDays", before: null, incoming: null, status: "calculated", calculation }],
  };
  setup(preview);
  const days = within(screen.getByRole("row", { name: /^饲养天数 / }));
  expect(days.getByText("由日期区间计算：2026-11-28 − 2026-11-11 = 17 天")).toBeInTheDocument();
  expect(days.getByText("联动计算")).toBeInTheDocument();
  expect(days.queryByText("本次缺失")).not.toBeInTheDocument();
});
it("previews incoming image values and their period before explicitly updating a saved text appointment", () => {
  const preview = response();
  const original = { ...preview.items[0].item, quantity: 30, intakeDate: "2026-11-11", husbandryDays: null };
  const picture = { ...incoming, rawMessage: "", quantity: 15, husbandryDays: 17, endDate: "2026-11-28" };
  const calculation: IntakeReviewCalculation = {
    basis: "fixed_days",
    periodSource: "incoming",
    startDate: original.intakeDate,
    endDate: picture.endDate,
    days: 17,
  };
  preview.outcome = "supplement";
  preview.incoming = picture;
  preview.items[0] = {
    ...preview.items[0],
    item: original,
    reviewStatus: "supplement",
    mergeStrategy: "incoming_image_first",
    canAcknowledge: false,
    mergedItem: { ...original, quantity: 15, husbandryDays: 17, endDate: picture.endDate },
    comparisons: [
      { field: "quantity", before: 30, incoming: 15, status: "different" },
      { field: "husbandryDays", before: null, incoming: 17, status: "calculated", calculation },
    ],
  };
  const actions = setup(preview, {
    item: picture,
    images: [
      {
        name: "采购图.png",
        dataUrl:
          "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
      },
    ],
  });
  expect(screen.getByText("以本次图片信息为主，原预约文字补充空缺")).toBeInTheDocument();
  expect(screen.queryByText("以原预约图片信息为主，文字补充空缺")).not.toBeInTheDocument();
  const quantity = within(screen.getByRole("row", { name: /^动物数量 / }));
  expect(quantity.getAllByRole("cell").map((cell) => cell.textContent)).toEqual([
    "动物数量",
    "30",
    "15",
    "15",
    "不一致",
  ]);
  expect(
    within(screen.getByRole("row", { name: /^饲养天数 / })).getByText(
      "接收日 2026-11-11 + 本次识别 17 天 = 结束日 2026-11-28",
    ),
  ).toBeInTheDocument();
  expect(actions.onConfirm).not.toHaveBeenCalled();
  expect(screen.queryByRole("button", { name: "已登记，结束本次录入" })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "确认补充原预约" }));
  expect(actions.onConfirm).toHaveBeenCalledExactlyOnceWith("original");
});
it("distinguishes an unconfirmed mixed default from a real female value before supplementing", () => {
  const preview = response();
  const original = { ...preview.items[0].item, sex: "雌性/雄性" };
  preview.outcome = "supplement";
  preview.items[0] = {
    ...preview.items[0],
    item: original,
    reviewStatus: "supplement",
    mergeStrategy: "incoming_image_first",
    canAcknowledge: false,
    mergedItem: { ...original, sex: "雌性" },
    comparisons: [
      {
        field: "sex",
        before: "雌性/雄性",
        incoming: "雌性",
        status: "supplement",
        placeholder: { before: true, incoming: false },
      },
    ],
  };
  const actions = setup(preview);
  const cells = within(screen.getByRole("row", { name: /^性别 / })).getAllByRole("cell");
  expect(within(cells[1]).getByText("雌性/雄性")).toBeInTheDocument();
  expect(within(cells[1]).getByText("未确认占位")).toBeInTheDocument();
  expect(within(cells[2]).queryByText("未确认占位")).not.toBeInTheDocument();
  expect(within(cells[3]).getByText("雌性")).toBeInTheDocument();
  expect(within(cells[4]).getByText("可补充")).toHaveClass("ant-tag-processing");
  expect(actions.onConfirm).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "确认补充原预约" }));
  expect(actions.onConfirm).toHaveBeenCalledExactlyOnceWith("original");
});
it("offers field choices for a server-authorized unresolved difference without predicting or saving the merged value", () => {
  const preview = response();
  preview.outcome = "conflict";
  preview.items[0] = {
    ...preview.items[0],
    reviewStatus: "conflict",
    canMerge: false,
    canAcknowledge: false,
    mergedItem: null,
    resolutionFields: ["quantity", "sex"],
    resolutions: {},
    comparisons: [
      { field: "quantity", before: 24, incoming: 99, status: "different" },
      { field: "sex", before: "雌性/雄性", incoming: "雄性", status: "different" },
      { field: "iacuc", before: "Z1", incoming: "Z1", status: "same" },
    ],
  };
  const actions = setup(preview);
  const choices = within(screen.getByRole("radiogroup", { name: "动物数量取值" }));
  expect(choices.getByRole("radio", { name: "24" })).not.toBeChecked();
  expect(choices.getByRole("radio", { name: "99" })).not.toBeChecked();
  expect(screen.queryByRole("radiogroup", { name: "IACUC取值" })).not.toBeInTheDocument();
  fireEvent.click(choices.getByRole("radio", { name: "99" }));
  expect(actions.onResolve).toHaveBeenCalledExactlyOnceWith("original", "quantity", "incoming");
  const sexChoices = within(screen.getByRole("radiogroup", { name: "性别取值" }));
  expect(sexChoices.getByRole("radio", { name: "雌性/雄性" })).not.toBeChecked();
  expect(sexChoices.getByTitle("原预约")).toHaveTextContent("雌性/雄性");
  expect(sexChoices.getByTitle("本次识别")).toHaveTextContent("雄性");
  fireEvent.click(sexChoices.getByRole("radio", { name: "雄性" }));
  expect(actions.onResolve).toHaveBeenCalledTimes(2);
  expect(actions.onResolve).toHaveBeenLastCalledWith("original", "sex", "incoming");
  expect(actions.onConfirm).not.toHaveBeenCalled();
  expect(screen.queryByRole("columnheader", { name: "合并后" })).not.toBeInTheDocument();
});
it("keeps the prior merged result visible and disables choices and confirmation during a choice recheck", () => {
  const preview = response();
  preview.items[0].resolutionFields = ["quantity"];
  preview.items[0].resolutions = { quantity: "saved" };
  preview.items[0].canAcknowledge = false;
  preview.items[0].comparisons = [{ field: "quantity", before: 24, incoming: 99, status: "different" }];
  const actions = setup(preview, {
    pending: true,
    checking: true,
    requestedResolutions: { candidateId: "original", values: { quantity: "incoming" } },
  });
  const choices = within(screen.getByRole("radiogroup", { name: "动物数量取值" }));
  expect(choices.getByRole("radio", { name: "99" })).toBeChecked();
  for (const radio of choices.getAllByRole("radio")) expect(radio).toBeDisabled();
  const mergedCell = within(screen.getByRole("row", { name: /^动物数量 / })).getAllByRole("cell")[3];
  expect(within(mergedCell).getByText("24")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "确认补充原预约" })).toBeDisabled();
  expect(actions.onResolve).not.toHaveBeenCalled();
  expect(actions.onConfirm).not.toHaveBeenCalled();
});
it("checks the calculated endpoint and records an explicit choice when it is clicked again", () => {
  const preview = response();
  const original = { ...preview.items[0].item, endDate: "2027-01-04" };
  preview.items[0] = {
    ...preview.items[0],
    item: original,
    canAcknowledge: false,
    mergedItem: { ...original, endDate: "2027-01-11" },
    mergeStrategy: "saved_image_first",
    resolutionFields: ["endDate"],
    resolutions: { endDate: "saved" },
    comparisons: [
      {
        field: "endDate",
        before: "2027-01-04",
        incoming: "2027-01-11",
        status: "calculated",
        calculation: {
          basis: "fixed_days",
          periodSource: "saved",
          startDate: "2026-11-11",
          endDate: "2027-01-11",
          days: 61,
        },
      },
    ],
  };
  const actions = setup(preview);
  const choices = within(screen.getByRole("radiogroup", { name: "结束日期取值" }));
  const calculated = choices.getByRole("radio", {
    name: "2027-01-11",
  });
  expect(choices.getByRole("radio", { name: "2027-01-04" })).not.toBeChecked();
  expect(calculated).toBeChecked();
  fireEvent.click(calculated);
  expect(actions.onResolve).toHaveBeenCalledExactlyOnceWith("original", "endDate", "incoming");
  expect(actions.onConfirm).not.toHaveBeenCalled();
  const mergedCell = within(screen.getByRole("row", { name: /^结束日期 / })).getAllByRole("cell")[3];
  expect(within(mergedCell).getByText("2027-01-11")).toBeInTheDocument();
});
it("does not check a source endpoint when the calculated result matches neither source", () => {
  const preview = response();
  preview.items[0].mergedItem = { ...preview.items[0].item, endDate: "2027-01-11" };
  preview.items[0].resolutionFields = ["endDate"];
  preview.items[0].resolutions = { endDate: "saved" };
  preview.items[0].comparisons = [
    {
      field: "endDate",
      before: "2027-01-04",
      incoming: "2027-01-08",
      status: "calculated",
      calculation: {
        basis: "fixed_days",
        periodSource: "saved",
        startDate: "2026-11-11",
        endDate: "2027-01-11",
        days: 61,
      },
    },
  ];
  const actions = setup(preview);
  const choices = within(screen.getByRole("radiogroup", { name: "结束日期取值" }));
  for (const radio of choices.getAllByRole("radio")) expect(radio).not.toBeChecked();
  const mergedCell = within(screen.getByRole("row", { name: /^结束日期 / })).getAllByRole("cell")[3];
  expect(within(mergedCell).getByText("2027-01-11")).toBeInTheDocument();
  expect(actions.onResolve).not.toHaveBeenCalled();
});
it.each([
  { name: "an unselected option is sent once", requested: undefined, pending: false, choice: "incoming", expected: 1 },
  {
    name: "an already explicit choice is not resent",
    requested: { quantity: "saved" },
    pending: false,
    choice: "saved",
    expected: 0,
  },
  { name: "a pending default cannot be sent", requested: undefined, pending: true, choice: "saved", expected: 0 },
] as const)("handles radio clicks without duplicate requests: $name", ({ requested, pending, choice, expected }) => {
  const preview = response();
  preview.items[0].resolutionFields = ["quantity"];
  preview.items[0].resolutions = { quantity: "saved" };
  preview.items[0].comparisons = [{ field: "quantity", before: 24, incoming: 99, status: "different" }];
  const actions = setup(preview, {
    pending,
    requestedResolutions: requested ? { candidateId: "original", values: requested } : undefined,
  });
  const group = within(screen.getByRole("radiogroup", { name: "动物数量取值" }));
  fireEvent.click(group.getByRole("radio", { name: choice === "saved" ? "24" : "99" }));
  expect(actions.onResolve).toHaveBeenCalledTimes(expected);
  if (expected) expect(actions.onResolve).toHaveBeenCalledWith("original", "quantity", choice);
  expect(actions.onConfirm).not.toHaveBeenCalled();
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
