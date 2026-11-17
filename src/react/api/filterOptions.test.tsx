import { QueryClient, QueryClientProvider, type UseQueryResult } from "@tanstack/react-query";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, expect, it, vi } from "vitest";

import { requestJson } from "./client";
import { useColumnFilterOptions, type ColumnFilterOption } from "./filterOptions";
import { useReceptionFilterOptions } from "./reception";
import { useSettlementFilterOptions } from "./settlements";
import { useServiceFilterOptions } from "./technicalServices";
import { useFeedbackFilterOptions } from "./feedback";

vi.mock("./client", () => ({ requestJson: vi.fn(), requestDownload: vi.fn(), requestMultipart: vi.fn() }));
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

type Filters = Record<string, string[]>;
const cases: Array<{
  name: string;
  column: string;
  other: string;
  individual: boolean;
  useOptions: (filters: Filters) => UseQueryResult<{ items: ColumnFilterOption[] }>;
}> = [
  {
    name: "shared intake/quantity/workflow",
    column: "pi",
    other: "supplier",
    individual: true,
    useOptions: (filters) => useColumnFilterOptions("intake-batches", "pi", filters, true),
  },
  {
    name: "reception",
    column: "pi",
    other: "supplier",
    individual: false,
    useOptions: (filters) => useReceptionFilterOptions("pi", filters, true),
  },
  {
    name: "settlement",
    column: "pi",
    other: "month",
    individual: true,
    useOptions: (filters) => useSettlementFilterOptions({ limit: 10, offset: 0, columnFilters: filters }, "pi", true),
  },
  {
    name: "technical service sheets",
    column: "pi",
    other: "month",
    individual: true,
    useOptions: (filters) =>
      useServiceFilterOptions("sheets", { limit: 10, offset: 0, columnFilters: filters }, "pi", true),
  },
  {
    name: "technical service candidates",
    column: "pi",
    other: "month",
    individual: true,
    useOptions: (filters) =>
      useServiceFilterOptions("settlement-candidates", { limit: 10, offset: 0, columnFilters: filters }, "pi", true),
  },
  {
    name: "feedback",
    column: "module",
    other: "kind",
    individual: false,
    useOptions: (filters) => useFeedbackFilterOptions("module", filters, true),
  },
];

it.each(cases)(
  "keeps $name candidates stable across own-column changes but refreshes for other columns",
  async ({ useOptions, column, other, individual }) => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
    const options = {
      items: [
        { value: "alpha", label: "甲", count: 1 },
        { value: "beta", label: "乙", count: 1 },
      ],
    };
    vi.mocked(requestJson).mockResolvedValue(options);
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
    const initial = { [column]: ["alpha"], [other]: ["scope-a"] };
    const before = structuredClone(initial);
    const { result, rerender, unmount } = renderHook(({ filters }: { filters: Filters }) => useOptions(filters), {
      wrapper,
      initialProps: { filters: initial },
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    rerender({ filters: { [column]: ["alpha", "beta"], [other]: ["scope-a"] } });
    await act(async () => {
      await Promise.resolve();
    });
    expect(result.current.data).toBe(options);
    expect(result.current.isFetching).toBe(false);
    expect(requestJson).toHaveBeenCalledOnce();
    rerender({ filters: { [column]: [], [other]: ["scope-a"] } });
    await act(async () => {
      await Promise.resolve();
    });
    expect(requestJson).toHaveBeenCalledOnce();
    rerender({ filters: { [column]: ["beta"], [other]: ["scope-b"] } });
    await waitFor(() => expect(requestJson).toHaveBeenCalledTimes(2));
    const url = new URL(String(vi.mocked(requestJson).mock.calls[1][0]), "http://localhost");
    expect(JSON.parse(url.searchParams.get("columnFilters") || "{}")).toEqual({ [other]: ["scope-b"] });
    if (individual) expect(url.searchParams.get("personFilterMode")).toBe("individual");
    expect(initial).toEqual(before);
    unmount();
    client.clear();
  },
);
