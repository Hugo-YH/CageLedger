import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import type { SystemFeatureFlags } from "../../contracts/systemFeatures";
import { useSaveSystemFeatures, useSystemFeatures } from "./systemFeatures";
import { queryKeys } from "./queryKeys";

const enabled: SystemFeatureFlags = {
  intake: true,
  quarantine: true,
  cages: true,
  animal: true,
  billing: true,
  "technical-services": true,
  settlement: true,
};

let client: QueryClient;
function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
});

afterEach(() => {
  cleanup();
  client.clear();
  vi.restoreAllMocks();
});

it("returns the configuration item directly instead of its response envelope", async () => {
  vi.spyOn(globalThis, "fetch").mockResolvedValue(Response.json({ item: { enabled, updatedAt: null } }));

  const { result } = renderHook(useSystemFeatures, { wrapper });

  await waitFor(() => expect(result.current.data).toEqual({ enabled, updatedAt: null }));
  expect(globalThis.fetch).toHaveBeenCalledWith(
    "/api/system/features",
    expect.objectContaining({ signal: expect.any(AbortSignal) }),
  );
});

it("saves the full flag set with its version and refreshes the shared cache", async () => {
  const saved = { enabled: { ...enabled, quarantine: false }, updatedAt: "2026-10-15T08:00:00Z" };
  vi.spyOn(globalThis, "fetch").mockResolvedValue(Response.json({ item: saved }));
  const { result } = renderHook(useSaveSystemFeatures, { wrapper });

  await act(async () => {
    await result.current.mutateAsync({ enabled: saved.enabled, expectedUpdatedAt: null });
  });

  expect(globalThis.fetch).toHaveBeenCalledWith(
    "/api/system/features",
    expect.objectContaining({
      method: "PUT",
      body: JSON.stringify({ enabled: saved.enabled, expectedUpdatedAt: null }),
    }),
  );
  expect(client.getQueryData(queryKeys.systemFeatures)).toEqual(saved);
});

it("cancels an in-flight stale read before saving so it cannot replace the returned version", async () => {
  const initial = { enabled, updatedAt: "2026-10-15T08:00:00Z" };
  const saved = { enabled: { ...enabled, quarantine: false }, updatedAt: "2026-10-15T09:00:00Z" };
  const stale = { enabled: { ...enabled, intake: false }, updatedAt: "2026-10-15T08:30:00Z" };
  let resolveStale!: (response: Response) => void;
  let staleSignal: AbortSignal | undefined;
  let calls = 0;
  vi.spyOn(globalThis, "fetch").mockImplementation((_url, init) => {
    calls += 1;
    if (calls === 1) return Promise.resolve(Response.json({ item: initial }));
    if (calls === 2)
      return new Promise<Response>((resolve) => {
        staleSignal = init?.signal ?? undefined;
        resolveStale = resolve;
      });
    return Promise.resolve(Response.json({ item: saved }));
  });

  const { result } = renderHook(() => ({ features: useSystemFeatures(), save: useSaveSystemFeatures() }), { wrapper });
  await waitFor(() => expect(result.current.features.data).toEqual(initial));

  void result.current.features.refetch();
  await waitFor(() => expect(staleSignal).toBeDefined());
  await act(async () => {
    await result.current.save.mutateAsync({ enabled: saved.enabled, expectedUpdatedAt: initial.updatedAt });
  });
  expect(staleSignal?.aborted).toBe(true);
  expect(client.getQueryData(queryKeys.systemFeatures)).toEqual(saved);
  expect(calls).toBe(3);

  await act(async () => {
    resolveStale(Response.json({ item: stale }));
    await Promise.resolve();
  });
  await waitFor(() => expect(client.getQueryData(queryKeys.systemFeatures)).toEqual(saved));
  expect(calls).toBe(3);
});

it("initializes from authenticated session without a second startup request", () => {
  const item = { enabled: { ...enabled, quarantine: false }, updatedAt: "2026-10-15T08:00:00Z" };
  client.setQueryData(queryKeys.session, { user: { id: "admin" }, features: item });
  const fetchSpy = vi.spyOn(globalThis, "fetch");
  const { result } = renderHook(useSystemFeatures, { wrapper });
  expect(result.current.data).toEqual(item);
  expect(fetchSpy).not.toHaveBeenCalled();
});

it("keeps a saved configuration when an older session response is available", async () => {
  const old = { enabled, updatedAt: null };
  const saved = { enabled: { ...enabled, quarantine: false }, updatedAt: "2026-10-15T09:00:00Z" };
  client.setQueryData(queryKeys.session, { user: { id: "admin" }, features: old });
  const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(Response.json({ item: saved }));
  const { result, unmount } = renderHook(() => ({ features: useSystemFeatures(), save: useSaveSystemFeatures() }), {
    wrapper,
  });
  await act(async () => {
    await result.current.save.mutateAsync({ enabled: saved.enabled, expectedUpdatedAt: null });
  });
  expect(client.getQueryData<{ features: typeof saved }>(queryKeys.session)?.features).toEqual(saved);
  unmount();
  const fresh = renderHook(useSystemFeatures, { wrapper });
  expect(fresh.result.current.data).toEqual(saved);
  expect(fetchSpy).toHaveBeenCalledTimes(1);
});

it("waits for the independent configuration request when session features are absent", async () => {
  client.setQueryData(queryKeys.session, { user: { id: "admin" } });
  let resolve!: (value: Response) => void;
  vi.spyOn(globalThis, "fetch").mockImplementation(
    () =>
      new Promise<Response>((done) => {
        resolve = done;
      }),
  );
  const { result } = renderHook(useSystemFeatures, { wrapper });
  expect(result.current.data).toBeUndefined();
  act(() => {
    resolve(Response.json({ item: { enabled: { ...enabled, quarantine: false }, updatedAt: null } }));
  });
  await waitFor(() => expect(result.current.data?.enabled.quarantine).toBe(false));
});
