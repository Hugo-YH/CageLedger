import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, expect, it, vi } from "vitest";
import {
  useAnimalFindings,
  useAnimalInspection,
  useAnimalInspections,
  useAnimalInspectionCatalogSummary,
  usePublishInspectionCatalogDraft,
  useRestoreInspectionCatalogVersion,
  useAnimalInspectionEdit,
  useAnimalInspectionDisplay,
} from "./animalManagement";
import type { InspectionCatalogResponse, InspectionCatalogSummary } from "../../contracts/animalManagement";
import { queryKeys } from "./queryKeys";

afterEach(() => vi.restoreAllMocks());

it("requests list summaries and loads detail only for the selected inspection", async () => {
  const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
    new Response(JSON.stringify({ items: [], page: { offset: 0, limit: 20, total: 0 } }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }),
  );
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  function wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  }
  const params = { limit: 20, offset: 0 };
  const list = renderHook(() => useAnimalInspections(params), { wrapper });
  const findings = renderHook(() => useAnimalFindings(params), { wrapper });
  await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(2));
  expect(fetchSpy.mock.calls.map(([url]) => String(url))).toEqual(
    expect.arrayContaining([
      "/api/animal-inspections?limit=20&offset=0&view=summary",
      "/api/animal-inspection-findings?limit=20&offset=0&view=summary",
    ]),
  );
  const detail = renderHook(() => useAnimalInspection("selected"), { wrapper });
  await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(3));
  expect(String(fetchSpy.mock.calls[2][0])).toBe("/api/animal-inspections/selected");
  list.unmount();
  findings.unmount();
  detail.unmount();
  client.clear();
});

const fullCatalog: InspectionCatalogResponse = {
  version: { version: "v1", status: "active", source: "test", imported_at: "2026-11-06" },
  modules: [],
  nodes: [],
  reviewNotice: "review",
};
function projectCatalog(full: InspectionCatalogResponse): InspectionCatalogSummary {
  return {
    version: full.version,
    modules: full.modules,
    reviewNotice: full.reviewNotice,
    moduleItemCounts: { basicAssessment: full.nodes.length, advancedAssessment: 0, abnormalAnimalAssessment: 0 },
  };
}
function setupClient() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  function wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  }
  return { client, wrapper };
}
function jsonResponse(value: unknown) {
  return new Response(JSON.stringify(value), { headers: { "Content-Type": "application/json" } });
}

it("reuses a fresh full catalog for standards without extending its freshness", async () => {
  const { client, wrapper } = setupClient();
  const updatedAt = Date.now() - 60_000;
  client.setQueryData(queryKeys.animalInspectionCatalog, fullCatalog, { updatedAt });
  const fetchSpy = vi.spyOn(globalThis, "fetch");
  const hook = renderHook(() => useAnimalInspectionCatalogSummary(projectCatalog), { wrapper });
  await waitFor(() => expect(hook.result.current.isSuccess).toBe(true));
  expect(hook.result.current.data).toEqual(projectCatalog(fullCatalog));
  expect(client.getQueryState(queryKeys.animalInspectionCatalogSummary)?.dataUpdatedAt).toBe(updatedAt);
  expect(fetchSpy).not.toHaveBeenCalled();
  hook.unmount();
  client.clear();
});

it.each(["publish", "restore"] as const)(
  "%s replaces an in-flight old standards summary with the new full catalog",
  async (operation) => {
    const { client, wrapper } = setupClient();
    let finish!: (response: Response) => void;
    let oldSignal: AbortSignal | null | undefined;
    const published = { ...fullCatalog, version: { ...fullCatalog.version, version: "v2" } };
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation((input, init) => {
      if (String(input).endsWith("?view=summary")) {
        oldSignal = init?.signal;
        return new Promise((resolve) => {
          finish = resolve;
        });
      }
      return Promise.resolve(jsonResponse(published));
    });
    const hook = renderHook(
      () => ({
        summary: useAnimalInspectionCatalogSummary(projectCatalog),
        publish: usePublishInspectionCatalogDraft(),
        restore: useRestoreInspectionCatalogVersion(),
      }),
      { wrapper },
    );
    await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(1));
    await act(async () => {
      if (operation === "publish") await hook.result.current.publish.mutateAsync();
      else await hook.result.current.restore.mutateAsync("v2");
    });
    expect(oldSignal?.aborted).toBe(true);
    await waitFor(() => expect(hook.result.current.summary.data?.version.version).toBe("v2"));
    await act(async () => {
      finish(jsonResponse(projectCatalog(fullCatalog)));
      await Promise.resolve();
    });
    expect(hook.result.current.summary.data?.version.version).toBe("v2");
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    hook.unmount();
    client.clear();
  },
);

it("uses independent cancellable edit and display projections while keeping the full detail API compatible", async () => {
  const { client, wrapper } = setupClient();
  const fetchSpy = vi
    .spyOn(globalThis, "fetch")
    .mockImplementation(() => Promise.resolve(jsonResponse({ item: {}, answers: [] })));
  const hook = renderHook(
    () => ({ edit: useAnimalInspectionEdit("selected"), display: useAnimalInspectionDisplay("selected") }),
    { wrapper },
  );
  await waitFor(() => expect(hook.result.current.edit.isSuccess && hook.result.current.display.isSuccess).toBe(true));
  expect(fetchSpy.mock.calls.map(([path]) => path)).toEqual(
    expect.arrayContaining([
      "/api/animal-inspections/selected?view=edit",
      "/api/animal-inspections/selected?view=display",
    ]),
  );
  expect(fetchSpy.mock.calls.every(([, init]) => init?.signal instanceof AbortSignal)).toBe(true);
  hook.unmount();
  client.clear();
});
