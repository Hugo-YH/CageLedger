import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { PublicScanView } from "./PublicScanView";

let client: QueryClient;
const fetchMock = vi.fn();

beforeEach(() => {
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  cleanup();
  client.clear();
  fetchMock.mockReset();
  vi.unstubAllGlobals();
});

function renderCard() {
  return render(
    <QueryClientProvider client={client}>
      <PublicScanView qrId="CARD-1" />
    </QueryClientProvider>,
  );
}

it.each([
  { status: 404, message: "该二维码没有匹配到笼卡记录", title: "未找到笼卡信息" },
  { status: 503, message: "服务繁忙，请稍后重试", title: "笼卡信息加载失败" },
])(
  "distinguishes HTTP $status without retrying or losing its existing explanation",
  async ({ status, message, title }) => {
    fetchMock.mockResolvedValue(Response.json({ error: message }, { status }));
    renderCard();
    expect(await screen.findByRole("heading", { name: title })).toBeVisible();
    expect(screen.getByText(message, { exact: true })).toBeVisible();
    expect(screen.getByText("CARD-1", { exact: true })).toBeVisible();
    expect(screen.getByRole("button", { name: "重试" })).toBeEnabled();
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/public/cage-card/CARD-1",
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  },
);

it("explains a network failure in Chinese without presenting it as a missing card", async () => {
  fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));
  renderCard();
  expect(await screen.findByRole("heading", { name: "笼卡信息加载失败" })).toBeVisible();
  expect(screen.getByText(/请检查网络连接后重试/)).toBeVisible();
  expect(screen.queryByRole("heading", { name: "未找到笼卡信息" })).not.toBeInTheDocument();
  expect(screen.queryByText("Failed to fetch")).not.toBeInTheDocument();
  expect(fetchMock).toHaveBeenCalledOnce();
});

it("updates only loading motion when the preference changes, keeping one request and the same region", () => {
  let reduced = true;
  const listeners = new Set<() => void>();
  vi.stubGlobal("matchMedia", (query: string) => ({
    get matches() {
      return query === "(prefers-reduced-motion: reduce)" && reduced;
    },
    addEventListener: (_event: string, listener: () => void) => {
      if (query === "(prefers-reduced-motion: reduce)") listeners.add(listener);
    },
    removeEventListener: (_event: string, listener: () => void) => listeners.delete(listener),
  }));
  fetchMock.mockReturnValue(new Promise<Response>(() => {}));
  const { container } = renderCard();
  const region = screen.getByRole("status", { name: "笼卡信息正在加载" });
  expect(container.querySelector(".ant-skeleton-active")).toBeNull();
  act(() => {
    reduced = false;
    listeners.forEach((listener) => listener());
  });
  expect(container.querySelector(".ant-skeleton-active")).not.toBeNull();
  expect(screen.getByRole("status", { name: "笼卡信息正在加载" })).toBe(region);
  expect(region).toHaveAttribute("aria-busy", "true");
  expect(fetchMock).toHaveBeenCalledOnce();
});
