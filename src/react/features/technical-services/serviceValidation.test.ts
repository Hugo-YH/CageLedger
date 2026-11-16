import { expect, it } from "vitest";
import { serviceRowErrors } from "./serviceValidation";

it("locates invalid, duplicate and out-of-month dates without changing the sheet", () => {
  const sheet = {
    month: "2026-11",
    rows: [
      { date: "2026-11-01", quantity: 1 },
      { date: "2026-11-01", quantity: 2 },
      { date: "2026-12-01", quantity: 1 },
      { date: "2026-02-30", quantity: 1 },
    ],
  };
  const before = structuredClone(sheet);
  expect(serviceRowErrors(sheet, "次").map((error) => error.date)).toEqual([
    "服务日期不能重复",
    "服务日期不能重复",
    "日期须属于所选月份",
    "请选择有效的服务日期",
  ]);
  expect(sheet).toEqual(before);
});

it("mirrors integer, hourly minimum and finite quantity rules without rounding", () => {
  const sheet = {
    month: "2026-11",
    rows: [0, 0.5, 1, 1.5, -1, Infinity, 1_000_001].map((quantity, index) => ({
      date: `2026-11-0${index + 1}`,
      quantity,
    })),
  };
  expect(serviceRowErrors(sheet, "次").map((error) => Boolean(error.quantity))).toEqual([
    false,
    true,
    false,
    true,
    true,
    true,
    true,
  ]);
  expect(serviceRowErrors(sheet, "小时").map((error) => Boolean(error.quantity))).toEqual([
    false,
    true,
    false,
    false,
    true,
    true,
    true,
  ]);
});
