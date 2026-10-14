import { expect, it } from "vitest";
import { technicalServiceAmount } from "./technicalServiceMoney";

it("rounds each service row in decimal cents, then allows integer-cent totals", () => {
  expect(technicalServiceAmount(1.002525, 200)).toBe(200.51);
  expect(technicalServiceAmount(1.5, 200)).toBe(300);
  expect([2, 2, 4, 2].reduce((sum, count) => sum + technicalServiceAmount(count, 30), 0)).toBe(300);
  expect(technicalServiceAmount(0, 30)).toBe(0);
});
