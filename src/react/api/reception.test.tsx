import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import type { ReceptionExportRequest, ReceptionListParams } from "../../contracts/reception";
import { requestDownload, requestJson, requestMultipart } from "./client";
import { queryKeys } from "./queryKeys";
import {
  useExportReceptions,
  usePreviewReceptions,
  useReceptionFilterOptions,
  useReceptions,
  useReceptionRegistration,
  useUploadReceptionCertificate,
  useRecognizeReceptionCertificate,
  useSaveReceptionRegistration,
} from "./reception";

vi.mock("./client", () => ({ requestJson: vi.fn(), requestDownload: vi.fn(), requestMultipart: vi.fn() }));
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
  vi.mocked(requestMultipart).mockReset();
});

it("reads certificate details only on demand with cancellation and no prior-batch placeholder", async () => {
  const response = { attachments: [], runs: [], registration: null, canWrite: true };
  vi.mocked(requestJson).mockResolvedValue(response);
  const { result, rerender } = renderHook(({ batchId, enabled }) => useReceptionRegistration(batchId, enabled), {
    wrapper,
    initialProps: { batchId: "batch/1", enabled: false },
  });
  expect(requestJson).not.toHaveBeenCalled();
  rerender({ batchId: "batch/1", enabled: true });
  await waitFor(() => expect(result.current.data).toEqual(response));
  expect(requestJson).toHaveBeenCalledWith("/api/receptions/batch%2F1/registration", {
    signal: expect.any(AbortSignal),
  });
  vi.mocked(requestJson).mockImplementation(() => new Promise(() => {}));
  rerender({ batchId: "batch-2", enabled: true });
  expect(result.current.data).toBeUndefined();
});

it("uploads the original PDF as multipart and invalidates reception details, list and audit", async () => {
  client.setQueryData(queryKeys.receptions(params), { items: [] });
  client.setQueryData(queryKeys.receptionRegistration("batch-1"), { attachments: [{ id: "a1" }] });
  client.setQueryData(queryKeys.receptionRegistration("other-batch"), { attachments: [] });
  client.setQueryData(queryKeys.receptionFilterOptions("pi", {}), { items: [] });
  client.setQueryData(queryKeys.auditEvents({}), { items: [] });
  vi.mocked(requestMultipart).mockResolvedValue({ attachment: { id: "a1" }, reused: false });
  const { result } = renderHook(() => useUploadReceptionCertificate("batch-1"), { wrapper });
  const file = new File(["%PDF-1.7"], "certificate.pdf", { type: "application/pdf" });
  await act(async () => {
    await result.current.mutateAsync({ file, expectedBatchUpdatedAt: "batch v1/+" });
  });
  const [url, form] = vi.mocked(requestMultipart).mock.calls[0];
  expect(new URL(url, "http://localhost").searchParams.get("expectedBatchUpdatedAt")).toBe("batch v1/+");
  expect(form.get("file")).toBe(file);
  expect(client.getQueryState(queryKeys.receptions(params))?.isInvalidated).toBe(true);
  expect(client.getQueryState(queryKeys.receptionRegistration("batch-1"))?.isInvalidated).toBe(true);
  expect(client.getQueryData(queryKeys.receptionRegistration("batch-1"))).toEqual({ attachments: [{ id: "a1" }] });
  expect(client.getQueryState(queryKeys.receptionRegistration("other-batch"))?.isInvalidated).toBe(false);
  expect(client.getQueryState(queryKeys.receptionFilterOptions("pi", {}))?.isInvalidated).toBe(false);
  expect(client.getQueryState(queryKeys.auditEvents({}))?.isInvalidated).toBe(true);
});

it("refreshes a standalone upload's active registration without needing a recognition request", async () => {
  let attachments: Array<{ id: string }> = [];
  vi.mocked(requestJson).mockImplementation(() => Promise.resolve({ attachments, runs: [] }));
  vi.mocked(requestMultipart).mockImplementation(() => {
    attachments = [{ id: "a1" }];
    return Promise.resolve({ attachment: attachments[0], reused: false });
  });
  const { result } = renderHook(
    () => ({ detail: useReceptionRegistration("batch-1"), upload: useUploadReceptionCertificate("batch-1") }),
    { wrapper },
  );
  await waitFor(() => expect(result.current.detail.isSuccess).toBe(true));
  await act(async () => {
    await result.current.upload.mutateAsync({
      file: new File(["%PDF"], "certificate.pdf", { type: "application/pdf" }),
      expectedBatchUpdatedAt: "b1",
    });
  });
  await waitFor(() => expect(requestJson).toHaveBeenCalledTimes(2));
  expect(result.current.detail.data?.attachments).toEqual([{ id: "a1" }]);
});

it("keeps recognition and registration writes explicit, versioned and without automatic retries", async () => {
  client.setQueryData(queryKeys.receptions(params), { items: [] });
  client.setQueryData(queryKeys.receptionRegistration("batch/1"), { attachments: [], runs: [] });
  client.setQueryData(queryKeys.receptionRegistration("other-batch"), { attachments: [], runs: [] });
  client.setQueryData(queryKeys.receptionFilterOptions("pi", {}), { items: [] });
  client.setQueryData(queryKeys.auditEvents({}), { items: [] });
  const { result } = renderHook(
    () => ({
      recognize: useRecognizeReceptionCertificate("batch/1"),
      save: useSaveReceptionRegistration("batch/1"),
    }),
    { wrapper },
  );
  vi.mocked(requestJson).mockRejectedValueOnce(new Error("network failure"));
  const recognition = { attachmentId: "attachment/1", requestId: "same-request", expectedBatchUpdatedAt: "b1" };
  await act(async () => {
    await expect(result.current.recognize.mutateAsync(recognition)).rejects.toThrow("network failure");
  });
  expect(requestJson).toHaveBeenCalledTimes(1);
  expect(client.getQueryState(queryKeys.receptionRegistration("batch/1"))?.isInvalidated).toBe(true);
  expect(client.getQueryState(queryKeys.auditEvents({}))?.isInvalidated).toBe(true);
  expect(client.getQueryState(queryKeys.receptions(params))?.isInvalidated).toBe(false);
  vi.mocked(requestJson).mockResolvedValue({ run: { id: "r1", status: "completed" } });
  await act(async () => {
    await result.current.recognize.mutateAsync(recognition);
  });
  expect(requestJson).toHaveBeenLastCalledWith("/api/receptions/batch%2F1/certificates/attachment%2F1/recognize", {
    method: "POST",
    body: JSON.stringify({ requestId: "same-request", expectedBatchUpdatedAt: "b1" }),
  });
  expect(client.getQueryState(queryKeys.receptions(params))?.isInvalidated).toBe(false);
  expect(client.getQueryState(queryKeys.receptionRegistration("other-batch"))?.isInvalidated).toBe(false);
  expect(client.getQueryState(queryKeys.receptionFilterOptions("pi", {}))?.isInvalidated).toBe(false);
  const saveRequest = {
    requestId: "save-1",
    expectedBatchUpdatedAt: "b1",
    expectedRegistrationUpdatedAt: null,
    expectedApplicationVersion: "a1",
    acknowledged: true as const,
    lines: [],
  };
  vi.mocked(requestJson).mockResolvedValue({ registration: { id: "registration-1" } });
  await act(async () => {
    await result.current.save.mutateAsync(saveRequest);
  });
  expect(requestJson).toHaveBeenLastCalledWith("/api/receptions/batch%2F1/registration", {
    method: "PUT",
    body: JSON.stringify(saveRequest),
  });
  expect(client.getQueryState(queryKeys.receptions(params))?.isInvalidated).toBe(true);
  expect(client.getQueryState(queryKeys.receptionRegistration("batch/1"))?.isInvalidated).toBe(true);
  expect(client.getQueryState(queryKeys.receptionRegistration("other-batch"))?.isInvalidated).toBe(false);
  expect(client.getQueryState(queryKeys.receptionFilterOptions("pi", {}))?.isInvalidated).toBe(false);
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
    registrationVersions: { "batch-1": null },
  });
  vi.mocked(requestDownload).mockRejectedValueOnce(new Error("数据已变化")).mockResolvedValueOnce("接收.xlsx");
  client.setQueryData(queryKeys.auditEvents({}), { items: [] });
  const { result } = renderHook(() => ({ preview: usePreviewReceptions(), export: useExportReceptions() }), {
    wrapper,
  });
  const controller = new AbortController();
  await act(async () => {
    const summary = await result.current.preview.mutateAsync({ ...request, signal: controller.signal });
    expect(summary).not.toHaveProperty("rows");
    expect(summary.registrationVersions).toEqual({ "batch-1": null });
  });
  expect(requestJson).toHaveBeenCalledWith("/api/receptions/preview", {
    method: "POST",
    body: JSON.stringify({ ...request, view: "summary" }),
    signal: controller.signal,
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
