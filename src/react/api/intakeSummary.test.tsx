import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, expect, it, vi } from "vitest";
import type { IntakeBatchListItem } from "../../contracts/intake";
import {
  fetchIntakeBatchesForPrint,
  listIntakeBatches,
  listIntakeBatchSummaries,
  useIntakeBatchDetail,
} from "./intake";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

it("keeps the legacy list full and explicitly requests summary projection", async () => {
  const fetchSpy = vi
    .spyOn(globalThis, "fetch")
    .mockImplementation(() => Promise.resolve(Response.json({ items: [], page: {} })));
  await listIntakeBatches({ limit: 10, offset: 0 });
  await listIntakeBatchSummaries({ limit: 10, offset: 0 });
  expect(String(fetchSpy.mock.calls[0][0])).toBe("/api/intake-batches?limit=10&offset=0");
  expect(String(fetchSpy.mock.calls[1][0])).toBe("/api/intake-batches?limit=10&offset=0&view=summary");
});

it("does not request detail until an id is selected", async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const fetchSpy = vi
    .spyOn(globalThis, "fetch")
    .mockResolvedValue(Response.json({ item: { id: "batch/a", cards: [] } }));
  function wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  }
  const { rerender } = renderHook(({ id }) => useIntakeBatchDetail(id), { wrapper, initialProps: { id: "" } });
  expect(fetchSpy).not.toHaveBeenCalled();
  rerender({ id: "batch/a" });
  await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(1));
  expect(fetchSpy.mock.calls[0][0]).toBe("/api/intake-batches/batch%2Fa");
  client.clear();
});

it("freezes selected versions and limits each print read to 200 ids", async () => {
  const items = Array.from(
    { length: 201 },
    (_, index) => ({ id: `batch-${index}`, updatedAt: `v${index}` }) as IntakeBatchListItem,
  );
  const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation((_url, init) => {
    const body = JSON.parse(String(init?.body)) as { ids: string[] };
    return Promise.resolve(Response.json({ items: body.ids.map((id) => ({ id })) }));
  });
  const result = await fetchIntakeBatchesForPrint(items);
  expect(result).toHaveLength(201);
  expect(fetchSpy).toHaveBeenCalledTimes(2);
  const first = JSON.parse(String(fetchSpy.mock.calls[0][1]?.body)) as {
    ids: string[];
    expectedVersions: Record<string, string>;
  };
  const second = JSON.parse(String(fetchSpy.mock.calls[1][1]?.body)) as {
    ids: string[];
    expectedVersions: Record<string, string>;
  };
  expect(first.ids).toHaveLength(200);
  expect(first.expectedVersions["batch-0"]).toBe("v0");
  expect(second).toEqual({ ids: ["batch-200"], expectedVersions: { "batch-200": "v200" } });
});

it("propagates stale-version conflicts instead of returning a printable batch", async () => {
  vi.spyOn(globalThis, "fetch").mockResolvedValue(Response.json({ error: "批次已更新" }, { status: 409 }));
  await expect(fetchIntakeBatchesForPrint([{ id: "a", updatedAt: "v1" } as IntakeBatchListItem])).rejects.toMatchObject(
    { status: 409 },
  );
});
