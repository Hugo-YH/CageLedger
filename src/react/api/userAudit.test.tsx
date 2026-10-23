import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useDeleteUser, useSaveUser } from "./administration";
import { queryKeys } from "./queryKeys";

let client: QueryClient;
const logKey = queryKeys.auditEvents({ limit: 10, offset: 0 });
function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
beforeEach(() => {
  client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  client.setQueryData(queryKeys.users, { users: [] });
  client.setQueryData(logKey, { items: [] });
  client.setQueryData(queryKeys.workflowsRoot, { items: [] });
});
afterEach(() => {
  cleanup();
  client.clear();
  vi.restoreAllMocks();
});

it.each(["create", "update", "delete"])("refreshes the cached operation log after account %s", async (action) => {
  vi.spyOn(globalThis, "fetch").mockResolvedValue(Response.json({ user: { id: "target" }, ok: true }));
  const { result } = renderHook(() => ({ save: useSaveUser(), remove: useDeleteUser() }), { wrapper });
  await act(async () => {
    if (action === "delete") await result.current.remove.mutateAsync("target");
    else
      await result.current.save.mutateAsync({
        id: action === "update" ? "target" : undefined,
        user: { phone: "100" },
        expectedUpdatedAt: "version",
      });
  });
  expect(client.getQueryState(queryKeys.users)?.isInvalidated).toBe(true);
  expect(client.getQueryState(logKey)?.isInvalidated).toBe(true);
  expect(client.getQueryState(queryKeys.workflowsRoot)?.isInvalidated).toBe(false);
});

it("does not invalidate a log as if a rejected account update succeeded", async () => {
  vi.spyOn(globalThis, "fetch").mockResolvedValue(Response.json({ error: "账号已更新" }, { status: 409 }));
  const { result } = renderHook(useSaveUser, { wrapper });
  await act(async () => {
    await expect(
      result.current.mutateAsync({ id: "target", user: { phone: "100" }, expectedUpdatedAt: "old" }),
    ).rejects.toThrow("账号已更新");
  });
  expect(client.getQueryState(logKey)?.isInvalidated).toBe(false);
});
