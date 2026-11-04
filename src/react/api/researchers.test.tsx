import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { afterEach, expect, it, vi } from "vitest";

import type { ResearcherEditable } from "../../contracts/researchers";
import {
  resolveResearcherContacts,
  usePreviewResearcherImport,
  useResearchers,
  useSaveResearcher,
} from "./researchers";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function setup() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return {
    client,
    wrapper: ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    ),
  };
}

it("resolves exact contacts through the authenticated read-only endpoint", async () => {
  const response = { items: [{ name: "张三", status: "matched", phone: "13800000001" }] };
  const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify(response)));
  vi.stubGlobal("fetch", fetch);
  expect(await resolveResearcherContacts(["张三"])).toEqual(response);
  expect(fetch.mock.calls[0][0]).toBe("/api/researchers/contacts/resolve");
  expect(fetch.mock.calls[0][1]).toMatchObject({ method: "POST", credentials: "same-origin" });
  expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual({ names: ["张三"] });
});

it("sends server filters and pagination with an abort signal", async () => {
  const fetch = vi
    .fn()
    .mockResolvedValue(
      new Response(JSON.stringify({ items: [], page: { total: 0, limit: 20, offset: 40 }, departments: [] })),
    );
  vi.stubGlobal("fetch", fetch);
  const { wrapper } = setup();
  const { result } = renderHook(() => useResearchers({ q: "张 三", department: "动物中心", limit: 20, offset: 40 }), {
    wrapper,
  });
  await waitFor(() => expect(result.current.isSuccess).toBe(true));
  const [url, options] = fetch.mock.calls[0];
  const search = new URL(url, "http://localhost").searchParams;
  expect(search.get("q")).toBe("张 三");
  expect(search.get("department")).toBe("动物中心");
  expect(search.get("offset")).toBe("40");
  expect(options.signal).toBeInstanceOf(AbortSignal);
});

it("submits only the edit payload and version and preserves write success if cache refresh fails", async () => {
  const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ item: { id: "r/1", name: "张三" } })));
  vi.stubGlobal("fetch", fetch);
  const { client, wrapper } = setup();
  const invalidate = vi.spyOn(client, "invalidateQueries").mockRejectedValue(new Error("refresh failed"));
  const { result } = renderHook(() => useSaveResearcher(), { wrapper });
  const item = { name: "张三", mobile: "123" } as ResearcherEditable;
  let response: unknown;
  await act(async () => {
    response = await result.current.mutateAsync({ id: "r/1", item, expectedUpdatedAt: "old-version" });
  });
  expect(response).toEqual({ item: { id: "r/1", name: "张三" } });
  expect(fetch.mock.calls[0][0]).toBe("/api/researchers/r%2F1");
  expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual({ item, expectedUpdatedAt: "old-version" });
  expect(invalidate).toHaveBeenCalledWith({ queryKey: ["researchers"] }, { throwOnError: false });
  expect(invalidate).toHaveBeenCalledWith({ queryKey: ["audit-events"] }, { throwOnError: false });
});

it("previews a pure base64 payload without invalidating or writing the directory", async () => {
  const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ confirmationToken: "token" })));
  vi.stubGlobal("fetch", fetch);
  const { client, wrapper } = setup();
  const invalidate = vi.spyOn(client, "invalidateQueries");
  const { result } = renderHook(() => usePreviewResearcherImport(), { wrapper });
  await act(() => result.current.mutateAsync({ filename: "人员.xlsx", data: "eGxzeA==" }));
  expect(fetch.mock.calls[0][0]).toBe("/api/researchers/import/preview");
  expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual({ filename: "人员.xlsx", data: "eGxzeA==" });
  expect(invalidate).not.toHaveBeenCalled();
});
