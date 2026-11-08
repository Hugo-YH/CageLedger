import { QueryClient, QueryClientProvider, QueryObserver, type QueryKey } from "@tanstack/react-query";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, expect, it, vi } from "vitest";

import type { ReimbursementClaim } from "./contracts";
import type { TechnicalServiceSheet } from "../../contracts/technicalServices";
import { requestJson } from "./client";
import { mutationActor, publishMutationItem } from "./mutationCache";
import { queryKeys } from "./queryKeys";
import { useCreateReimbursementAllocation, useSaveReimbursementClaim } from "./reimbursementLedger";
import { useServiceMutation } from "./technicalServices";

vi.mock("./client", () => ({ requestJson: vi.fn(), requestDownload: vi.fn(), requestMultipart: vi.fn() }));

const clients: QueryClient[] = [];
const subscriptions: Array<() => void> = [];
afterEach(() => {
  cleanup();
  subscriptions.splice(0).forEach((unsubscribe) => unsubscribe());
  clients.splice(0).forEach((client) => client.clear());
  vi.resetAllMocks();
});

function setup() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity }, mutations: { retry: false } },
  });
  clients.push(client);
  client.setQueryData(queryKeys.session, { user: { id: "admin" } });
  return {
    client,
    wrapper: ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    ),
  };
}

function observe(client: QueryClient, key: QueryKey) {
  const response = { old: true };
  client.setQueryData(key, response);
  const read = vi.fn().mockResolvedValue(response);
  subscriptions.push(
    new QueryObserver(client, { queryKey: key, queryFn: read, staleTime: Infinity }).subscribe(() => {}),
  );
  return read;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

const sheet = {
  id: "sheet",
  month: "2026-11",
  iacuc: "IACUC-1",
  facility: "zhujiang",
  customerType: "internal",
  serviceId: "service",
  serviceName: "服务",
  unit: "次",
  unitPrice: 10,
  pi: "负责人",
  updatedAt: "saved-version",
  totalAmount: 10,
  totalQuantity: 1,
  serviceDayCount: 1,
  project: "项目",
  owner: "负责人",
  funding: "经费",
  manager: "管理员",
  notes: "",
  rows: [{ date: "2026-11-01", quantity: 1, amount: 10 }],
} satisfies TechnicalServiceSheet;

it("cancels an old detail read before publishing the complete write response", async () => {
  const { client } = setup();
  const pending = deferred<{ item: string }>();
  let signal: AbortSignal | undefined;
  const key = ["detail", "target"];
  const oldRead = client
    .fetchQuery({
      queryKey: key,
      queryFn: (context) => {
        signal = context.signal;
        return pending.promise;
      },
    })
    .catch(() => undefined);
  const saved = { item: "saved" };
  expect(await publishMutationItem(client, mutationActor(client), key, saved)).toBe(true);
  expect(signal?.aborted).toBe(true);
  pending.resolve({ item: "old" });
  await oldRead;
  expect(client.getQueryData(key)).toEqual(saved);
});

it.each(["another-admin", "admin"])("does not restore cleared caches after signing in as %s", async (id) => {
  const { client } = setup();
  const actor = mutationActor(client);
  client.removeQueries({ queryKey: queryKeys.session });
  client.setQueryData(queryKeys.session, { user: { id } });
  expect(await publishMutationItem(client, actor, ["detail"], { item: "saved" })).toBe(false);
  expect(client.getQueryData(["detail"])).toBeUndefined();
});

it("rechecks the account after awaiting cancellation", async () => {
  const { client } = setup();
  const actor = mutationActor(client);
  const cancelled = deferred<void>();
  vi.spyOn(client, "cancelQueries").mockReturnValueOnce(cancelled.promise);
  const publish = publishMutationItem(client, actor, ["detail"], { item: "saved" });
  client.setQueryData(queryKeys.session, { user: { id: "new-admin" } });
  cancelled.resolve();
  expect(await publish).toBe(false);
  expect(client.getQueryData(["detail"])).toBeUndefined();
});

it("publishes a saved service detail and refreshes lists without rereading details or the catalog", async () => {
  const { client, wrapper } = setup();
  const detail = observe(client, ["technical-services", "sheet-detail", sheet.id]);
  const otherDetail = observe(client, ["technical-services", "sheet-detail", "other"]);
  const catalog = observe(client, ["technical-services", "catalog"]);
  const list = observe(client, queryKeys.technicalServiceSheets({ limit: 20, offset: 0 }));
  const filters = observe(client, ["technical-services", "sheets-filter-options", {}, "pi"]);
  const candidates = observe(client, ["billing-settlement-candidates"]);
  const inactive = queryKeys.technicalServiceSheets({ limit: 20, offset: 20 });
  client.setQueryData(inactive, { items: [] });
  vi.mocked(requestJson).mockResolvedValueOnce({ item: sheet });
  const { result } = renderHook(useServiceMutation, { wrapper });
  await act(() => result.current.mutateAsync({ kind: "save", sheet, editing: true }));
  expect(client.getQueryData(["technical-services", "sheet-detail", sheet.id])).toEqual({ item: sheet });
  expect(detail).not.toHaveBeenCalled();
  expect(otherDetail).not.toHaveBeenCalled();
  expect(catalog).not.toHaveBeenCalled();
  expect(list).toHaveBeenCalledOnce();
  expect(filters).toHaveBeenCalledOnce();
  expect(candidates).toHaveBeenCalledOnce();
  expect(client.getQueryState(inactive)?.isInvalidated).toBe(true);
});

it("preserves a successful service save when a related active list cannot refresh", async () => {
  const { client, wrapper } = setup();
  const list = observe(client, queryKeys.technicalServiceSheets({ limit: 20, offset: 0 }));
  list.mockRejectedValue(new Error("read unavailable"));
  vi.mocked(requestJson).mockResolvedValueOnce({ item: sheet });
  const { result } = renderHook(useServiceMutation, { wrapper });
  await act(async () => {
    await expect(result.current.mutateAsync({ kind: "save", sheet, editing: true })).resolves.toEqual({ item: sheet });
  });
  expect(client.getQueryData(["technical-services", "sheet-detail", sheet.id])).toEqual({ item: sheet });
});

it("publishes a complete saved claim while refreshing ledger lists once", async () => {
  const { client, wrapper } = setup();
  const claim = { id: "claim", fundingLines: [] } as unknown as ReimbursementClaim;
  const detail = observe(client, queryKeys.reimbursementClaim(claim.id));
  const list = observe(client, queryKeys.reimbursementClaims({ limit: 20, offset: 0 }));
  const inactive = queryKeys.reimbursementObligations({ limit: 20, offset: 20 });
  client.setQueryData(inactive, { items: [] });
  vi.mocked(requestJson).mockResolvedValueOnce({ item: claim });
  const { result } = renderHook(useSaveReimbursementClaim, { wrapper });
  await act(() => result.current.mutateAsync({ id: claim.id, item: { ...claim, fundingLines: [] } }));
  expect(client.getQueryData(queryKeys.reimbursementClaim(claim.id))).toEqual({ item: claim });
  expect(detail).not.toHaveBeenCalled();
  expect(list).toHaveBeenCalledOnce();
  expect(client.getQueryState(inactive)?.isInvalidated).toBe(true);
});

it.each([false, true])("defers only the panel-owned claim refresh (%s)", async (deferredRefresh) => {
  const { client, wrapper } = setup();
  const target = queryKeys.reimbursementClaim("claim");
  const detail = observe(client, target);
  const other = observe(client, queryKeys.reimbursementClaim("other"));
  const list = observe(client, queryKeys.reimbursementClaims({ limit: 20, offset: 0 }));
  vi.mocked(requestJson).mockResolvedValueOnce({ item: { id: "allocation" } });
  const { result } = renderHook(() => useCreateReimbursementAllocation(deferredRefresh ? "claim" : ""), { wrapper });
  await act(() =>
    result.current.mutateAsync({ claimId: "claim", fundingLineId: "line", obligationId: "obligation", amount: 10 }),
  );
  await waitFor(() => expect(list).toHaveBeenCalledOnce());
  expect(other).toHaveBeenCalledOnce();
  if (deferredRefresh) {
    expect(detail).not.toHaveBeenCalled();
    expect(client.getQueryState(target)?.isInvalidated).toBe(true);
  } else expect(detail).toHaveBeenCalledOnce();
});

it.each(["service", "claim"])("ignores a late %s write after the account changes", async (kind) => {
  const { client, wrapper } = setup();
  const pending = deferred<unknown>();
  vi.mocked(requestJson).mockReturnValueOnce(pending.promise);
  const { result } = renderHook(() => ({ service: useServiceMutation(), claim: useSaveReimbursementClaim() }), {
    wrapper,
  });
  let write!: Promise<unknown>;
  act(() => {
    write =
      kind === "service"
        ? result.current.service.mutateAsync({ kind: "save", sheet, editing: true })
        : result.current.claim.mutateAsync({ id: "claim", item: { fundingLines: [] } });
  });
  await waitFor(() => expect(requestJson).toHaveBeenCalledOnce());
  client.clear();
  client.setQueryData(queryKeys.session, { user: { id: "next-admin" } });
  const nextList = observe(
    client,
    kind === "service" ? ["technical-services", "sheets"] : ["reimbursement-ledger", "claims"],
  );
  await act(async () => {
    pending.resolve({ item: kind === "service" ? sheet : { id: "claim", fundingLines: [] } });
    await write;
  });
  expect(nextList).not.toHaveBeenCalled();
  const key =
    kind === "service" ? ["technical-services", "sheet-detail", sheet.id] : queryKeys.reimbursementClaim("claim");
  expect(client.getQueryData(key)).toBeUndefined();
});
