import { describe, expect, it } from "vitest";

import { loadAllPages } from "./pagination";

describe("loadAllPages", () => {
  it("reads every server page while preserving result order", async () => {
    const calls: Array<[number, number]> = [];
    const items = await loadAllPages((offset, limit) => {
      calls.push([offset, limit]);
      const values = ["a", "b", "c", "d", "e"].slice(offset, offset + limit);
      return Promise.resolve({
        items: values,
        page: { offset, limit, total: 5, hasMore: offset + values.length < 5 },
      });
    }, 2);

    expect(items).toEqual(["a", "b", "c", "d", "e"]);
    expect(calls).toEqual([
      [0, 2],
      [2, 2],
      [4, 2],
    ]);
  });
});
