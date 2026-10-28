import { describe, expect, it } from "vitest";

import { buildDateFilterTree, dateFilterTreeState, toggleDateFilterValues } from "./dateFilterModel";

const options = (values: string[]) => values.map((value) => ({ value, label: value || "待定", count: 1 }));

describe("date filter hierarchy", () => {
  it("groups days under their own months and years without dropping pending or invalid values", () => {
    const tree = buildDateFilterTree(options(["2026-10-28", "2025-10-28", "2026-10-29", "", "2026-02-30"]), "day");
    expect(tree.map((node) => node.title)).toEqual(["待定", "2026-02-30", "2026年", "2025年"]);
    expect(tree[2]).toMatchObject({ count: 2, values: ["2026-10-28", "2026-10-29"] });
    expect(tree[2].children?.[0].children?.map((node) => node.title)).toEqual(["29日", "28日"]);
    expect(tree[3].children?.[0].children?.[0].values).toEqual(["2025-10-28"]);
  });

  it("stops at the month level for monthly billing and accepts leap days", () => {
    const tree = buildDateFilterTree(options(["2026-10", "2026-01", "2025-12"]), "month");
    expect(tree[0].children?.map((node) => node.title)).toEqual(["10月", "1月"]);
    expect(tree[0].children?.[0].children).toBeUndefined();
    expect(buildDateFilterTree(options(["2028-02-29"]), "day")[0].key).toBe("date:2028");
    expect(buildDateFilterTree(options(["2026-13-01"]), "day")[0].key).toBe("value:2026-13-01");
  });

  it("groups timestamps by the same local dates shown in lists and retains their exact values", () => {
    const first = new Date(2026, 9, 28, 1).toISOString();
    const second = new Date(2026, 9, 28, 22).toISOString();
    const next = new Date(2026, 9, 29, 1).toISOString();
    const tree = buildDateFilterTree(options([first, second, next]), "datetime");
    const days = tree[0].children?.[0].children;
    expect(days?.map((node) => node.title)).toEqual(["29日", "28日"]);
    expect(days?.[1]).toMatchObject({ values: [first, second], count: 2 });
    expect(buildDateFilterTree(options([first, second, next]), "datetime", "2026年10月28日")[0].count).toBe(2);
  });

  it("supports date and Chinese calendar searches without hiding unmatched selections", () => {
    const original = options(["2026-10-28", "2026-10-29", "2025-10-28", ""]);
    for (const search of ["2026-10-28", "2026年10月28日"]) {
      const tree = buildDateFilterTree(original, "day", search);
      expect(tree[0].values).toEqual(["2026-10-28"]);
      expect(toggleDateFilterValues(["2025-10-28", ""], tree[0].values, true)).toEqual([
        "2025-10-28",
        "",
        "2026-10-28",
      ]);
      expect(toggleDateFilterValues(["2025-10-28", "2026-10-28"], tree[0].values, false)).toEqual(["2025-10-28"]);
    }
    expect(buildDateFilterTree(original, "day", "10月")).toHaveLength(2);
    expect(buildDateFilterTree(original, "day", "待定")[0].values).toEqual([""]);
    expect(buildDateFilterTree(original, "day", "不存在")).toEqual([]);
  });

  it("marks partially selected years and months, and includes the entire branch on check", () => {
    const tree = buildDateFilterTree(options(["2026-10-28", "2026-10-29", "2026-11-01"]), "day");
    expect(dateFilterTreeState(tree, ["2026-10-28"])).toMatchObject({
      checked: ["date:2026-10-28"],
      halfChecked: ["date:2026", "date:2026-10"],
    });
    const all = toggleDateFilterValues(["2026-10-28", "hidden-value"], tree[0].values, true);
    expect(dateFilterTreeState(tree, all).halfChecked).toEqual([]);
    expect(toggleDateFilterValues(all, tree[0].values, false)).toEqual(["hidden-value"]);
  });

  it("keeps more than 500 candidates while rendering one day for many timestamps", () => {
    const entries = options(Array.from({ length: 1200 }, (_, index) => new Date(2026, 9, 28, 0, index).toISOString()));
    const tree = buildDateFilterTree(entries, "datetime");
    expect(tree[0].count).toBe(1200);
    expect(tree[0].children?.[0].children).toHaveLength(1);
    expect(tree[0].children?.[0].children?.[0].values).toHaveLength(1200);
  });
});
