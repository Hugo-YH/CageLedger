import { afterEach, expect, it, vi } from "vitest";

import { listAllQuantitySheetIds } from "./quantitySheets";

afterEach(() => vi.restoreAllMocks());

it("collects ID-only pages in server order while preserving filters, sorting, person mode and cancellation", async () => {
  const ids = Array.from({ length: 301 }, (_, index) => `sheet-${301 - index}`);
  const controller = new AbortController();
  const requests: URL[] = [];
  vi.spyOn(globalThis, "fetch").mockImplementation((input, init) => {
    const url = new URL(String(input), "http://localhost");
    requests.push(url);
    expect(init?.signal).toBe(controller.signal);
    const offset = Number(url.searchParams.get("offset"));
    const limit = Number(url.searchParams.get("limit"));
    return Promise.resolve(
      Response.json({
        items: ids.slice(offset, offset + limit).map((id) => ({ id })),
        page: { offset, limit, total: ids.length },
      }),
    );
  });
  await expect(
    listAllQuantitySheetIds(
      {
        limit: 10,
        offset: 20,
        sortKey: "month",
        sortDir: "desc",
        columnFilters: { pi: ["张三"], month: ["2026-10"] },
      },
      controller.signal,
    ),
  ).resolves.toEqual(ids);
  expect(requests.map((url) => Number(url.searchParams.get("offset")))).toEqual([0, 100, 200, 300]);
  for (const url of requests) {
    expect(url.pathname).toBe("/api/quantity-sheets");
    expect(url.searchParams.get("view")).toBe("ids");
    expect(url.searchParams.get("limit")).toBe("100");
    expect(url.searchParams.get("sortKey")).toBe("month");
    expect(url.searchParams.get("sortDir")).toBe("desc");
    expect(url.searchParams.get("personFilterMode")).toBe("individual");
    expect(JSON.parse(url.searchParams.get("columnFilters") || "{}")).toEqual({ pi: ["张三"], month: ["2026-10"] });
  }
});

it("rejects an aborted ID selection instead of turning it into an empty success", async () => {
  vi.spyOn(globalThis, "fetch").mockImplementation(
    (_input, init) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), {
          once: true,
        });
      }),
  );
  const controller = new AbortController();
  const selection = listAllQuantitySheetIds({ limit: 10, offset: 0 }, controller.signal);
  controller.abort();
  await expect(selection).rejects.toMatchObject({ name: "AbortError" });
});
