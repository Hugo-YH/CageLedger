import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { IntakeRecognitionEvidence } from "../../../../contracts/intake";
import { IntakeRecognitionReview } from "./IntakeRecognitionReview";

const evidence: IntakeRecognitionEvidence = {
  extractedText: "",
  fieldSources: {},
  warnings: [
    "动物品系差异：饲养需求为“C57”，采购信息为“ICR”，已采用采购信息。",
    "体重/日龄（规格）差异：饲养需求为“8周龄”，采购信息为“6周龄”，已采用采购信息。",
    "请补充实际接收日期。",
  ],
  sources: [
    { imageIndex: 1, kind: "husbandry", strainRaw: "C57", specification: "8周龄" },
    { imageIndex: 2, kind: "purchase", productName: "ICR", specification: "6周龄" },
  ],
};

beforeEach(() => {
  vi.stubGlobal(
    "matchMedia",
    vi.fn().mockReturnValue({
      matches: false,
      addListener() {},
      removeListener() {},
      addEventListener() {},
      removeEventListener() {},
    }),
  );
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

describe("intake recognition review", () => {
  it("starts collapsed and opens source comparisons with separate reminders", () => {
    render(<IntakeRecognitionReview evidence={evidence} />);
    const toggle = screen.getByRole("button", { name: /请核对识别提示（3项）/ });
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByRole("table")).toBeNull();
    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByRole("columnheader", { name: "饲养需求" })).toBeTruthy();
    expect(screen.getByRole("columnheader", { name: "采购信息" })).toBeTruthy();
    expect(screen.getByText("C57")).toBeTruthy();
    expect(screen.getByText("ICR")).toBeTruthy();
    expect(screen.getByText("请补充实际接收日期。")).toBeTruthy();
    expect(screen.queryByText(evidence.warnings[0])).toBeNull();
    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
  });

  it("collapses a replacement result and supports warning-only historical evidence", () => {
    const { rerender } = render(<IntakeRecognitionReview evidence={evidence} />);
    fireEvent.click(screen.getByRole("button", { name: /请核对识别提示/ }));
    const next = { ...evidence, sources: [], warnings: ["图片较模糊，请核对。"] };
    rerender(<IntakeRecognitionReview evidence={next} />);
    const toggle = screen.getByRole("button", { name: /请核对识别提示（1项）/ });
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(toggle);
    expect(screen.getByText("图片较模糊，请核对。")).toBeTruthy();
    expect(screen.queryByRole("table")).toBeNull();
  });

  it("has no empty review when there are no warnings", () => {
    render(<IntakeRecognitionReview evidence={{ ...evidence, warnings: [] }} />);
    expect(screen.queryByRole("button")).toBeNull();
  });
  it("keeps evidence reachable through the same collapsed entry even without warnings", () => {
    render(
      <IntakeRecognitionReview evidence={{ ...evidence, warnings: [] }}>
        <div>识别依据与留档</div>
      </IntakeRecognitionReview>,
    );
    const toggle = screen.getByRole("button", { name: /请核对识别提示/ });
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByText("识别依据与留档")).toBeNull();
    fireEvent.click(toggle);
    expect(screen.getByText("识别依据与留档")).toBeTruthy();
  });
});
