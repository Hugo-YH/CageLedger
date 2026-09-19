import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PublicCageCardResponse } from "../../contracts/intake";
import { usePublicCageCard } from "./cageCard";

const response: PublicCageCardResponse = {
  item: {
    qrId: "AB12",
    batchNo: "扫码回归批次",
    cageCode: "C01",
    roomName: "8014",
    rackName: "01",
    slotCode: "A1",
    iacuc: "TEST-IACUC",
    project: "扫码回归项目",
    pi: "测试负责人",
    owner: "测试实验员",
    species: "mouse",
    speciesLabel: "小鼠",
    strainStandard: "C57BL/6J",
    animalCount: 0,
    sex: "male",
    birthDate: "",
    age: "",
    startDate: "2026-09-12",
    actualMoveInDate: "2026-09-12",
    endDate: "",
    statusLabel: "已入驻",
  },
};
let client: QueryClient;
const fetchMock = vi.fn();
function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
beforeEach(() => {
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  cleanup();
  client.clear();
  vi.unstubAllGlobals();
});

describe("public cage card response contract", () => {
  it("reads the real item envelope, retaining the returned state, details and zero count", async () => {
    fetchMock.mockResolvedValue(Response.json(response));
    const { result } = renderHook(() => usePublicCageCard("AB12"), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual(response.item);
    expect(result.current.data?.statusLabel).toBe("已入驻");
    expect(result.current.data?.iacuc).toBe("TEST-IACUC");
    expect(result.current.data?.animalCount).toBe(0);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/public/cage-card/AB12",
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  it.each([{}, { item: null }, { batch: {}, card: {} }, { item: {} }, response.item])(
    "rejects an incomplete response instead of showing a blank pending-receipt card: %j",
    async (payload) => {
      fetchMock.mockResolvedValue(Response.json(payload));
      const { result } = renderHook(() => usePublicCageCard("AB12"), { wrapper });
      await waitFor(() => expect(result.current.isError).toBe(true));
      expect(result.current.error?.message).toContain("笼卡信息响应不完整");
      expect(result.current.data).toBeUndefined();
    },
  );

  it("does not request a card until there is a decoded or entered code", () => {
    renderHook(() => usePublicCageCard(""), { wrapper });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
