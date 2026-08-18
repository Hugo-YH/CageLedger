import { describe, expect, it } from "vitest";

import { reimbursementReturnStatus } from "./workflowStatus";

describe("reimbursementReturnStatus", () => {
  it("未交回时标记为报销单未交回", () => {
    expect(
      reimbursementReturnStatus({ reimbursementFormReturned: false, receivedAmount: 0, totalAmount: 500 }),
    ).toEqual({ label: "报销单 未交回", color: "default" });
  });

  it("已交回且全额缴费时标记为已交回", () => {
    expect(
      reimbursementReturnStatus({ reimbursementFormReturned: true, receivedAmount: 500, totalAmount: 500 }),
    ).toEqual({ label: "报销单 已交回", color: "blue" });
  });

  it("已交回但未全额缴费时区分标记", () => {
    expect(
      reimbursementReturnStatus({ reimbursementFormReturned: true, receivedAmount: 300, totalAmount: 500 }),
    ).toEqual({ label: "报销单 已交回（未全额缴费）", color: "orange" });
  });
});
