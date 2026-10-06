import { describe, expect, it } from "vitest";
import {
  calculateQuantityBalances,
  createCustomBillingSegment,
  createQuantitySheet,
  normalizeQuantitySheet,
  roomBillingUnit,
  validateQuantitySheet,
} from "./quantitySheets";

describe("quantity sheet domain", () => {
  it("calculates animal balances from changes", () => {
    const sheet = createQuantitySheet("2026-06");
    expect(sheet.fullExemption).toBe(false);
    expect(sheet.tierCagePriority).toBeNull();
    sheet.rows[0] = { ...sheet.rows[0], addedCount: 10, addedType: "购入", cageCount: 2 };
    expect(calculateQuantityBalances(sheet.rows, true)[0].calculatedAnimalCount).toBe(10);
  });
  it("requires animal balances for animal-day rooms", () => {
    const sheet = { ...createQuantitySheet("2026-06"), roomId: "r1", iacuc: "Z1", billingUnit: "animal_day" as const };
    expect(validateQuantitySheet(sheet)).toContain("按只/天计费房间必须填写动物结余总数");
    expect(roomBillingUnit({ id: "r1", name: "兔房", defaultBillingItem: "rabbit" })).toBe("animal_day");
  });
  it("normalizes legacy full-month custom pricing into a compatible segment", () => {
    const sheet = normalizeQuantitySheet({
      ...createQuantitySheet("2026-07"),
      id: "legacy-rate",
      customBillingEnabled: true,
      customUnitPrice: 7.5,
      customBillingSegments: undefined,
    });
    expect(sheet.customBillingSegments).toEqual([
      expect.objectContaining({
        startDate: "2026-07-01",
        endDate: "2026-07-31",
        quantity: null,
        unitPrice: 7.5,
      }),
    ]);
  });
  it("requires an explicit quantity and positive rate for new custom segments", () => {
    const sheet = createQuantitySheet("2026-07");
    sheet.roomId = "r1";
    sheet.iacuc = "Z1";
    sheet.customBillingSegments = [createCustomBillingSegment("2026-07", 5)];
    expect(validateQuantitySheet(sheet)).toContain("请填写自定义收费区间的每日适用数量");
  });
  it("allows the full daily balance without a fixed quantity and preserves the mode", () => {
    const sheet = { ...createQuantitySheet("2026-07"), roomId: "r1", iacuc: "Z1" };
    sheet.customBillingSegments = [{ ...createCustomBillingSegment(sheet.month, 3), quantityMode: "all" }];
    expect(validateQuantitySheet(sheet)).toEqual([]);
    expect(normalizeQuantitySheet(sheet).customBillingSegments[0]).toMatchObject({
      quantityMode: "all",
      quantity: null,
    });
    sheet.customBillingSegments[0].quantityMode = "fixed";
    expect(validateQuantitySheet(sheet)).toContain("请填写自定义收费区间的每日适用数量");
  });
  it("rejects overlapping full-balance pricing but allows adjacent intervals", () => {
    const sheet = { ...createQuantitySheet("2026-07"), roomId: "r1", iacuc: "Z1" };
    sheet.customBillingSegments = [
      { ...createCustomBillingSegment(sheet.month, 3), endDate: "2026-07-10", quantityMode: "all" },
      { ...createCustomBillingSegment(sheet.month, 4), startDate: "2026-07-10", quantity: 2 },
    ];
    expect(validateQuantitySheet(sheet)).toContain("全部结余收费区间不能与其他自定义收费区间重叠");
    sheet.customBillingSegments[1].startDate = "2026-07-11";
    expect(validateQuantitySheet(sheet)).toEqual([]);
  });
  it("keeps legacy all-quantity intervals editable", () => {
    const sheet = normalizeQuantitySheet({
      ...createQuantitySheet("2026-07"),
      roomId: "r1",
      iacuc: "Z1",
      customBillingSegments: [
        { id: "legacy", startDate: "2026-07-01", endDate: "2026-07-31", quantity: null, unitPrice: 3, note: "" },
      ],
    });
    expect(sheet.customBillingSegments[0].quantityMode).toBe("all");
    expect(validateQuantitySheet(sheet)).toEqual([]);
  });
});
