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

  it("reads remaining pages in batches of three while preserving offset order", async () => {
    const starts: number[] = [];
    let active = 0;
    let maxConcurrent = 0;
    const items = await loadAllPages(async (offset, limit) => {
      starts.push(offset);
      active += 1;
      maxConcurrent = Math.max(maxConcurrent, active);
      await new Promise((resolve) => window.setTimeout(resolve, 1));
      active -= 1;
      const values = Array.from({ length: Math.min(limit, 601 - offset) }, (_, index) => offset + index);
      return { items: values, page: { offset, limit, total: 601 } };
    });

    expect(items).toEqual(Array.from({ length: 601 }, (_, index) => index));
    expect(starts).toEqual([0, 100, 200, 300, 400, 500, 600]);
    expect(maxConcurrent).toBe(3);
  });

  it("retains page order when a later offset completes first", async () => {
    const delays: Record<number, number> = { 100: 30, 200: 20, 300: 10 };
    const items = await loadAllPages(async (offset, limit) => {
      await new Promise((resolve) => window.setTimeout(resolve, delays[offset] ?? 0));
      const values = Array.from({ length: Math.min(limit, 301 - offset) }, (_, index) => offset + index);
      return { items: values, page: { offset, limit, total: 301 } };
    });

    expect(items).toEqual(Array.from({ length: 301 }, (_, index) => index));
  });

  it("handles empty and final short pages without duplicate requests", async () => {
    const emptyCalls: number[] = [];
    await expect(
      loadAllPages((offset, limit) => {
        emptyCalls.push(offset);
        return Promise.resolve({ items: [], page: { offset, limit, total: 0 } });
      }),
    ).resolves.toEqual([]);
    expect(emptyCalls).toEqual([0]);

    const shortCalls: number[] = [];
    const items = await loadAllPages((offset, limit) => {
      shortCalls.push(offset);
      const values = Array.from({ length: Math.min(limit, 250 - offset) }, (_, index) => offset + index);
      return Promise.resolve({ items: values, page: { offset, limit, total: 250 } });
    });
    expect(items).toEqual(Array.from({ length: 250 }, (_, index) => index));
    expect(shortCalls).toEqual([0, 100, 200]);
  });

  it("falls back to actual offsets when the server caps every page below the requested size", async () => {
    const calls: number[] = [];
    const items = await loadAllPages((offset, limit) => {
      calls.push(offset);
      const length = Math.min(50, limit, 250 - offset);
      const values = Array.from({ length }, (_, index) => offset + index);
      return Promise.resolve({ items: values, page: { offset, limit, total: 250 } });
    });

    expect(items).toEqual(Array.from({ length: 250 }, (_, index) => index));
    expect(calls).toEqual([0, 50, 100, 150, 200]);
  });

  it("discards later prefetches after a non-final short page and resumes without gaps", async () => {
    const calls: number[] = [];
    const items = await loadAllPages((offset, limit) => {
      calls.push(offset);
      const length = offset === 200 ? 50 : Math.min(limit, 500 - offset);
      const values = Array.from({ length }, (_, index) => offset + index);
      return Promise.resolve({ items: values, page: { offset, limit, total: 500 } });
    });

    expect(items).toEqual(Array.from({ length: 500 }, (_, index) => index));
    expect(calls).toEqual([0, 100, 200, 300, 250, 350, 450]);
  });

  it("continues after total growth and stops after total shrink", async () => {
    const growingCalls: number[] = [];
    const grown = await loadAllPages((offset, limit) => {
      growingCalls.push(offset);
      const total = offset === 0 ? 250 : 350;
      const values = Array.from({ length: Math.min(limit, total - offset) }, (_, index) => offset + index);
      return Promise.resolve({ items: values, page: { offset, limit, total } });
    });
    expect(grown).toEqual(Array.from({ length: 350 }, (_, index) => index));
    expect(growingCalls).toEqual([0, 100, 200, 300]);

    const shrinkingCalls: number[] = [];
    const shrunk = await loadAllPages((offset, limit) => {
      shrinkingCalls.push(offset);
      const total = offset === 0 ? 350 : 250;
      const values = Array.from({ length: Math.max(0, Math.min(limit, total - offset)) }, (_, index) => offset + index);
      return Promise.resolve({ items: values, page: { offset, limit, total } });
    });
    expect(shrunk).toEqual(Array.from({ length: 250 }, (_, index) => index));
    expect(shrinkingCalls).toEqual([0, 100, 200, 300]);
  });

  it("does not start a later batch after an error or cancellation", async () => {
    for (const error of [new Error("network failed"), new DOMException("cancelled", "AbortError")]) {
      const starts: number[] = [];
      await expect(
        loadAllPages((offset, limit) => {
          starts.push(offset);
          if (offset === 200) return Promise.reject(error);
          const values = Array.from({ length: Math.min(limit, 601 - offset) }, (_, index) => offset + index);
          return Promise.resolve({ items: values, page: { offset, limit, total: 601 } });
        }),
      ).rejects.toBe(error);
      expect(starts.sort((left, right) => left - right)).toEqual([0, 100, 200, 300]);
    }
  });
});
