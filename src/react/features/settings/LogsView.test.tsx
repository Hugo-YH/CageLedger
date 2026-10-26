import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { LogsView } from "./LogsView";

const api = vi.hoisted(() => ({ load: vi.fn() }));
vi.mock("../../api/session", () => ({
  useSession: () => ({ data: { user: { id: "admin", role: "admin", roomIds: [] } } }),
}));
vi.mock("../../api/administration", () => ({
  useAuditEvents: (limit: number, offset: number) =>
    useQuery({
      queryKey: ["audit-events", { limit, offset }],
      queryFn: () => api.load(limit, offset),
      placeholderData: (previous) => previous,
    }),
}));
vi.mock("../../components/ui", () => ({
  CommandBar: ({ title }: { title: string }) => <h1>{title}</h1>,
  DataTable: ({ dataSource }: { dataSource: Array<{ id: string }> }) => (
    <div>
      {dataSource.map((row) => (
        <div key={row.id}>{row.id}</div>
      ))}
    </div>
  ),
}));
vi.mock("../../components/WorkspaceUi", () => ({
  formatDateTime: (value: string) => value,
  PageSkeleton: () => <div>加载中</div>,
  PageState: ({ title, retry }: { title: string; retry: () => void }) => <button onClick={retry}>{title}</button>,
  Pager: ({ page, onPage }: { page: number; onPage: (page: number) => void }) => (
    <div>
      显示第 {page} 页<button onClick={() => onPage(2)}>下一页</button>
    </div>
  ),
}));

afterEach(() => api.load.mockReset());

it("keeps the last successful page and its page number on failure, then retries", async () => {
  let fail = true;
  api.load.mockImplementation(async (limit: number, offset: number) => {
    await Promise.resolve();
    if (offset && fail) throw new Error("offline");
    return { items: [{ id: offset ? "第二页记录" : "第一页记录" }], page: { limit, offset, total: 20 } };
  });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <LogsView />
    </QueryClientProvider>,
  );
  expect(screen.getByText("操作记录")).toBeInTheDocument();
  await screen.findByText("第一页记录");
  fireEvent.click(screen.getByText("下一页"));
  await screen.findByText("操作日志更新失败，暂显示上次结果");
  expect(screen.getByText("第一页记录")).toBeInTheDocument();
  expect(screen.getByText(/显示第 1 页/)).toBeInTheDocument();
  fail = false;
  fireEvent.click(screen.getByRole("button", { name: /重\s*试/ }));
  await screen.findByText("第二页记录");
  await waitFor(() => expect(screen.getByText(/显示第 2 页/)).toBeInTheDocument());
});
