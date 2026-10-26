import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ColumnsType } from "antd/es/table";
import { afterEach, expect, it, vi } from "vitest";
import type { PrincipalIdentity, SessionUser } from "../../api/contracts";
import { DataView } from "./DataView";

Object.defineProperty(window, "matchMedia", {
  writable: true,
  value: () => ({
    matches: false,
    addEventListener() {},
    removeEventListener() {},
    addListener() {},
    removeListener() {},
  }),
});

const state = vi.hoisted(() => ({
  data: undefined as { items: PrincipalIdentity[] } | undefined,
  isError: false,
  refetch: vi.fn(),
  save: vi.fn(),
}));
vi.mock("../../api/administration", () => ({
  useIacucStatus: () => ({ data: { count: 7 }, isPending: false, isError: false }),
  usePrincipalIdentities: () => ({
    data: state.data,
    isPending: false,
    isError: state.isError,
    refetch: state.refetch,
  }),
  useSavePrincipalIdentity: () => ({ mutateAsync: state.save }),
  uploadFile: vi.fn(),
}));
vi.mock("../../components/ui", () => ({
  CommandBar: ({ title }: { title: string }) => <h2>{title}</h2>,
  DataTable: ({
    columns,
    dataSource,
  }: {
    columns: ColumnsType<PrincipalIdentity>;
    dataSource: PrincipalIdentity[];
  }) => (
    <div>
      {dataSource.map((item) => (
        <div key={item.pi}>
          {item.pi}
          {columns[1].render?.(item.principalType, item, 0) as ReactNode}
        </div>
      ))}
    </div>
  ),
}));

afterEach(() => {
  cleanup();
  state.refetch.mockReset();
  state.save.mockReset();
});

it("keeps identities visible and read-only after refresh failure, then allows retry", () => {
  state.data = { items: [{ pi: "测试负责人", principalType: "pi", freeCageAllowance: 20, updatedAt: "v1" }] };
  state.isError = false;
  const client = new QueryClient();
  const user = { id: "admin", role: "admin" } as SessionUser;
  const tree = () => (
    <QueryClientProvider client={client}>
      <DataView user={user} />
    </QueryClientProvider>
  );
  const view = render(tree());
  const save = screen.getByRole("button", { name: "保存 测试负责人 的负责人身份" });
  expect(save).toBeEnabled();
  state.isError = true;
  view.rerender(tree());
  expect(screen.getByText("测试负责人")).toBeInTheDocument();
  expect(screen.getByText("负责人身份更新失败，暂显示上次结果")).toBeInTheDocument();
  expect(save).toBeDisabled();
  expect(screen.getByLabelText("测试负责人 的负责人身份")).toBeDisabled();
  expect(screen.getByText("已索引记录")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: /重\s*试/ }));
  expect(state.refetch).toHaveBeenCalledOnce();
  expect(state.save).not.toHaveBeenCalled();
});

it("shows a retryable first failure rather than an empty table", () => {
  state.data = undefined;
  state.isError = true;
  const client = new QueryClient();
  render(
    <QueryClientProvider client={client}>
      <DataView user={{ id: "admin", role: "admin" } as SessionUser} />
    </QueryClientProvider>,
  );
  expect(screen.getByText("负责人身份加载失败")).toBeInTheDocument();
  expect(screen.queryByText("当前没有匹配的项目负责人。")).not.toBeInTheDocument();
  expect(screen.getByText("已索引记录")).toBeInTheDocument();
});
