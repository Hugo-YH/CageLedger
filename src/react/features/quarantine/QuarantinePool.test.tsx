import type * as Antd from "antd";
import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { QuarantinePool } from "./QuarantinePool";

const api = vi.hoisted(() => ({ load: vi.fn() }));
vi.mock("../../api/session", () => ({
  useSession: () => ({ data: { user: { id: "admin", role: "admin", roomIds: [] } } }),
}));
vi.mock("../../api/quarantine", () => ({
  quarantineSourcesPath: (from: string, to: string, page: number, state: string) =>
    `sources?dateFrom=${from}&dateTo=${to}&offset=${(page - 1) * 30}&state=${state}`,
  useQuarantineSources: (from: string, to: string, page: number, _enabled: boolean, state: string) =>
    useQuery({
      queryKey: ["quarantine", `sources?dateFrom=${from}&dateTo=${to}&offset=${(page - 1) * 30}&state=${state}`],
      queryFn: () => api.load(page),
      placeholderData: (previous) => previous,
    }),
}));
vi.mock("../../components/ui", () => ({
  CommandBar: ({ title, filters, primaryAction }: { title: string; filters: ReactNode; primaryAction: ReactNode }) => (
    <div>
      <h1>{title}</h1>
      {filters}
      {primaryAction}
    </div>
  ),
  HelpPopover: () => null,
  ListRefreshStatus: () => null,
}));
vi.mock("antd", async (importOriginal) => {
  const original = await importOriginal<typeof Antd>();
  return {
    ...original,
    Table: ({
      dataSource,
      rowSelection,
      pagination,
    }: {
      dataSource: Array<{ id: string; quarantineStatus: string }>;
      rowSelection: {
        onChange: (keys: string[], rows: typeof dataSource) => void;
        getCheckboxProps: (row: (typeof dataSource)[number]) => { disabled: boolean };
      };
      pagination: { onChange: (page: number) => void; current: number };
    }) => (
      <div>
        {dataSource.map((row) => (
          <button
            key={row.id}
            disabled={rowSelection.getCheckboxProps(row).disabled}
            onClick={() => rowSelection.onChange([row.id], [row])}
          >
            {row.id}
          </button>
        ))}
        <span>显示第 {pagination.current} 页</span>
        <button onClick={() => pagination.onChange(2)}>下一页</button>
      </div>
    ),
  };
});

afterEach(() => {
  cleanup();
  api.load.mockReset();
});

it("disables selection and selected batch creation while a failed page retains old rows", async () => {
  api.load.mockImplementation(async (page: number) => {
    await Promise.resolve();
    if (page === 2) throw new Error("第二页失败");
    return { items: [{ id: "旧动物", quarantineStatus: "待检疫" }], page: { offset: 0, limit: 30, total: 60 } };
  });
  const create = vi.fn();
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <QuarantinePool onCreate={create} onNew={vi.fn()} onOpen={vi.fn()} />
    </QueryClientProvider>,
  );
  fireEvent.click(await screen.findByRole("button", { name: "旧动物" }));
  const createButton = screen.getByRole("button", { name: /用所选动物新建检疫批次/ });
  expect(createButton).toBeEnabled();
  fireEvent.click(screen.getByRole("button", { name: "下一页" }));
  await screen.findByText(/第二页失败，暂显示上次结果/);
  expect(screen.getByRole("button", { name: "旧动物" })).toBeDisabled();
  expect(createButton).toBeDisabled();
  expect(screen.getByText("显示第 1 页")).toBeInTheDocument();
  expect(create).not.toHaveBeenCalled();
});

it("shows a retryable initial failure without an empty table", async () => {
  api.load.mockRejectedValue(new Error("首次失败"));
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <QuarantinePool onCreate={vi.fn()} onNew={vi.fn()} onOpen={vi.fn()} />
    </QueryClientProvider>,
  );
  expect(screen.getByRole("heading", { name: "检疫批次" })).toBeInTheDocument();
  await screen.findByText("首次失败");
  expect(screen.queryByRole("button", { name: "下一页" })).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: /重\s*试/ })).toBeEnabled();
});
