import { expect, it } from "vitest";
import type { BillingStatementLine } from "../api/contracts";
import fixture from "./fixtures/settlement-parity.json";
import { settlementNotesMarkup } from "./settlementNotes";

it("describes varying full-balance quantities without calling the first count a daily fixed count", () => {
  const lines: BillingStatementLine[] = [10, 12].map((count) => ({
    ...fixture.lines[0],
    iacucBreakdown: [
      {
        iacuc: "Z-ALL",
        billingUnit: "animal_day",
        animalCount: count,
        unitPrice: 3,
        customBilling: true,
        customBillingSegmentId: "all",
        customBillingStartDate: "2026-07-01",
        customBillingEndDate: "2026-07-02",
        customBillingQuantityMode: "all",
        payableAmount: count * 3,
      },
    ],
  }));
  const html = settlementNotesMarkup([], "", lines);
  expect(html).toContain("按每日实际结余只数计费");
  expect(html).toContain("本月共计66.00元");
  expect(html).not.toContain("每日10只");
});
