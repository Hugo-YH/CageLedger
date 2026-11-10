import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { App } from "./App";
import { ApiError } from "./api/client";

const session = vi.hoisted(() => ({
  state: { isPending: false, error: null as Error | null, data: undefined },
}));
vi.mock("./api/session", () => ({ useSession: () => session.state }));
vi.mock("./features/auth/LoginView", () => ({ LoginView: () => <main>登录表单</main> }));

let client: QueryClient;
beforeEach(() => {
  window.history.replaceState(null, "", "/app");
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  session.state = { isPending: false, error: null, data: undefined };
});
afterEach(() => {
  cleanup();
  client.clear();
  vi.unstubAllGlobals();
  window.history.replaceState(null, "", "/");
});

function renderApp() {
  return render(
    <QueryClientProvider client={client}>
      <App />
    </QueryClientProvider>,
  );
}

it("keeps a reload recovery action and gives users an actionable service error", () => {
  session.state.error = new ApiError("服务暂不可用", 503, {});
  renderApp();
  expect(screen.getByRole("alert")).toHaveTextContent("无法连接 CageLedger 服务");
  expect(screen.getByRole("alert")).toHaveTextContent("请检查网络连接后重新加载");
  expect(screen.getByRole("alert")).not.toHaveTextContent("Python API");
  expect(screen.getByRole("button", { name: "重新加载" })).toBeEnabled();
});

it("still sends an unauthenticated session to login rather than the service error", async () => {
  session.state.error = new ApiError("请先登录", 401, {});
  renderApp();
  expect(await screen.findByText("登录表单", { exact: true })).toBeVisible();
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
});

it("keeps the initial loading screen while suppressing motion for reduced-motion users", () => {
  vi.stubGlobal("matchMedia", () => ({ matches: true, addEventListener() {}, removeEventListener() {} }));
  session.state.isPending = true;
  const { container } = renderApp();
  expect(screen.getByRole("main")).toHaveAttribute("aria-busy", "true");
  expect(screen.getByText("正在加载实验室运营台")).toBeInTheDocument();
  expect(container.querySelector(".ant-skeleton-active")).toBeNull();
});
