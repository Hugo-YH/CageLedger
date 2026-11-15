import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import {
  createCustomBillingSegment,
  createQuantitySheet,
  quantitySheetValidationIssues,
} from "../../../../domain/quantitySheets";
import type { QuantitySheetEditor } from "../hooks/useQuantitySheetEditor";
import { focusQuantityValidationIssue } from "../quantityValidation";
import { QuantityBillingOptions } from "./QuantityBillingOptions";

beforeEach(() => {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })),
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it("associates custom segment errors with their controls and focuses the region for overlaps", () => {
  const draft = createQuantitySheet("2026-10");
  draft.customBillingSegments = [
    { ...createCustomBillingSegment("2026-10"), startDate: "2026-09-01", quantity: null, unitPrice: null },
    { ...createCustomBillingSegment("2026-10", 2), quantityMode: "all" },
  ];
  const validationIssues = quantitySheetValidationIssues(draft).filter(
    ({ field }) => field === "customBillingSegments",
  );
  const update = vi.fn();
  const editor = {
    draft,
    validationIssues,
    optionsExpanded: true,
    setOptionsExpanded: vi.fn(),
    freeCageEnabled: false,
    tierPriorityEnabled: false,
    customBillingSegmentCount: 2,
    freeCageAllowance: 10,
    supportsFreeCages: true,
    supportsTierPriority: true,
    setFreeCageEnabled: vi.fn(),
    setField: vi.fn(),
    setFullExemption: vi.fn(),
    setTierPriorityEnabled: vi.fn(),
    addCustomBillingSegment: vi.fn(),
    unit: "cage_day",
    updateCustomBillingSegment: update,
    removeCustomBillingSegment: vi.fn(),
    billingProfile: { price: 4.5 },
  } as unknown as QuantitySheetEditor;
  const view = render(
    <form>
      <QuantityBillingOptions editor={editor} />
    </form>,
  );
  const segment = screen.getByRole("region", { name: "区间 1" });
  for (const label of ["开始日期", "区间 1 每日数量", "区间 1 收费单价"]) {
    const input = within(segment).getByLabelText(label);
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(document.getElementById(input.getAttribute("aria-describedby")!)).toBeInTheDocument();
  }
  const region = document.getElementById("quantity-custom-billing-segments")!;
  expect(document.getElementById(region.getAttribute("aria-describedby")!)).toHaveTextContent(
    "全部结余收费区间不能与其他自定义收费区间重叠",
  );
  const scrollIntoView = vi.fn();
  region.scrollIntoView = scrollIntoView;
  focusQuantityValidationIssue(
    view.container.querySelector("form")!,
    validationIssues.find((issue) => !issue.segmentId)!,
  );
  expect(region).toHaveFocus();
  expect(scrollIntoView).toHaveBeenCalledOnce();
  fireEvent.change(within(segment).getByLabelText("区间 1 收费单价"), { target: { value: "8" } });
  expect(update).toHaveBeenLastCalledWith(draft.customBillingSegments[0].id, { unitPrice: 8 });
});
