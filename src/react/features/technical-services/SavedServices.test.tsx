import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useEffect, useRef, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type * as Antd from "antd";
import type * as Ui from "../../components/ui";

import type { TechnicalServiceSheet } from "../../../contracts/technicalServices";
import { WorkspaceMemory } from "../../state/workspaceMemory";
import { SavedServices } from "./SavedServices";

const api = vi.hoisted(() => ({
  isError: false,
  items: [] as TechnicalServiceSheet[],
  lastParams: {},
  mutation: vi.fn<() => Promise<unknown>>(),
  total: 0,
}));

vi.mock("../../api/technicalServices", () => ({
  useServiceList: (params: Record<string, unknown>) => {
    api.lastParams = params;
    return {
      data: { items: api.items, page: { total: api.total } },
      isError: api.isError,
      isFetching: false,
      isPending: false,
      isPlaceholderData: false,
      refetch: vi.fn(),
    };
  },
  useServiceMutation: () => ({ isPending: false, mutateAsync: api.mutation }),
}));

vi.mock("../../state/ui", () => ({ useNavigationGuard: () => ({ current: null }) }));

vi.mock("antd", async (importOriginal) => {
  const original = await importOriginal<typeof Antd>();
  function Modal({
    afterClose,
    cancelText = "取消",
    children,
    footer,
    okText = "确定",
    onCancel,
    onOk,
    open,
    title,
  }: {
    afterClose?: () => void;
    cancelText?: string;
    children: ReactNode;
    footer?: ReactNode | null;
    okText?: string;
    onCancel?: () => void;
    onOk?: () => void;
    open: boolean;
    title?: ReactNode;
  }) {
    const wasOpen = useRef(open);
    useEffect(() => {
      if (wasOpen.current && !open) afterClose?.();
      wasOpen.current = open;
    }, [afterClose, open]);
    if (!open) return null;
    return (
      <div className="ant-modal">
        <div>{title}</div>
        {children}
        {footer === null
          ? null
          : footer || (
              <>
                <original.Button onClick={onCancel}>{cancelText}</original.Button>
                <original.Button onClick={onOk}>{okText}</original.Button>
              </>
            )}
      </div>
    );
  }
  return { ...original, Modal };
});

vi.mock("./ServiceColumnTitle", () => ({
  ServiceColumnTitle: ({ label, onFilter }: { label: string; onFilter: (values: string[]) => void }) => (
    <button type="button" onClick={() => onFilter(["2026-10"])}>
      {label}筛选
    </button>
  ),
}));

vi.mock("./ServiceEditor", () => ({
  ServiceEditor: ({ onSaved }: { onSaved: () => void }) => <button onClick={onSaved}>完成保存</button>,
}));

vi.mock("./ServiceDetails", () => ({ ServiceDetails: () => null }));

vi.mock("../../components/ui", async (importOriginal) => {
  const original = await importOriginal<typeof Ui>();
  return {
    ...original,
    DataTable: ({
      columns,
      dataSource,
      size,
    }: {
      columns: Array<{
        key?: string;
        render?: (_value: unknown, row: TechnicalServiceSheet) => ReactNode;
        title: ReactNode;
      }>;
      dataSource?: TechnicalServiceSheet[];
      size?: string;
    }) => (
      <div data-size={size}>
        {columns.map((column, index) => (
          <span key={column.key || index}>{column.title}</span>
        ))}
        {(dataSource || []).map((row) => (
          <div key={row.id}>
            {columns.map((column, index) => (
              <span key={column.key || index}>{column.render?.(undefined, row)}</span>
            ))}
          </div>
        ))}
      </div>
    ),
  };
});

vi.mock("../../components/WorkspaceUi", () => ({
  PageSkeleton: () => null,
  Pager: ({ page, onPage }: { page: number; onPage: (next: number) => void }) => (
    <button type="button" onClick={() => onPage(page + 1)}>
      第 {page} 页
    </button>
  ),
}));

function sheet(id: string, protectedSheet = false): TechnicalServiceSheet {
  return {
    id,
    month: "2026-10",
    iacuc: `IACUC-${id}`,
    facility: "zhujiang",
    customerType: "internal",
    serviceId: "service-1",
    serviceName: "细胞培养",
    unit: "次",
    unitPrice: 10,
    project: "项目",
    pi: "负责人",
    owner: "负责人",
    funding: "经费",
    manager: "管理员",
    notes: "",
    updatedAt: "2026-10-17T00:00:00Z",
    rows: [],
    totalAmount: 10,
    totalQuantity: 1,
    serviceDayCount: 1,
    protected: protectedSheet,
  };
}

function workspace(memory: Map<string, unknown>, client: QueryClient) {
  return (
    <QueryClientProvider client={client}>
      <WorkspaceMemory.Provider value={memory}>
        <SavedServices />
      </WorkspaceMemory.Provider>
    </QueryClientProvider>
  );
}

function view(memory = new Map<string, unknown>()) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return { memory, client, ...render(workspace(memory, client)) };
}

beforeEach(() => {
  api.items = [sheet("open"), sheet("protected", true)];
  api.isError = false;
  api.total = 20;
  api.lastParams = {};
  api.mutation.mockReset();
  api.mutation.mockResolvedValue({});
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("SavedServices", () => {
  it("remembers paging, filters and density, and lets users remove or clear applied filters", async () => {
    const rendered = view();
    fireEvent.click(screen.getByRole("button", { name: "月份筛选" }));
    expect(screen.getByText("月份：2026-10")).toBeInTheDocument();
    const tag = screen.getByText("月份：2026-10").closest(".ant-tag");
    fireEvent.click(tag!.querySelector<HTMLElement>(".ant-tag-close-icon")!);
    await waitFor(() => expect(screen.queryByText("月份：2026-10")).not.toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: "月份筛选" }));
    fireEvent.click(screen.getByRole("button", { name: "清除全部筛选" }));
    await waitFor(() => expect(screen.queryByText("月份：2026-10")).not.toBeInTheDocument());

    fireEvent.click(screen.getByRole("radio", { name: "紧凑" }));
    fireEvent.click(screen.getByRole("button", { name: "第 1 页" }));
    rendered.unmount();
    view(rendered.memory);

    expect(api.lastParams).toMatchObject({ limit: 10, offset: 10, columnFilters: {} });
    expect(document.querySelector("[data-size]")).toHaveAttribute("data-size", "small");
  });

  it("restores the scroll snapshot saved by the matching workspace view key", async () => {
    const memory = new Map<string, unknown>([["technical-service-saved:scroll", 128]]);
    const workspace = document.createElement("div");
    workspace.dataset.ui = "workspace";
    workspace.style.overflowY = "auto";
    document.body.append(workspace);
    view(memory);
    await waitFor(() => expect(workspace).toHaveProperty("scrollTop", 128));
    workspace.remove();
  });

  it("shows an explicit edit success notice, restores the edit trigger focus, and keeps errors separate", async () => {
    const rendered = view();
    const edit = screen.getAllByRole("button", { name: /编\s*辑/ })[0];
    fireEvent.click(edit);
    fireEvent.click(screen.getByRole("button", { name: "完成保存" }));

    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("技术服务明细已保存。"));
    await waitFor(() => expect(edit).toHaveFocus());

    api.isError = true;
    rendered.rerender(workspace(rendered.memory, rendered.client));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("明细列表读取失败"));
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    api.isError = false;
    rendered.rerender(workspace(rendered.memory, rendered.client));
    expect(screen.queryByRole("status")).not.toBeInTheDocument();

    api.mutation.mockRejectedValueOnce(new Error("删除失败"));
    fireEvent.click(screen.getAllByRole("button", { name: /删\s*除/ })[0]);
    fireEvent.click(
      within(screen.getByText("删除技术服务明细").closest(".ant-modal")!).getByRole("button", { name: /删\s*除/ }),
    );
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("删除失败"));
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /删\s*除/ })[1]).toBeDisabled();
    fireEvent.click(
      within(screen.getByText("删除技术服务明细").closest(".ant-modal")!).getByRole("button", { name: /取\s*消/ }),
    );
    fireEvent.click(screen.getAllByRole("button", { name: /删\s*除/ })[0]);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("returns to the final available page after deletion reduces the result count", async () => {
    api.mutation.mockImplementation(() => {
      api.items = [];
      api.total = 10;
      return Promise.resolve();
    });
    view();
    fireEvent.click(screen.getByRole("button", { name: "第 1 页" }));
    await waitFor(() => expect(api.lastParams).toMatchObject({ offset: 10 }));
    fireEvent.click(screen.getAllByRole("button", { name: /删\s*除/ })[0]);
    fireEvent.click(
      within(screen.getByText("删除技术服务明细").closest(".ant-modal")!).getByRole("button", { name: /删\s*除/ }),
    );
    await waitFor(() => expect(api.lastParams).toMatchObject({ offset: 0 }));
  });
});
