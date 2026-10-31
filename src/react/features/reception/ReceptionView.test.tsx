import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import type * as UiModule from "../../components/ui";
import type { ModalProps, TableProps } from "antd";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import type { ReceptionPreviewResponse, ReceptionRecord } from "../../../contracts/reception";
import { requestDownload, requestJson } from "../../api/client";
import { AntdProvider } from "../../components/ui";
import { UiProvider } from "../../state/ui";
import { ReceptionView } from "./ReceptionView";

vi.mock("../../api/client", () => ({ requestJson: vi.fn(), requestDownload: vi.fn() }));
vi.mock("../../api/session", () => ({
  useSession: () => ({ data: { user: { id: "admin", role: "admin", roomIds: [] } } }),
}));
vi.mock("../../components/ui", async (load) => {
  const actual = await load<typeof UiModule>();
  return {
    ...actual,
    ModalPresence: ({ children }: { children: ReactNode }) => <>{children}</>,
    Modal: ({ children, title, footer }: ModalProps) => (
      <section role="dialog" aria-label={String(title)}>
        {children}
        {typeof footer === "function" ? null : footer}
      </section>
    ),
    DataTable: ({ columns, dataSource }: TableProps<ReceptionRecord>) => (
      <table>
        <thead>
          <tr>
            {columns?.map((column, index) => (
              <th key={index}>{typeof column.title === "function" ? null : column.title}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {dataSource?.map((item) => (
            <tr key={item.id}>
              {columns?.map((column, index) => (
                <td key={index}>{column.render?.(undefined, item, index) as ReactNode}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    ),
  };
});

const record: ReceptionRecord = {
  id: "one",
  batchId: "one",
  batchNo: "RECEPTION-ONE",
  purchaseOrderNo: "PO-1",
  iacuc: "Z1",
  pi: "权威项目负责人",
  owner: "权威实验负责人",
  project: "项目",
  funding: "来源",
  fundCode: "F1",
  projectEndDate: "2026-12-31",
  strain: "ICR",
  specification: "8周",
  sex: "雌雄",
  roomName: "8014",
  supplier: "江苏集萃药康生物科技股份有限公司",
  updatedAt: "batch-v1",
  quantity: 6,
  receiptDates: ["2026-10-12"],
  projectMatched: true,
  warnings: ["请核对性别"],
  source: { batchUpdatedAt: "batch-v1", applicationUpdatedAt: "app-time", applicationSource: "申请汇总表.xlsx" },
};
const preview: ReceptionPreviewResponse = {
  items: [record],
  rows: [],
  rowCount: 2,
  applicationVersion: "app-v1",
  warnings: ["需要核对预填明细"],
};
let client: QueryClient;
let failList: boolean;
let previewLoader: () => Promise<ReceptionPreviewResponse>;
let applicationVersion: string;
function view() {
  return (
    <QueryClientProvider client={client}>
      <UiProvider>
        <AntdProvider>
          <ReceptionView />
        </AntdProvider>
      </UiProvider>
    </QueryClientProvider>
  );
}
beforeEach(() => {
  failList = false;
  applicationVersion = "app-v1";
  previewLoader = () => Promise.resolve(preview);
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } } });
  vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
  vi.mocked(requestJson).mockImplementation(async (url) => {
    const path = new URL(String(url), "http://localhost");
    if (path.pathname === "/api/receptions/preview") return previewLoader();
    if (path.pathname === "/api/receptions/filter-options") return { items: [] };
    if (path.pathname === "/api/receptions") {
      if (failList) throw new Error("offline");
      const offset = Number(path.searchParams.get("offset") || "0");
      return {
        items: [{ ...record, id: offset ? "two" : "one", batchNo: offset ? "RECEPTION-TWO" : record.batchNo }],
        page: { offset, limit: 20, total: 21, hasMore: !offset },
        applicationVersion,
      };
    }
    throw new Error(`Unexpected URL ${url}`);
  });
  vi.mocked(requestDownload).mockReset();
});
afterEach(() => {
  cleanup();
  client.clear();
  vi.unstubAllGlobals();
  vi.mocked(requestJson).mockReset();
});

it("shows the list without directories, previews frozen versions, and keeps selection on export failure", async () => {
  vi.mocked(requestDownload).mockRejectedValueOnce(new Error("版本已变化"));
  render(view());
  await screen.findByText(record.batchNo);
  expect(screen.getByText("权威项目负责人")).toBeInTheDocument();
  expect(screen.getByTitle(record.supplier)).toHaveTextContent("江苏集萃");
  expect(requestJson).toHaveBeenCalledTimes(1);
  expect(screen.getByRole("button", { name: "导出Excel" })).toBeDisabled();
  fireEvent.click(screen.getByRole("checkbox", { name: `选择 ${record.batchNo}` }));
  fireEvent.click(screen.getByRole("button", { name: "导出Excel" }));
  const dialog = await screen.findByRole("dialog", { name: "导出接收记录 Excel" });
  await within(dialog).findByText("已选择 1 个批次，Excel 共 2 行");
  expect(within(dialog).getByText("导出内容为来源预填，需人工核对")).toBeInTheDocument();
  fireEvent.click(within(dialog).getByRole("button", { name: "确认导出" }));
  await screen.findByText("版本已变化");
  expect(requestDownload).toHaveBeenCalledWith("/api/receptions/export", {
    method: "POST",
    body: JSON.stringify({ ids: ["one"], expectedVersions: { one: "batch-v1" }, expectedApplicationVersion: "app-v1" }),
  });
  expect(screen.getByRole("checkbox", { name: `选择 ${record.batchNo}` })).toBeChecked();
  expect(within(dialog).getByRole("button", { name: "确认导出" })).toBeEnabled();
});

it("keeps the successful page and pauses selection/export after a later page fails, then retries", async () => {
  render(view());
  await screen.findByText(record.batchNo);
  fireEvent.click(screen.getByRole("checkbox", { name: `选择 ${record.batchNo}` }));
  failList = true;
  fireEvent.click(screen.getByTitle("2"));
  await screen.findByText("接收列表更新失败，暂显示上次成功结果；选择和导出已暂停");
  expect(screen.getByText(record.batchNo)).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "导出Excel" })).toBeDisabled();
  expect(screen.getByRole("checkbox", { name: `选择 ${record.batchNo}` })).toBeDisabled();
  expect(screen.getByTitle("1")).toHaveClass("ant-pagination-item-active");
  failList = false;
  fireEvent.click(screen.getByRole("button", { name: /重\s*试/ }));
  await screen.findByText("RECEPTION-TWO");
  expect(screen.getByRole("button", { name: "导出Excel" })).toBeEnabled();
  expect(screen.getByTitle("2")).toHaveClass("ant-pagination-item-active");
});

it("discards a preview response after closing and clears selection when the authority source changes", async () => {
  let resolvePreview: (value: ReceptionPreviewResponse) => void = () => {};
  previewLoader = () =>
    new Promise((resolve) => {
      resolvePreview = resolve;
    });
  render(view());
  await screen.findByText(record.batchNo);
  fireEvent.click(screen.getByRole("checkbox", { name: `选择 ${record.batchNo}` }));
  fireEvent.click(screen.getByRole("button", { name: "导出Excel" }));
  const dialog = await screen.findByRole("dialog", { name: "导出接收记录 Excel" });
  expect(within(dialog).getByRole("status", { name: "接收导出预览正在加载" })).toBeInTheDocument();
  fireEvent.click(within(dialog).getByRole("button", { name: "取消" }));
  await act(async () => {
    resolvePreview(preview);
    await Promise.resolve();
  });
  await waitFor(() => expect(screen.queryByRole("dialog", { name: "导出接收记录 Excel" })).not.toBeInTheDocument());
  expect(requestDownload).not.toHaveBeenCalled();
  applicationVersion = "app-v2";
  fireEvent.click(screen.getByRole("button", { name: "刷新" }));
  await waitFor(() => expect(screen.getByRole("checkbox", { name: `选择 ${record.batchNo}` })).not.toBeChecked());
  expect(screen.getByRole("button", { name: "导出Excel" })).toBeDisabled();
});
