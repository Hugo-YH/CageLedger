import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { tagColors } from "../../theme/visual-system.mjs";
import { FeeTypeTag, ReimbursementReturnTag } from "./BillingTags";
import { workflowTagColor } from "./billingTagColors";

afterEach(cleanup);

describe("established billing tag colors", () => {
  it("keeps feeding green, distinguishes technical services and preserves the legacy fee fallback", () => {
    render(
      <>
        <FeeTypeTag />
        <FeeTypeTag feeType="technical_service" />
      </>,
    );
    expect(screen.getByText("饲养费")).toHaveClass("ant-tag-green");
    expect(screen.getByText("技术服务费")).toHaveClass("ant-tag-magenta");
  });

  it("preserves purple locks and blue statements", () => {
    expect(workflowTagColor("statement_locked")).toBe("purple");
    expect(tagColors.document.statement).toBe("blue");
    expect(workflowTagColor("unknown-historical-status")).toBe("default");
  });

  it.each([
    [false, 0, "报销单 未交回", "default"],
    [true, 99.99, "报销单 已交回（未全额缴费）", "orange"],
    [true, 100, "报销单 已交回", "green"],
  ] as const)(
    "retains payment-aware reimbursement labels: returned=%s amount=%s",
    (returned, received, label, color) => {
      render(
        <ReimbursementReturnTag
          workflow={{ reimbursementFormReturned: returned, receivedAmount: received, totalAmount: 100 }}
        />,
      );
      expect(screen.getByText(label)).toHaveClass(`ant-tag-${color}`);
    },
  );
});
