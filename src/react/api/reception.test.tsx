import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import type { ReceptionExportRequest, ReceptionListParams } from "../../contracts/reception";
import { requestDownload, requestJson } from "./client";
import { queryKeys } from "./queryKeys";
import { useExportReceptions, usePreviewReceptions, useReceptionFilterOptions, useReceptions } from "./reception";

vi.mock("./client", () => ({ requestJson: vi.fn(), requestDownload: vi.fn() }));
let client: QueryClient;
function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
const params: ReceptionListParams = {
  limit: 20,
  offset: 40,
  sortKey: "receiptDate",
  sortDir: "desc",
  columnFilters: { pi: ["甲"] },
};
const request: ReceptionExportRequest = {
  ids: ["batch-1"],
  expectedVersions: { "batch-1": "batch-v1" },
  expectedApplicationVersion: "application-v1",
};
beforeEach(() => {
  client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 60_000 }, mutations: { retry: false } },
  });
  vi.mocked(requestJson).mockReset();
  vi.mocked(requestDownload).mockReset();
});
afterEach(() => {
  cleanup();
  client.clear();
});

it("reads the reception page directly with serialized filters and a cancellable request", async () => {
  const response = { items: [], page: { limit: 20, offset: 40, total: 41, hasMore: false }, applicationVersion: "a1" };
  vi.mocked(requestJson).mockResolvedValue(response);
  const { result } = renderHook(() => useReceptions(params), { wrapper });
  await waitFor(() => expect(result.current.data).toEqual(response));
  const [url, init] = vi.mocked(requestJson).mock.calls[0];
  const parsed = new URL(String(url), "http://localhost");
  expect(parsed.pathname).toBe("/api/receptions");
  expect(parsed.searchParams.get("offset")).toBe("40");
  expect(JSON.parse(parsed.searchParams.get("columnFilters") || "{}")).toEqual({ pi: ["甲"] });
  expect(init?.signal).toBeInstanceOf(AbortSignal);
  expect(client.getQueryData(queryKeys.receptions(params))).toEqual(response);
});

it("fetches column options only after opening and uses the reception cache root", async () => {
  vi.mocked(requestJson).mockResolvedValue({ items: [{ value: "", label: "空白", count: 1 }] });
  const { result, rerender } = renderHook(
    ({ open }) => useReceptionFilterOptions("receiptDate", params.columnFilters, open),
    { wrapper, initialProps: { open: false } },
  );
  expect(requestJson).not.toHaveBeenCalled();
  rerender({ open: true });
  await waitFor(() => expect(result.current.isSuccess).toBe(true));
  expect(String(vi.mocked(requestJson).mock.calls[0][0])).toContain(
    "/api/receptions/filter-options?column=receiptDate",
  );
});

it("freezes both source versions for preview and download and invalidates audit only after success", async () => {
  vi.mocked(requestJson).mockResolvedValue({
    items: [],
    rowCount: 2,
    applicationVersion: "application-v1",
    warnings: ["需核对"],
  });
  vi.mocked(requestDownload).mockRejectedValueOnce(new Error("数据已变化")).mockResolvedValueOnce("接收.xlsx");
  client.setQueryData(queryKeys.auditEvents({}), { items: [] });
  const { result } = renderHook(() => ({ preview: usePreviewReceptions(), export: useExportReceptions() }), {
    wrapper,
  });
  await act(async () => {
    await result.current.preview.mutateAsync(request);
  });
  expect(requestJson).toHaveBeenCalledWith("/api/receptions/preview", {
    method: "POST",
    body: JSON.stringify(request),
  });
  await act(async () => {
    await expect(result.current.export.mutateAsync(request)).rejects.toThrow("数据已变化");
  });
  expect(client.getQueryState(queryKeys.auditEvents({}))?.isInvalidated).toBe(false);
  await act(async () => {
    await result.current.export.mutateAsync(request);
  });
  expect(requestDownload).toHaveBeenLastCalledWith("/api/receptions/export", {
    method: "POST",
    body: JSON.stringify(request),
  });
  expect(client.getQueryState(queryKeys.auditEvents({}))?.isInvalidated).toBe(true);
});
