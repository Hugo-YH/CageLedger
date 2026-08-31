import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  useAuditEvents,
  useIacucStatus,
  usePrincipalIdentities,
  useSystemEnvironment,
  useSystemInfo,
  useSystemPerformanceHistory,
  useSystemUpdate,
  useUsers,
} from "./administration";
import {
  useAnimalFindings,
  useAnimalInspection,
  useAnimalInspectionCatalog,
  useAnimalInspectionCatalogDraft,
  useAnimalInspectionCatalogVersions,
  useAnimalInspections,
} from "./animalManagement";
import { useSettlementCandidates } from "./billing";
import { useBootstrap } from "./bootstrap";
import { usePublicCageCard } from "./cageCard";
import { useDashboardOverview } from "./dashboardOverview";
import { useColumnFilterOptions } from "./filterOptions";
import { useIacucExpiry, useIacucSearch } from "./iacuc";
import { useIntakeBatches } from "./intake";
import { queryClient as applicationQueryClient } from "./queryClient";
import {
  useQuantitySheetDetail,
  useQuantitySheetPiHistory,
  useQuantitySheetRooms,
  useQuantitySheets,
} from "./quantitySheets";
import {
  useLegacyReimbursements,
  useReimbursementClaim,
  useReimbursementClaims,
  useSettlementObligations,
} from "./reimbursementLedger";
import { useSession } from "./session";
import { useBillingWorkflows, useReimbursement, useReimbursements, useWorkflowFundingBookOptions } from "./workflows";

const params = { limit: 20, offset: 0 };
const queries = [
  { name: "session", useReadQuery: useSession },
  { name: "public cage card", useReadQuery: () => usePublicCageCard("QR001") },
  { name: "bootstrap", useReadQuery: () => useBootstrap("summary") },
  { name: "dashboard", useReadQuery: useDashboardOverview },
  { name: "intake", useReadQuery: () => useIntakeBatches(params) },
  { name: "quantity sheets", useReadQuery: () => useQuantitySheets(params) },
  { name: "quantity sheet detail", useReadQuery: () => useQuantitySheetDetail("sheet") },
  { name: "quantity rooms", useReadQuery: useQuantitySheetRooms },
  { name: "PI history", useReadQuery: () => useQuantitySheetPiHistory("Z2026001", "2026-08", true) },
  { name: "settlements", useReadQuery: () => useSettlementCandidates(params) },
  { name: "filter options", useReadQuery: () => useColumnFilterOptions("intake-batches", "pi", undefined, true) },
  { name: "IACUC expiry", useReadQuery: useIacucExpiry },
  { name: "IACUC search", useReadQuery: () => useIacucSearch("Z2026001") },
  { name: "users", useReadQuery: useUsers },
  { name: "principal identities", useReadQuery: usePrincipalIdentities },
  { name: "IACUC status", useReadQuery: useIacucStatus },
  { name: "audit events", useReadQuery: () => useAuditEvents(20, 0) },
  { name: "system info", useReadQuery: useSystemInfo },
  { name: "system environment", useReadQuery: () => useSystemEnvironment(true) },
  { name: "performance history", useReadQuery: () => useSystemPerformanceHistory(24, true) },
  { name: "update", useReadQuery: () => useSystemUpdate(true) },
  { name: "catalog", useReadQuery: useAnimalInspectionCatalog },
  { name: "catalog draft", useReadQuery: () => useAnimalInspectionCatalogDraft(true) },
  { name: "catalog versions", useReadQuery: () => useAnimalInspectionCatalogVersions(true) },
  { name: "inspections", useReadQuery: () => useAnimalInspections(params) },
  { name: "inspection detail", useReadQuery: () => useAnimalInspection("inspection") },
  { name: "findings", useReadQuery: () => useAnimalFindings(params) },
  { name: "obligations", useReadQuery: () => useSettlementObligations(params) },
  { name: "claims", useReadQuery: () => useReimbursementClaims(params) },
  { name: "claim detail", useReadQuery: () => useReimbursementClaim("claim") },
  { name: "legacy ledger", useReadQuery: () => useLegacyReimbursements(params) },
  { name: "reimbursements", useReadQuery: () => useReimbursements(params) },
  { name: "reimbursement detail", useReadQuery: () => useReimbursement("record") },
  { name: "workflows", useReadQuery: () => useBillingWorkflows(params) },
  { name: "funding options", useReadQuery: () => useWorkflowFundingBookOptions("workflow") },
];

const clients: QueryClient[] = [];
function setup() {
  const client = new QueryClient({ defaultOptions: applicationQueryClient.getDefaultOptions() });
  clients.push(client);
  function wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  }
  return { client, wrapper };
}

function mockPendingFetch() {
  const requests: Array<{ signal: AbortSignal; resolve: (value: Response) => void }> = [];
  vi.spyOn(globalThis, "fetch").mockImplementation(
    (_url, init) =>
      new Promise<Response>((resolve, reject) => {
        const signal = init?.signal;
        if (!signal) throw new Error("Missing AbortSignal");
        signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
        requests.push({ signal, resolve });
      }),
  );
  return requests;
}

afterEach(() => {
  cleanup();
  clients.splice(0).forEach((client) => client.clear());
  vi.restoreAllMocks();
});

describe("read query cancellation", () => {
  it.each(queries)("aborts $name when its last observer leaves", ({ useReadQuery }) => {
    const requests = mockPendingFetch();
    const { wrapper } = setup();
    const { unmount } = renderHook(
      () => {
        useReadQuery();
      },
      { wrapper },
    );
    expect(requests).toHaveLength(1);
    expect(requests[0].signal.aborted).toBe(false);
    unmount();
    expect(requests[0].signal.aborted).toBe(true);
  });

  it("shares an identical request and cancels only after both consumers leave", () => {
    const requests = mockPendingFetch();
    const { wrapper } = setup();
    const first = renderHook(() => useIntakeBatches({ ...params }), { wrapper });
    const second = renderHook(() => useIntakeBatches({ ...params }), { wrapper });
    expect(requests).toHaveLength(1);
    first.unmount();
    expect(requests[0].signal.aborted).toBe(false);
    second.unmount();
    expect(requests[0].signal.aborted).toBe(true);
  });

  it("cancels the old filter request and keeps previous data only as a placeholder", async () => {
    const requests = mockPendingFetch();
    const { wrapper } = setup();
    const hook = renderHook(({ offset }) => useIntakeBatches({ ...params, offset }), {
      initialProps: { offset: 0 },
      wrapper,
    });
    await act(async () => {
      requests[0].resolve(Response.json({ items: [{ id: "first" }], page: { total: 40 } }));
      await Promise.resolve();
    });
    await waitFor(() => expect(hook.result.current.isSuccess).toBe(true));
    hook.rerender({ offset: 20 });
    expect(hook.result.current.isPlaceholderData).toBe(true);
    expect(hook.result.current.data?.items[0].id).toBe("first");
    hook.rerender({ offset: 40 });
    expect(requests[1].signal.aborted).toBe(true);
    expect(requests[2].signal.aborted).toBe(false);
    await act(async () => {
      requests[2].resolve(Response.json({ items: [{ id: "latest" }], page: { total: 60 } }));
      await Promise.resolve();
    });
    await waitFor(() => expect(hook.result.current.data?.items[0].id).toBe("latest"));
    expect(hook.result.current.isPlaceholderData).toBe(false);
  });

  it("does not request hidden intake lists or privileged system history", () => {
    const fetch = vi.spyOn(globalThis, "fetch");
    const { wrapper } = setup();
    renderHook(
      () => {
        useIntakeBatches(params, false);
        useSystemEnvironment(false);
        useSystemPerformanceHistory(24, false);
      },
      { wrapper },
    );
    expect(fetch).not.toHaveBeenCalled();
  });
});
