import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { useAnimalFindings, useAnimalInspection, useAnimalInspections } from "./animalManagement";

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
