import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { afterEach, expect, it, vi } from "vitest";

import type { Researcher, ResearcherEditable } from "../../contracts/researchers";
import { queryKeys } from "./queryKeys";
import {
  resolveResearcherContacts,
  usePreviewResearcherImport,
  useResearchers,
  useResearcher,
  useImportResearchers,
  useSaveResearcher,
} from "./researchers";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function setup() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity }, mutations: { retry: false } },
  });
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

it("forwards the print preparation cancellation signal without changing contact lookup data", async () => {
  const controller = new AbortController();
  const fetch = vi.fn().mockResolvedValue(Response.json({ items: [] }));
  vi.stubGlobal("fetch", fetch);
  await resolveResearcherContacts(["张三"], controller.signal);
  expect(fetch.mock.calls[0][1].signal).toBe(controller.signal);
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
  expect(invalidate).toHaveBeenCalledWith(
    { queryKey: ["researchers"], predicate: expect.any(Function) },
    { throwOnError: false },
  );
  expect(client.getQueryData(queryKeys.researcher("r/1"))).toEqual(response);
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

const person: Researcher = {
  id: "person",
  account: "person-account",
  name: "张三",
  alias: "",
  department: "动物中心",
  position: "研究员",
  gender: "",
  mobile: "old-phone",
  telephone: "",
  email: "",
  enterpriseEmail: "",
  englishName: "",
  sourceDisabled: false,
  activationStatus: "active",
  createdAt: "created",
  updatedAt: "old-version",
};
const params = { limit: 20, offset: 0 };

function deferred<T>() {
  let resolve: (value: T) => void = () => {};
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

it("updates the complete edited detail from PUT and refreshes active lists once without another detail GET", async () => {
  const { client, wrapper } = setup();
  const saved = { ...person, mobile: "saved-phone", updatedAt: "new-version" };
  let current = person;
  const fetch = vi.fn().mockImplementation((input: string, init?: RequestInit) => {
    if (init?.method === "PUT") {
      current = saved;
      return Promise.resolve(Response.json({ item: saved }));
    }
    return Promise.resolve(
      Response.json(
        input.includes("?")
          ? { items: [current], departments: [current.department], page: { total: 1, limit: 20, offset: 0 } }
          : { item: current },
      ),
    );
  });
  vi.stubGlobal("fetch", fetch);
  client.setQueryData(queryKeys.researchers({ ...params, offset: 20 }), {
    items: [],
    departments: [],
    page: { total: 1, limit: 20, offset: 20 },
  });
  client.setQueryData(queryKeys.researcher("untouched"), { item: { ...person, id: "untouched" } });
  const { result, unmount } = renderHook(
    () => ({ list: useResearchers(params), detail: useResearcher(person.id), save: useSaveResearcher() }),
    { wrapper },
  );
  await waitFor(() => expect(result.current.list.data?.items[0].mobile).toBe(person.mobile));
  await waitFor(() => expect(result.current.detail.data?.item.mobile).toBe(person.mobile));
  await act(async () => {
    await result.current.save.mutateAsync({
      id: person.id,
      item: { ...person, mobile: saved.mobile },
      expectedUpdatedAt: person.updatedAt,
    });
  });
  await waitFor(() => expect(result.current.detail.data?.item).toEqual(saved));
  expect(fetch.mock.calls.filter(([url, init]) => url === "/api/researchers/person" && !init?.method)).toHaveLength(1);
  expect(fetch.mock.calls.filter(([url]) => url.includes("?"))).toHaveLength(2);
  expect(result.current.list.data?.items[0]).toEqual(saved);
  expect(client.getQueryState(queryKeys.researchers({ ...params, offset: 20 }))?.isInvalidated).toBe(true);
  expect(client.getQueryState(queryKeys.researcher("untouched"))?.isInvalidated).toBe(false);
  unmount();
  client.clear();
});

it("cancels a held old detail request before publishing the complete PUT result", async () => {
  const { client, wrapper } = setup();
  const pending = deferred<Response>();
  const saved = { ...person, mobile: "saved-phone", updatedAt: "new-version" };
  let readSignal: AbortSignal | undefined;
  const fetch = vi.fn().mockImplementation((_input: string, init?: RequestInit) => {
    if (init?.method === "PUT") return Promise.resolve(Response.json({ item: saved }));
    readSignal = init?.signal || undefined;
    return pending.promise;
  });
  vi.stubGlobal("fetch", fetch);
  const { result, unmount } = renderHook(() => ({ detail: useResearcher(person.id), save: useSaveResearcher() }), {
    wrapper,
  });
  await waitFor(() => expect(fetch).toHaveBeenCalledOnce());
  await act(async () => {
    await result.current.save.mutateAsync({ id: person.id, item: person, expectedUpdatedAt: person.updatedAt });
  });
  expect(readSignal?.aborted).toBe(true);
  await waitFor(() => expect(result.current.detail.data?.item).toEqual(saved));
  await act(async () => {
    pending.resolve(Response.json({ item: person }));
    await pending.promise;
  });
  expect(client.getQueryData(queryKeys.researcher(person.id))).toEqual({ item: saved });
  expect(fetch).toHaveBeenCalledTimes(2);
  unmount();
  client.clear();
});

it.each(["other-admin", "same-admin"])(
  "does not repopulate or invalidate caches after signing in as %s during a pending save",
  async (nextAccount) => {
    const { client, wrapper } = setup();
    client.setQueryData(queryKeys.session, { user: { id: "same-admin", role: "admin" } });
    const pending = deferred<Response>();
    const fetch = vi.fn().mockReturnValue(pending.promise);
    vi.stubGlobal("fetch", fetch);
    const invalidate = vi.spyOn(client, "invalidateQueries");
    const { result, unmount } = renderHook(useSaveResearcher, { wrapper });
    let writing: Promise<unknown> = Promise.resolve();
    act(() => {
      writing = result.current.mutateAsync({ id: person.id, item: person, expectedUpdatedAt: person.updatedAt });
    });
    await waitFor(() => expect(fetch).toHaveBeenCalledOnce());
    // The real logout/login removes business entries and replaces the session actor.
    client.setQueryData(queryKeys.session, { user: null });
    client.removeQueries({ predicate: (query) => query.queryKey[0] !== "session" });
    client.setQueryData(queryKeys.session, { user: { id: nextAccount, role: "admin" } });
    const nextData = { item: { ...person, mobile: "new-account-cache" } };
    client.setQueryData(queryKeys.researcher(person.id), nextData);
    await act(async () => {
      pending.resolve(Response.json({ item: { ...person, mobile: "old-account-result" } }));
      await writing;
    });
    expect(client.getQueryData(queryKeys.researcher(person.id))).toEqual(nextData);
    expect(invalidate).not.toHaveBeenCalled();
    unmount();
    client.clear();
  },
);

it("keeps a 409 as a single failed PUT without replacing the cached detail", async () => {
  const { client, wrapper } = setup();
  const cached = { item: person };
  client.setQueryData(queryKeys.researcher(person.id), cached);
  const fetch = vi.fn().mockResolvedValue(Response.json({ error: "资料版本已更新" }, { status: 409 }));
  vi.stubGlobal("fetch", fetch);
  const invalidate = vi.spyOn(client, "invalidateQueries");
  const { result, unmount } = renderHook(useSaveResearcher, { wrapper });
  await act(async () => {
    await expect(
      result.current.mutateAsync({ id: person.id, item: person, expectedUpdatedAt: person.updatedAt }),
    ).rejects.toMatchObject({ status: 409 });
  });
  expect(fetch).toHaveBeenCalledOnce();
  expect(client.getQueryData(queryKeys.researcher(person.id))).toEqual(cached);
  expect(invalidate).not.toHaveBeenCalled();
  unmount();
  client.clear();
});

it("keeps the broader import invalidation for pre-existing detail and list caches", async () => {
  const { client, wrapper } = setup();
  client.setQueryData(queryKeys.researcher(person.id), { item: person });
  client.setQueryData(queryKeys.researchers(params), { items: [person] });
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(Response.json({ counts: { created: 0, updated: 1, unchanged: 0, invalid: 0 } })),
  );
  const { result, unmount } = renderHook(useImportResearchers, { wrapper });
  await act(async () => {
    await result.current.mutateAsync({
      filename: "people.xlsx",
      data: "eGxzeA==",
      confirmationToken: "token",
      requestId: "stable-import-request",
    });
  });
  expect(client.getQueryState(queryKeys.researcher(person.id))?.isInvalidated).toBe(true);
  expect(client.getQueryState(queryKeys.researchers(params))?.isInvalidated).toBe(true);
  unmount();
  client.clear();
});
