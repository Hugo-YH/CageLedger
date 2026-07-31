import { describe, expect, it } from "vitest";

import { matchIacucOptions } from "./iacuc";

const items = [
  { iacuc: "SYSU2026-001", project: "甲", pi: "张三", owner: "李四", funding: "国家自然科学基金" },
  { iacuc: "SYSU2026-010", project: "乙", pi: "王五", owner: "赵六", funding: "省基金" },
  { iacuc: "ZSU2025-002", project: "丙", pi: "钱七", owner: "孙八", funding: "自筹" },
];

describe("matchIacucOptions", () => {
  it("returns nothing until the user types", () => {
    expect(matchIacucOptions(items, "")).toEqual([]);
    expect(matchIacucOptions(items, "   ")).toEqual([]);
  });

  it("matches case-insensitively and prioritizes prefix matches", () => {
    expect(matchIacucOptions(items, "zsu").map((item) => item.iacuc)).toEqual(["ZSU2025-002"]);
    expect(matchIacucOptions(items, "2026").map((item) => item.iacuc)).toEqual(["SYSU2026-001", "SYSU2026-010"]);
  });

  it("caps the number of rendered options", () => {
    const many = Array.from({ length: 120 }, (_, index) => ({
      ...items[0],
      iacuc: `SYSU-BULK-${String(index).padStart(3, "0")}`,
    }));
    expect(matchIacucOptions(many, "bulk", 50)).toHaveLength(50);
  });
});
