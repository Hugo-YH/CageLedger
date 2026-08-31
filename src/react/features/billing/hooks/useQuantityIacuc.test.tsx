import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useQuantityIacuc } from "./useQuantityIacuc";

describe("quantity sheet IACUC matching", () => {
  let client: QueryClient;
  let responses: Array<(response: Response) => void>;
  const onMatch = vi.fn();

  function wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  }
  function response(iacuc: string) {
    return Response.json({ items: [{ iacuc, project: `项目 ${iacuc}`, pi: "PI", owner: "负责人", funding: "经费" }] });
  }
  beforeEach(() => {
    client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    responses = [];
    onMatch.mockClear();
    vi.spyOn(globalThis, "fetch").mockImplementation(
      () =>
        new Promise<Response>((resolve) => {
          responses.push(resolve);
        }),
    );
  });
  afterEach(() => {
    cleanup();
    client.clear();
    vi.restoreAllMocks();
  });

  it("keeps only the latest blur result even without a search observer to cancel the old request", async () => {
    const { result } = renderHook(() => useQuantityIacuc("", onMatch), { wrapper });
    const first = result.current.apply("Z1");
    const second = result.current.apply("Z2");
    await act(async () => {
      responses[1](response("Z2"));
      await second;
    });
    await act(async () => {
      responses[0](response("Z1"));
      await first;
    });
    expect(onMatch).toHaveBeenCalledTimes(1);
    expect(onMatch.mock.calls[0][0].iacuc).toBe("Z2");
  });

  it("invalidates a pending fill when typing, resetting or closing a form", async () => {
    const { result } = renderHook(() => useQuantityIacuc("", onMatch), { wrapper });
    const pending = result.current.apply("Z1");
    act(() => result.current.reset());
    await act(async () => {
      responses[0](response("Z1"));
      await pending;
    });
    expect(onMatch).not.toHaveBeenCalled();
    expect(result.current.error).toBe("");
  });

  it("does not apply results after unmount", async () => {
    const { result, unmount } = renderHook(() => useQuantityIacuc("", onMatch), { wrapper });
    const pending = result.current.apply("Z1");
    unmount();
    responses[0](response("Z1"));
    await pending;
    expect(onMatch).not.toHaveBeenCalled();
  });

  it("coalesces repeated lookups, fills only once and reuses the normalized cache", async () => {
    const { result } = renderHook(() => useQuantityIacuc("", onMatch), { wrapper });
    const first = result.current.apply("z1 ");
    const second = result.current.apply("Z1");
    expect(responses).toHaveLength(1);
    await act(async () => {
      responses[0](response("Z1"));
      await Promise.all([first, second]);
    });
    expect(onMatch).toHaveBeenCalledTimes(1);
    await act(async () => {
      await result.current.apply("Z1");
    });
    expect(responses).toHaveLength(1);
  });

  it("reports errors, ignores stale failures and clears the error on successful retry", async () => {
    const { result } = renderHook(() => useQuantityIacuc("", onMatch), { wrapper });
    const first = result.current.apply("Z1");
    await act(async () => {
      responses[0](Response.json({ error: "无权限" }, { status: 403 }));
      await first;
    });
    expect(result.current.error).toContain("无权限");
    const second = result.current.apply("Z1");
    await act(async () => {
      responses[1](response("Z1"));
      await second;
    });
    expect(result.current.error).toBe("");
    const stale = result.current.apply("Z2");
    act(() => result.current.reset());
    await act(async () => {
      responses[2](Response.json({ error: "迟到的失败" }, { status: 403 }));
      await stale;
    });
    expect(result.current.error).toBe("");
  });
});
