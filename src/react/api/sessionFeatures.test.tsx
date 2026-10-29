import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { useLogin, useSession } from "./session";
import { queryKeys } from "./queryKeys";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

it("requests combined features and clears a prior account cache on login", async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(queryKeys.session, { user: { id: "old" } });
  client.setQueryData(queryKeys.systemFeatures, { enabled: { cages: false } });
  const fetchSpy = vi
    .spyOn(globalThis, "fetch")
    .mockResolvedValue(Response.json({ user: { id: "new" }, features: { enabled: { cages: true }, updatedAt: null } }));
  function wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  }
  const { result } = renderHook(useLogin, { wrapper });
  await act(async () => {
    await result.current.mutateAsync({ username: "new", password: "pw" });
  });
  expect(fetchSpy).toHaveBeenCalledWith(
    "/api/auth/login",
    expect.objectContaining({ body: JSON.stringify({ username: "new", password: "pw", includeFeatures: true }) }),
  );
  expect(client.getQueryData(queryKeys.systemFeatures)).toBeUndefined();
  expect(client.getQueryData<{ user: { id: string } }>(queryKeys.session)?.user.id).toBe("new");
  client.clear();
});

it("clears previous account configuration when a session refresh changes identity", async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 0 } } });
  client.setQueryData(queryKeys.session, { user: { id: "old" } });
  client.setQueryData(queryKeys.systemFeatures, { enabled: { cages: false } });
  const fetchSpy = vi
    .spyOn(globalThis, "fetch")
    .mockResolvedValue(Response.json({ user: { id: "new" }, features: { enabled: { cages: true }, updatedAt: null } }));
  function wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  }
  const { result } = renderHook(useSession, { wrapper });
  await waitFor(() => expect(result.current.data?.user?.id).toBe("new"));
  expect(fetchSpy.mock.calls[0][0]).toBe("/api/auth/me?include=features");
  expect(client.getQueryData(queryKeys.systemFeatures)).toBeUndefined();
  client.clear();
});
