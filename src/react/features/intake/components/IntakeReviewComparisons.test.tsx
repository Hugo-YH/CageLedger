import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { IntakeReviewCandidate } from "../../../../contracts/intake";
import { createIntakeDraft } from "../../../../domain/intake";
import { IntakeReviewComparisons } from "./IntakeReviewComparisons";

const labels = {
  iacuc: "IACUC 编号",
  batchNo: "需求单号",
  quantity: "数量（只）",
  specification: "规格",
  strainStandard: "标准品系",
  sex: "性别",
  roomName: "房间",
  intakeDate: "接收日期",
  endDate: "结束日期",
  husbandryDays: "饲养天数",
  species: "动物种类",
  intakePurpose: "接收用途",
};

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

function candidate(overrides: Partial<IntakeReviewCandidate> = {}): IntakeReviewCandidate {
  const item = {
    ...createIntakeDraft("录入人"),
    id: "saved-appointment",
    quantity: 24,
    specification: "6周龄",
    roomName: "8014",
  };
  return {
    item,
    matchedFields: ["batchNo"],
    classification: "same_pair",
    canMerge: true,
    canAcknowledge: true,
    reason: "动物信息一致",
    mergedItem: item,
    confirmationToken: "token",
    changes: [],
    reviewStatus: "registered",
    comparisons: [
      { field: "quantity", before: 24, incoming: 24, status: "same" },
      { field: "specification", before: "6周龄", incoming: "6周龄", status: "same" },
    ],
    ...overrides,
  };
}

it("keeps an entirely matching comparison compact until all fields are requested", () => {
  const onResolve = vi.fn();
  render(<IntakeReviewComparisons candidate={candidate()} labels={labels} onResolve={onResolve} />);

  expect(screen.getByText("全部 2 项字段一致")).toBeInTheDocument();
  expect(screen.queryByRole("table")).not.toBeInTheDocument();
  const expand = screen.getByRole("button", { name: "查看全部字段（2）" });
  expect(expand).toHaveAttribute("type", "button");
  expect(expand).toHaveAttribute("aria-expanded", "false");
  fireEvent.click(expand);

  const table = screen.getByRole("table");
  expect(
    within(table)
      .getAllByRole("columnheader")
      .map((header) => header.textContent),
  ).toEqual(["字段", "原预约", "本次识别", "合并后", "核对结果"]);
  expect(within(table).getAllByText("一致")).toHaveLength(2);
  expect(screen.queryByRole("radiogroup")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "只看待核对字段（0）" }));
  expect(screen.queryByRole("table")).not.toBeInTheDocument();
  expect(onResolve).not.toHaveBeenCalled();
});

it("does not describe an empty comparison as matching", () => {
  render(<IntakeReviewComparisons candidate={candidate({ comparisons: [] })} labels={labels} />);
  expect(screen.getByText("暂无可对比的字段信息")).toBeInTheDocument();
  expect(screen.queryByText(/全部 .* 项字段一致/)).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /全部字段/ })).not.toBeInTheDocument();
});

it("only hides plain matching fields while keeping placeholders, source choices, requests and every other status", () => {
  const onResolve = vi.fn();
  const review = candidate({
    resolutionFields: ["roomName"],
    comparisons: [
      { field: "iacuc", before: "Z2099000", incoming: "Z2099000", status: "same" },
      { field: "batchNo", before: "B1", incoming: "B1", status: "same" },
      { field: "quantity", before: 24, incoming: 30, status: "different" },
      { field: "strainStandard", before: "BALB/c", incoming: "", status: "unknown" },
      {
        field: "sex",
        before: "混合",
        incoming: "混合",
        status: "same",
        placeholder: { before: true, incoming: false },
      },
      { field: "roomName", before: "8014", incoming: "8014", status: "same" },
      { field: "intakeDate", before: "2026-10-01", incoming: "2026-10-01", status: "same" },
      { field: "endDate", before: "2026-10-31", incoming: "2026-11-01", status: "calculated" },
      { field: "husbandryDays", before: 30, incoming: null, status: "retained" },
      { field: "species", before: "mouse", incoming: "", status: "missing" },
      { field: "intakePurpose", before: "", incoming: "housing", status: "supplement" },
    ],
  });
  render(
    <IntakeReviewComparisons
      candidate={review}
      labels={labels}
      requestedResolutions={{ intakeDate: "incoming" }}
      onResolve={onResolve}
    />,
  );

  expect(screen.getByText("待核对字段（9）")).toBeInTheDocument();
  expect(screen.queryByText(labels.iacuc)).not.toBeInTheDocument();
  expect(screen.queryByText(labels.batchNo)).not.toBeInTheDocument();
  expect(screen.getByText("未确认占位")).toBeInTheDocument();
  expect(screen.getByText(labels.intakeDate)).toBeInTheDocument();
  expect(screen.getAllByRole("row")).toHaveLength(10);
  expect(screen.getAllByRole("radiogroup")).toHaveLength(1);
  expect(screen.getByRole("radiogroup", { name: "房间取值" })).toBeInTheDocument();
  expect(screen.queryByRole("radiogroup", { name: "接收日期取值" })).not.toBeInTheDocument();

  fireEvent.click(screen.getByRole("button", { name: "显示全部字段（11）" }));
  expect(screen.getByText(labels.iacuc)).toBeInTheDocument();
  expect(screen.getByText(labels.batchNo)).toBeInTheDocument();
  expect(screen.getAllByRole("row")).toHaveLength(12);
  expect(onResolve).not.toHaveBeenCalled();
});

it("retains the expanded view when the same candidate is rechecked and becomes entirely matching", () => {
  const review = candidate();
  review.comparisons[0] = { field: "quantity", before: 24, incoming: 30, status: "different" };
  const { rerender } = render(<IntakeReviewComparisons candidate={review} labels={labels} />);
  fireEvent.click(screen.getByRole("button", { name: "显示全部字段（2）" }));

  const refreshed = candidate();
  rerender(<IntakeReviewComparisons candidate={refreshed} labels={labels} pending />);
  expect(screen.getByRole("table")).toBeInTheDocument();
  expect(screen.getByText(labels.specification)).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "只看待核对字段（0）" })).toHaveAttribute("aria-expanded", "true");

  fireEvent.click(screen.getByRole("button", { name: "只看待核对字段（0）" }));
  rerender(<IntakeReviewComparisons candidate={{ ...refreshed }} labels={labels} />);
  expect(screen.queryByRole("table")).not.toBeInTheDocument();
});

it("keeps a matching selectable field visible and records a checked default only until explicitly requested", () => {
  const onResolve = vi.fn();
  const review = candidate({ resolutionFields: ["quantity"], resolutions: { quantity: "saved" } });
  const { rerender } = render(<IntakeReviewComparisons candidate={review} labels={labels} onResolve={onResolve} />);
  const radios = within(screen.getByRole("radiogroup", { name: "数量（只）取值" })).getAllByRole("radio");
  expect(radios).toHaveLength(2);
  expect(radios[0]).toHaveAccessibleName("24");
  expect(radios[1]).toHaveAccessibleName("24");
  expect(radios[0]).toBeChecked();
  fireEvent.click(radios[0]);
  expect(onResolve).toHaveBeenCalledExactlyOnceWith("quantity", "saved");

  rerender(
    <IntakeReviewComparisons
      candidate={{ ...review }}
      labels={labels}
      requestedResolutions={{ quantity: "saved" }}
      onResolve={onResolve}
    />,
  );
  fireEvent.click(within(screen.getByRole("radiogroup", { name: "数量（只）取值" })).getAllByRole("radio")[0]);
  expect(onResolve).toHaveBeenCalledTimes(1);

  rerender(<IntakeReviewComparisons candidate={review} labels={labels} />);
  expect(screen.getByText(labels.quantity)).toBeInTheDocument();
  expect(screen.queryByRole("radiogroup")).not.toBeInTheDocument();
});

it.each([{ pending: true }, { blocked: true }])("keeps source choices visible but disabled for %j", (state) => {
  const onResolve = vi.fn();
  render(
    <IntakeReviewComparisons
      candidate={candidate({ resolutionFields: ["quantity"], resolutions: { quantity: "saved" } })}
      labels={labels}
      onResolve={onResolve}
      {...state}
    />,
  );
  const radios = within(screen.getByRole("radiogroup", { name: "数量（只）取值" })).getAllByRole("radio");
  radios.forEach((radio) => expect(radio).toBeDisabled());
  fireEvent.click(radios[0]);
  expect(onResolve).not.toHaveBeenCalled();
});

it("keeps the merged value authoritative while preserving expansion and requested choices during recheck", () => {
  const onResolve = vi.fn();
  const review = candidate({ resolutionFields: ["quantity"] });
  review.comparisons[0] = { field: "quantity", before: 24, incoming: 30, status: "different" };
  review.mergedItem = { ...review.item, quantity: 27 };
  const { rerender } = render(<IntakeReviewComparisons candidate={review} labels={labels} onResolve={onResolve} />);
  fireEvent.click(screen.getByRole("button", { name: "显示全部字段（2）" }));
  fireEvent.click(screen.getByRole("radio", { name: "30" }));
  expect(onResolve).toHaveBeenCalledExactlyOnceWith("quantity", "incoming");
  expect(within(screen.getByRole("row", { name: /^数量（只） / })).getAllByRole("cell")[3]).toHaveTextContent(/^27$/);

  rerender(
    <IntakeReviewComparisons
      candidate={{ ...review, mergedItem: { ...review.item, quantity: 30 } }}
      labels={labels}
      onResolve={onResolve}
      requestedResolutions={{ quantity: "incoming" }}
      pending
    />,
  );
  expect(screen.getByText(labels.specification)).toBeInTheDocument();
  expect(within(screen.getByRole("row", { name: /^数量（只） / })).getAllByRole("cell")[3]).toHaveTextContent(/^30$/);
  expect(screen.getByRole("radio", { name: "30" })).toBeChecked();
  expect(screen.getByRole("radio", { name: "30" })).toBeDisabled();
});

it("shows a compact strategy note with a clickable and dismissible full explanation", async () => {
  render(<IntakeReviewComparisons candidate={candidate({ mergeStrategy: "saved_image_first" })} labels={labels} />);
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  expect(screen.getByText("以原预约图片信息为主，文字补充空缺")).toBeInTheDocument();
  const help = screen.getByRole("button", { name: "字段合并策略说明" });
  expect(help).toHaveAttribute("aria-expanded", "false");
  fireEvent.click(help);
  expect(
    await screen.findByText(
      "默认保留原预约图片中的动物信息，本次文字补充空缺；接收日期和饲养周期按“合并后”联动计算，请核对字段取值及计算依据后确认。",
    ),
  ).toBeInTheDocument();
  expect(help).toHaveAttribute("aria-expanded", "true");
  fireEvent.keyDown(help, { key: "Escape" });
  await waitFor(() => expect(help).toHaveAttribute("aria-expanded", "false"));
});
