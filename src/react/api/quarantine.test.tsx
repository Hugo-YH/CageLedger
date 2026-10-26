import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, expect, it, vi } from "vitest";

import { requestJson } from "./client";
import { useQuarantineQuery } from "./quarantine";

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
