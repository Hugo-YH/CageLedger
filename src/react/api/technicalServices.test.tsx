import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, expect, it, vi } from "vitest";

import type { TechnicalServiceListItem } from "../../contracts/technicalServices";
import { requestJson } from "./client";
import { useServiceList, useServiceMutation } from "./technicalServices";

vi.mock("./client", () => ({ requestJson: vi.fn(), requestDownload: vi.fn(), requestMultipart: vi.fn() }));
afterEach(() => vi.resetAllMocks());

it("requests the summary view and deletes using the version seen in the list", async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const item: TechnicalServiceListItem = {
    id: "sheet",
    month: "2026-10",
    iacuc: "Z1",
    pi: "负责人",
    facility: "zhujiang",
    serviceId: "service",
    serviceName: "服务",
    customerType: "internal",
    unit: "次",
    unitPrice: 10,
    totalAmount: 10,
    totalQuantity: 1,
    serviceDayCount: 1,
    protected: false,
    updatedAt: "list-version",
  };
  vi.mocked(requestJson)
    .mockResolvedValueOnce({ items: [item], page: { total: 1, limit: 10, offset: 0, hasMore: false } })
    .mockResolvedValue({});
  function wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  }
  const list = renderHook(() => useServiceList({ limit: 10, offset: 0 }), { wrapper });
  await waitFor(() => expect(list.result.current.data?.items).toEqual([item]));
  expect(String(vi.mocked(requestJson).mock.calls[0][0])).toContain("view=summary");
  const mutation = renderHook(useServiceMutation, { wrapper });
  await act(async () => {
    await mutation.result.current.mutateAsync({ kind: "delete", sheet: item });
  });
  expect(requestJson).toHaveBeenCalledWith("/api/technical-services/sheets/sheet", {
    method: "DELETE",
    body: JSON.stringify({ sheet: item, expectedUpdatedAt: "list-version" }),
  });
  list.unmount();
  mutation.unmount();
  client.clear();
});
