import { describe, expect, it } from "vitest";
import {
  calculateQuantityBalances,
  createQuantitySheet,
  roomBillingUnit,
  validateQuantitySheet,
} from "./quantitySheets";

describe("quantity sheet domain", () => {
  it("calculates animal balances from changes", () => {
    const sheet = createQuantitySheet("2026-06");
    sheet.rows[0] = { ...sheet.rows[0], addedCount: 10, addedType: "购入", cageCount: 2 };
    expect(calculateQuantityBalances(sheet.rows, true)[0].calculatedAnimalCount).toBe(10);
  });
  it("requires animal balances for animal-day rooms", () => {
    const sheet = { ...createQuantitySheet("2026-06"), roomId: "r1", iacuc: "Z1", billingUnit: "animal_day" as const };
    expect(validateQuantitySheet(sheet)).toContain("按只/天计费房间必须填写动物结余总数");
    expect(roomBillingUnit({ id: "r1", name: "兔房", defaultBillingItem: "rabbit" })).toBe("animal_day");
  });
});
