import { afterEach, describe, expect, it, vi } from "vitest";

import { fetchAllSettlementCandidates } from "./billing";

describe("fetchAllSettlementCandidates", () => {
  afterEach(() => vi.restoreAllMocks());

  it("loads every page with the active settlement filters", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation((input) => {
      const url = new URL(String(input), "http://localhost");
      const offset = Number(url.searchParams.get("offset"));
      const payload = {
        items:
          offset === 0
            ? [{ id: "candidate-1", month: "2026-07", pi: "甲", iacucs: ["Z1"], totalAmount: 10 }]
            : [{ id: "candidate-2", month: "2026-07", pi: "乙", iacucs: ["Z2"], totalAmount: 20 }],
        page: { total: 101, limit: 100, offset },
        filterOptions: {},
      };
      return Promise.resolve(new Response(JSON.stringify(payload), { status: 200 }));
    });

    const candidates = await fetchAllSettlementCandidates({
      limit: 10,
      offset: 10,
      sortKey: "pi",
      sortDir: "asc",
      columnFilters: { month: ["2026-07"] },
    });

    expect(candidates.map((candidate) => candidate.id)).toEqual(["candidate-1", "candidate-2"]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    for (const [request] of fetchMock.mock.calls) {
      const url = new URL(String(request), "http://localhost");
      expect(url.searchParams.get("limit")).toBe("100");
      expect(url.searchParams.get("sortKey")).toBe("pi");
      expect(url.searchParams.get("columnFilters")).toBe(JSON.stringify({ month: ["2026-07"] }));
    }
  });
});
