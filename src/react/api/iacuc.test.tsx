import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useIacucSearch } from "./iacuc";

describe("IACUC search", () => {
  let client: QueryClient;
  let requests: Array<{ url: string; signal: AbortSignal; resolve: (response: Response) => void }>;

  function wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  }
  async function advance(milliseconds = 250) {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(milliseconds);
    });
  }
  async function respond(index: number, iacuc: string) {
    await act(async () => {
      requests[index].resolve(Response.json({ items: [{ iacuc }] }));
      await Promise.resolve();
    });
    await advance(1);
  }

  beforeEach(() => {
    vi.useFakeTimers();
    client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    requests = [];
    // Deliberately ignore cancellation: a late transport response must still not replace the new key's data.
    vi.spyOn(globalThis, "fetch").mockImplementation(
      (url, init) =>
        new Promise<Response>((resolve) => {
          if (!init?.signal) throw new Error("Missing AbortSignal");
          requests.push({ url: String(url), signal: init.signal, resolve });
        }),
    );
  });
  afterEach(() => {
    cleanup();
    client.clear();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("debounces rapid input and normalizes keys without redundant case/space requests", async () => {
    const hook = renderHook(({ value }) => useIacucSearch(value), { wrapper, initialProps: { value: "" } });
    hook.rerender({ value: "z" });
    await advance(100);
    hook.rerender({ value: "z2026" });
    await advance(249);
    expect(requests).toHaveLength(0);
    await advance(1);
    expect(requests).toHaveLength(1);
    expect(requests[0].url).toContain("q=Z2026");
    await respond(0, "Z2026001");
    hook.rerender({ value: " Z2026 " });
    await advance();
    expect(requests).toHaveLength(1);
    expect(hook.result.current.data?.items[0].iacuc).toBe("Z2026001");
  });

  it("immediately hides previous suggestions when typing or clearing, and reuses fresh cached results", async () => {
    const hook = renderHook(({ value }) => useIacucSearch(value), { wrapper, initialProps: { value: "Z1" } });
    await respond(0, "Z1");
    expect(hook.result.current.data?.items[0].iacuc).toBe("Z1");
    hook.rerender({ value: "Z2" });
    expect(hook.result.current.data).toBeUndefined();
    await advance();
    await respond(1, "Z2");
    hook.rerender({ value: "" });
    expect(hook.result.current.data).toBeUndefined();
    await advance();
    expect(requests).toHaveLength(2);
    hook.rerender({ value: "Z1" });
    await advance();
    expect(hook.result.current.data?.items[0].iacuc).toBe("Z1");
    expect(requests).toHaveLength(2);
  });

  it("ignores out-of-order responses and aborts obsolete searches", async () => {
    const hook = renderHook(({ value }) => useIacucSearch(value), { wrapper, initialProps: { value: "Z1" } });
    hook.rerender({ value: "Z2" });
    await advance();
    expect(requests[0].signal.aborted).toBe(true);
    await respond(1, "Z2");
    await respond(0, "Z1");
    expect(hook.result.current.data?.items[0].iacuc).toBe("Z2");
  });

  it("keeps result limits in the cache key", async () => {
    const hook = renderHook(({ limit }) => useIacucSearch("Z1", limit), { wrapper, initialProps: { limit: 1 } });
    await respond(0, "Z1");
    hook.rerender({ limit: 20 });
    expect(requests).toHaveLength(2);
    expect(requests[1].url).toContain("limit=20");
    expect(hook.result.current.data).toBeUndefined();
  });
});
