import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, expect, it, vi } from "vitest";

import { requestJson } from "./client";
import {
  useQuarantineAttachmentWrite,
  useQuarantineOverview,
  useQuarantineQuery,
  useQuarantineRecordSave,
  useQuarantineTestDetail,
} from "./quarantine";
import type { QuarantineAttachment, QuarantineTest } from "../../contracts/quarantine";

vi.mock("./client", () => ({ requestJson: vi.fn(), requestDownload: vi.fn(), requestMultipart: vi.fn() }));

afterEach(() => vi.resetAllMocks());

it("retains the previous worklist only for the same endpoint and method", async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  vi.mocked(requestJson)
    .mockResolvedValueOnce({ items: ["first"] })
    .mockImplementation(() => new Promise(() => {}));
  function wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  }
  const { result, rerender, unmount } = renderHook(
    ({ path }) => useQuarantineQuery<{ items: string[] }>(path, true, true),
    { wrapper, initialProps: { path: "records?method=pcr&offset=0" } },
  );
  await waitFor(() => expect(result.current.data?.items).toEqual(["first"]));
  rerender({ path: "records?method=pcr&offset=30" });
  expect(result.current.isPlaceholderData).toBe(true);
  expect(result.current.data?.items).toEqual(["first"]);
  rerender({ path: "records?method=parasite&offset=0" });
  expect(result.current.data).toBeUndefined();
  rerender({ path: "reports?method=pcr&offset=0" });
  expect(result.current.data).toBeUndefined();
  unmount();
  client.clear();
});

function testItem(version = "version-1"): QuarantineTest {
  return {
    id: "test-1",
    batchId: "batch-1",
    method: "parasite",
    samplingDate: "",
    testDate: "",
    conclusion: "",
    notes: "",
    samples: [],
    projects: [],
    state: "draft",
    updatedAt: version,
    retestOf: "",
    correctionOf: "",
  };
}

it("reads a batch overview without loading a detection until it is selected, and cancels an abandoned detection", async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  let signal: AbortSignal | null | undefined;
  vi.mocked(requestJson).mockImplementation((url, init) => {
    if (url === "/api/quarantine/batches/batch-1?view=overview")
      return Promise.resolve({ tests: [{ id: "test-1" }], reports: [] });
    signal = init?.signal;
    return new Promise(() => {});
  });
  function wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  }
  const { result, rerender, unmount } = renderHook(
    ({ selected }) => ({
      overview: useQuarantineOverview("batch-1"),
      record: useQuarantineTestDetail(selected),
    }),
    { wrapper, initialProps: { selected: "" } },
  );
  await waitFor(() => expect(result.current.overview.isSuccess).toBe(true));
  expect(requestJson).toHaveBeenCalledTimes(1);
  rerender({ selected: "test-1" });
  await waitFor(() => expect(requestJson).toHaveBeenCalledTimes(2));
  expect(signal?.aborted).toBe(false);
  rerender({ selected: "" });
  await waitFor(() => expect(signal?.aborted).toBe(true));
  unmount();
  client.clear();
});

it.each([false, true])(
  "settles an attachment chain once, keeping unrelated data and catalog fresh (failure=%s)",
  async (failAttachment) => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
    let current = testItem();
    const attachment: QuarantineAttachment = {
      id: "attachment-1",
      testId: current.id,
      name: "original.png",
      sampleId: "",
      projectId: "",
      category: "原始记录",
      mime: "image/png",
      uploadedBy: { id: "admin", name: "Admin" },
      updatedAt: "attachment-version",
    };
    const calls: string[] = [];
    vi.mocked(requestJson).mockImplementation((url, init) => {
      calls.push(`${init?.method ?? "GET"} ${url}`);
      if (url === "/api/quarantine/tests/test-1" && init?.method === "PUT") {
        current = testItem("version-2");
        return Promise.resolve({ item: current });
      }
      if (url === "/api/quarantine/attachments/attachment-1" && init?.method === "PUT") {
        if (failAttachment) return Promise.reject(new Error("Attachment rejected"));
        current = testItem("version-3");
        return Promise.resolve({ item: attachment, test: current });
      }
      if (url === "/api/quarantine/tests/test-1")
        return Promise.resolve({ item: current, attachments: [], reports: [] });
      return Promise.resolve({ items: [] });
    });
    function wrapper({ children }: { children: ReactNode }) {
      return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
    }
    const { result, unmount } = renderHook(
      () => ({
        record: useQuarantineTestDetail("test-1"),
        overview: useQuarantineOverview("batch-1"),
        unrelated: useQuarantineOverview("batch-2"),
        catalog: useQuarantineQuery("catalog"),
        sources: useQuarantineQuery("sources?view=summary"),
        records: useQuarantineQuery("records?offset=0"),
        history: useQuarantineQuery("suppliers/summary?offset=0"),
        save: useQuarantineRecordSave(),
        attach: useQuarantineAttachmentWrite(),
      }),
      { wrapper },
    );
    await waitFor(() => expect(Object.values(result.current).filter((value) => value.isSuccess)).toHaveLength(7));
    calls.length = 0;
    await act(async () => {
      await result.current.save.mutateAsync({
        item: { ...current, notes: "Saved before attachment" },
        version: "version-1",
        deferRefresh: true,
      });
    });
    expect(calls).toEqual(["PUT /api/quarantine/tests/test-1"]);
    await waitFor(() => expect(result.current.record.data?.item.updatedAt).toBe("version-2"));
    await act(async () => {
      const operation = result.current.attach.mutateAsync({
        path: "attachments/attachment-1",
        batchId: "batch-1",
        testId: "test-1",
        body: { expectedUpdatedAt: "version-2", item: attachment },
      });
      if (failAttachment) await expect(operation).rejects.toThrow("Attachment rejected");
      else await operation;
    });
    expect(calls.filter((value) => value === "GET /api/quarantine/batches/batch-1?view=overview")).toHaveLength(1);
    expect(calls.filter((value) => value === "GET /api/quarantine/records?offset=0")).toHaveLength(1);
    expect(calls.filter((value) => value === "GET /api/quarantine/suppliers/summary?offset=0")).toHaveLength(1);
    expect(calls.filter((value) => value === "GET /api/quarantine/tests/test-1")).toHaveLength(failAttachment ? 1 : 0);
    expect(calls.some((value) => /catalog|sources|batch-2/.test(value))).toBe(false);
    await waitFor(() =>
      expect(result.current.record.data?.item.updatedAt).toBe(failAttachment ? "version-2" : "version-3"),
    );
    if (!failAttachment) expect(result.current.record.data?.attachments).toEqual([attachment]);
    unmount();
    client.clear();
  },
);
