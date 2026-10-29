import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { DataQualityView } from "./DataQualityView";

vi.mock("../../api/session", () => ({ useSession: () => ({ data: { user: { id: "admin", role: "admin" } } }) }));
vi.mock("../../hooks/useMediaQuery", () => ({ useMediaQuery: () => false }));
vi.mock("../../components/FilterableTableHeader", () => ({
  FilterableColumnTitle: ({ label }: { label: string }) => label,
}));
vi.mock("../../components/WorkspaceUi", () => ({
  formatDateTime: (value: string) => value,
  PageSkeleton: () => <div>加载中</div>,
  PageState: ({ title }: { title: string }) => <div>{title}</div>,
  Pager: ({ onPage }: { onPage: (page: number) => void }) => <button onClick={() => onPage(2)}>下一页</button>,
}));
vi.mock("../../components/ui", () => ({
  ActionButton: ({ children, onClick }: { children: ReactNode; onClick?: () => void }) => (
    <button onClick={onClick}>{children}</button>
  ),
  CommandBar: ({ title, actions }: { title: string; actions: ReactNode }) => (
    <div>
      {title}
      {actions}
    </div>
  ),
  DataTable: ({ dataSource }: { dataSource: Array<{ id: string; summary: string }> }) => (
    <div>
      {dataSource.map((item) => (
        <div key={item.id}>{item.summary}</div>
      ))}
    </div>
  ),
  ModalPresence: ({ children }: { children: ReactNode }) => children,
}));
vi.mock("./components/DataQualityDetail", () => ({ DataQualityDetail: () => null }));

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it("shows latest issues despite a failed directory and pins its scan for pagination", async () => {
  vi.stubGlobal("matchMedia", () => ({
    matches: false,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
  }));
  const scan = {
    id: "first",
    scannedAt: "2026-10-01",
    actorName: "A",
    scope: "范围",
    findingCount: 2,
    needsReview: 2,
    retainedHistory: 0,
    trigger: "manual",
  };
  const requests: string[] = [];
  vi.spyOn(globalThis, "fetch").mockImplementation((url) => {
    const target = String(url);
    requests.push(target);
    if (target.includes("/scans?"))
      return Promise.resolve(new Response(JSON.stringify({ error: "目录不可用" }), { status: 500 }));
    const second = target.includes("offset=10");
    return Promise.resolve(
      new Response(
        JSON.stringify({
          scan,
          items: [{ id: second ? "b" : "a", summary: second ? "固定留档第二页" : "固定留档第一页" }],
          page: { limit: 10, offset: second ? 10 : 0, total: 11, hasMore: !second },
          filterOptions: { code: [], reviewStatus: [] },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );
  });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <DataQualityView />
    </QueryClientProvider>,
  );
  expect(await screen.findByText("固定留档第一页")).toBeTruthy();
  expect(await screen.findByText("核查留档目录加载失败，仍可查看当前留档")).toBeTruthy();
  fireEvent.click(screen.getByText("下一页"));
  expect(await screen.findByText("固定留档第二页")).toBeTruthy();
  await waitFor(() =>
    expect(requests.some((url) => url.includes("/scans/first/issues?") && url.includes("offset=10"))).toBe(true),
  );
  expect(requests.filter((url) => url.includes("/latest/issues"))).toHaveLength(1);
  client.clear();
});

it("shows the empty archive state even while the directory request is pending", async () => {
  vi.spyOn(globalThis, "fetch").mockImplementation((url) => {
    if (String(url).includes("/scans?")) return new Promise<Response>(() => {});
    return Promise.resolve(
      new Response(
        JSON.stringify({
          scan: null,
          items: [],
          page: { limit: 10, offset: 0, total: 0, hasMore: false },
          filterOptions: { code: [], reviewStatus: [] },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );
  });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <DataQualityView />
    </QueryClientProvider>,
  );
  expect(await screen.findByText("暂无核查留档")).toBeTruthy();
  expect(screen.queryByText("加载中")).toBeNull();
  client.clear();
});
