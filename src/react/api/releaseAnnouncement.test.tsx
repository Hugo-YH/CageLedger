import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { useAcknowledgeReleaseAnnouncements, useReleaseAnnouncementHistory } from "./administration";
import { queryKeys } from "./queryKeys";

let client: QueryClient;
function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 15_000 } } });
});
afterEach(() => {
  cleanup();
  client.clear();
  vi.restoreAllMocks();
});

it("ignores a confirmation response after the account changes and queries are cleared", async () => {
  client.setQueryData(queryKeys.session, { user: { id: "old" } });
  let respond!: (response: Response) => void;
  const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(
    () =>
      new Promise<Response>((resolve) => {
        respond = resolve;
      }),
  );
  const { result } = renderHook(() => useAcknowledgeReleaseAnnouncements("old"), { wrapper });
  let pending!: Promise<unknown>;
  act(() => {
    pending = result.current.mutateAsync(["1.2.3"]);
  });
  await waitFor(() => expect(fetchSpy).toHaveBeenCalledOnce());
  act(() => {
    client.removeQueries({ predicate: (query) => query.queryKey[0] !== "session" });
    client.setQueryData(queryKeys.session, { user: { id: "new" } });
    client.setQueryData([...queryKeys.releaseAnnouncementHistory, "new"], { acknowledgedVersions: ["1.0.0"] });
    client.setQueryData(queryKeys.releaseAnnouncement("1.2.3"), { version: "1.2.3", acknowledged: false });
  });
  await act(async () => {
    respond(Response.json({ acknowledgedVersions: ["1.2.3"] }));
    await pending;
  });
  expect(client.getQueryData([...queryKeys.releaseAnnouncementHistory, "new"])).toEqual({
    acknowledgedVersions: ["1.0.0"],
  });
  expect(client.getQueryData([...queryKeys.releaseAnnouncementHistory, "old"])).toBeUndefined();
  expect(client.getQueryData(queryKeys.releaseAnnouncement("1.2.3"))).toEqual({
    version: "1.2.3",
    acknowledged: false,
  });
});

it("updates history and individual versions after confirmation for the same account", async () => {
  client.setQueryData(queryKeys.session, { user: { id: "same" } });
  vi.spyOn(globalThis, "fetch").mockResolvedValue(Response.json({ acknowledgedVersions: ["1.2.3", "1.2.4"] }));
  const { result } = renderHook(() => useAcknowledgeReleaseAnnouncements("same"), { wrapper });
  await act(async () => {
    await result.current.mutateAsync(["1.2.3", "1.2.4"]);
  });
  expect(client.getQueryData([...queryKeys.releaseAnnouncementHistory, "same"])).toEqual({
    acknowledgedVersions: ["1.2.3", "1.2.4"],
  });
  for (const version of ["1.2.3", "1.2.4"]) {
    expect(client.getQueryData(queryKeys.releaseAnnouncement(version))).toEqual({ version, acknowledged: true });
  }
});

it("reuses the gate's history request when the modal mounts", async () => {
  const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(Response.json({ acknowledgedVersions: [] }));
  const gate = renderHook(() => useReleaseAnnouncementHistory("same"), { wrapper });
  await waitFor(() => expect(gate.result.current.isSuccess).toBe(true));
  const modal = renderHook(() => useReleaseAnnouncementHistory("same"), { wrapper });
  await waitFor(() => expect(modal.result.current.isSuccess).toBe(true));
  expect(fetchSpy).toHaveBeenCalledOnce();
  expect(modal.result.current.data).toEqual({ acknowledgedVersions: [] });
});
