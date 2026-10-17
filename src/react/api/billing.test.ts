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
            ? [{ id: "candidate-1", month: "2026-07", pi: "甲", iacucs: ["Z1"], manager: "张三", totalAmount: 10 }]
            : [{ id: "candidate-2", month: "2026-07", pi: "乙", iacucs: ["Z2"], manager: "李四", totalAmount: 20 }],
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

  it("bounds page fetches to three concurrent requests while preserving result order", async () => {
    const pending: Array<{ offset: number; resolve: (response: Response) => void }> = [];
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(
      (input) =>
        new Promise<Response>((resolve) => {
          pending.push({
            offset: Number(new URL(String(input), "http://localhost").searchParams.get("offset")),
            resolve,
          });
        }),
    );
    const resolvePage = (offset: number) => {
      const page = pending.find((request) => request.offset === offset);
      page?.resolve(
        Response.json({
          items: [{ id: `candidate-${offset}` }],
          page: { total: 601, limit: 100, offset },
          filterOptions: {},
        }),
      );
    };

    const result = fetchAllSettlementCandidates({ limit: 10, offset: 10 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    resolvePage(0);
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(4));
    resolvePage(100);
    resolvePage(200);
    resolvePage(300);
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(7));
    resolvePage(400);
    resolvePage(500);
    resolvePage(600);

    await expect(result).resolves.toMatchObject([
      { id: "candidate-0" },
      { id: "candidate-100" },
      { id: "candidate-200" },
      { id: "candidate-300" },
      { id: "candidate-400" },
      { id: "candidate-500" },
      { id: "candidate-600" },
    ]);
  });

  it("stops before starting later page groups when a concurrent page fails", async () => {
    const pending: Array<{ offset: number; reject: (error: Error) => void; resolve: (response: Response) => void }> =
      [];
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(
      (input) =>
        new Promise<Response>((resolve, reject) => {
          pending.push({
            offset: Number(new URL(String(input), "http://localhost").searchParams.get("offset")),
            resolve,
            reject,
          });
        }),
    );
    const result = fetchAllSettlementCandidates({ limit: 10, offset: 10 });
    await vi.waitFor(() => expect(pending).toHaveLength(1));
    pending
      .find((request) => request.offset === 0)
      ?.resolve(Response.json({ items: [], page: { total: 601, limit: 100, offset: 0 }, filterOptions: {} }));
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(4));
    const failure = new Error("network failed");
    pending.find((request) => request.offset === 200)?.reject(failure);

    await expect(result).rejects.toBe(failure);
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it("passes cancellation to every in-flight page request", async () => {
    const signals: AbortSignal[] = [];
    const pending: Array<{ offset: number; resolve: (response: Response) => void }> = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(
      (input, init) =>
        new Promise<Response>((resolve, reject) => {
          const signal = init?.signal;
          if (!signal) throw new Error("Missing AbortSignal");
          signals.push(signal);
          signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
          pending.push({
            offset: Number(new URL(String(input), "http://localhost").searchParams.get("offset")),
            resolve,
          });
        }),
    );
    const controller = new AbortController();
    const result = fetchAllSettlementCandidates({ limit: 10, offset: 10 }, controller.signal);
    await vi.waitFor(() => expect(pending).toHaveLength(1));
    pending
      .find((request) => request.offset === 0)
      ?.resolve(Response.json({ items: [], page: { total: 601, limit: 100, offset: 0 }, filterOptions: {} }));
    await vi.waitFor(() => expect(pending).toHaveLength(4));
    controller.abort();

    await expect(result).rejects.toMatchObject({ name: "AbortError" });
    expect(signals).toHaveLength(4);
    expect(signals.every((signal) => signal.aborted)).toBe(true);
  });
});
