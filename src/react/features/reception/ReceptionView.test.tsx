import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import type * as UiModule from "../../components/ui";
import type { DrawerProps, ModalProps, TableProps } from "antd";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import type {
  ReceptionListResponse,
  ReceptionPreviewSummaryResponse,
  ReceptionRecord,
} from "../../../contracts/reception";
import { requestDownload, requestJson } from "../../api/client";
import { AntdProvider } from "../../components/ui";
import { UiProvider } from "../../state/ui";
import { ReceptionView } from "./ReceptionView";

vi.mock("../../api/client", () => ({ requestJson: vi.fn(), requestDownload: vi.fn(), requestMultipart: vi.fn() }));
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
    Drawer: ({ children, title, footer }: DrawerProps) => (
      <section role="dialog" aria-label={String(title)}>
        {children}
        {footer}
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

const operationFeedback = vi.hoisted(() => ({
  success: vi.fn(),
  info: vi.fn(),
  warning: vi.fn(),
  error: vi.fn(),
  message: { success: vi.fn(), info: vi.fn(), warning: vi.fn(), error: vi.fn() },
}));
vi.mock("../../hooks/useOperationFeedback", () => ({ useOperationFeedback: () => operationFeedback }));

const record: ReceptionRecord = {
  id: "one",
  batchId: "one",
  batchNo: "RECEPTION-ONE",
  purchaseOrderNo: "C2026041317057",
  orderNo: "DC202604131705702",
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
const preview: ReceptionPreviewSummaryResponse = {
  items: [record],
  rowCount: 2,
  applicationVersion: "app-v1",
  warnings: ["需要核对预填明细"],
  registrationVersions: { one: null },
};
let client: QueryClient;
let failList: boolean;
let previewLoader: () => Promise<ReceptionPreviewSummaryResponse>;
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
  expect(screen.getByText(record.purchaseOrderNo)).toBeInTheDocument();
  expect(screen.queryByText(record.orderNo!)).not.toBeInTheDocument();
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
    body: JSON.stringify({
      ids: ["one"],
      expectedVersions: { one: "batch-v1" },
      expectedApplicationVersion: "app-v1",
      expectedRegistrationVersions: { one: null },
    }),
  });
  expect(screen.getByRole("checkbox", { name: `选择 ${record.batchNo}` })).toBeChecked();
  expect(within(dialog).getByRole("button", { name: "确认导出" })).toBeEnabled();
});

it("opens the system PDF picker before a modal and keeps the main list usable when details fail", async () => {
  const previous = vi.mocked(requestJson).getMockImplementation()!;
  let rejectDetail: (reason: Error) => void = () => {};
  vi.mocked(requestJson).mockImplementation((url, init) =>
    String(url).endsWith("/registration")
      ? new Promise((_, reject) => {
          rejectDetail = reject;
        })
      : previous(url, init),
  );
  render(view());
  await screen.findByText(record.batchNo);
  expect(requestJson).toHaveBeenCalledTimes(1);
  const chooser = vi.spyOn(HTMLInputElement.prototype, "click");
  const trigger = screen.getByRole("button", { name: "合格证识别" });
  expect(trigger).toHaveClass("ant-btn-color-primary", "ant-btn-variant-solid");
  fireEvent.click(trigger);
  expect(chooser).toHaveBeenCalledOnce();
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  const input = screen.getByLabelText("选择待识别合格证 PDF");
  fireEvent(input, new Event("cancel"));
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(requestJson).toHaveBeenCalledTimes(1);
  fireEvent.click(trigger);
  expect(chooser).toHaveBeenCalledTimes(2);
  fireEvent.change(input, { target: { files: [new File(["%PDF"], "original.pdf", { type: "application/pdf" })] } });
  const drawer = screen.getByRole("dialog", { name: `合格证与接收登记 · ${record.batchNo}` });
  expect(within(drawer).getByRole("status", { name: "合格证详情正在加载" })).toBeInTheDocument();
  await act(async () => {
    rejectDetail(new Error("detail offline"));
    await Promise.resolve();
  });
  await within(drawer).findByText("合格证详情加载失败");
  expect(screen.getByRole("checkbox", { name: `选择 ${record.batchNo}` })).toBeEnabled();
  expect(screen.getByRole("button", { name: "刷新" })).toBeEnabled();
});

it.each([
  { status: "confirmed" as const, quantity: 12, label: "已确认登记", displayed: true, action: "查看/编辑" },
  { status: "stale" as const, quantity: 9, label: "待重新核对", displayed: true, action: "重新核对" },
  { status: "unconfirmed" as const, quantity: 0, label: "未确认登记", displayed: false, action: "合格证识别" },
  { status: "confirmed" as const, quantity: null, label: "已确认登记", displayed: false, action: "查看/编辑" },
])(
  "distinguishes reservation fields from registered quantities for $status ($quantity)",
  async ({ status, quantity, label, displayed, action }) => {
    const previous = vi.mocked(requestJson).getMockImplementation()!;
    vi.mocked(requestJson).mockImplementation(async (url, init) => {
      const result = await previous(url, init);
      if (new URL(String(url), "http://localhost").pathname !== "/api/receptions") return result;
      return {
        ...(result as ReceptionListResponse),
        items: [{ ...record, registrationStatus: status, registeredQuantity: quantity }],
      };
    });
    render(view());
    await screen.findByText(record.batchNo);
    expect(screen.getByText("预约数量")).toBeInTheDocument();
    // Check visible column labels without computing accessible names for every
    // nested sort/filter control in the Ant Design headers.
    const headers = screen.getAllByRole("columnheader").map((header) => header.textContent ?? "");
    expect(headers.some((text) => text.includes("预约性别"))).toBe(false);
    expect(headers.some((text) => text.includes("预约规格"))).toBe(false);
    expect(headers).toEqual(expect.arrayContaining([expect.stringContaining("采购单号")]));
    expect(headers.some((text) => text.includes("订单编号"))).toBe(false);
    expect(screen.getByText(label)).toBeInTheDocument();
    const row = screen.getByText(record.batchNo).closest("tr")!;
    expect(within(row).getByRole("button", { name: action })).toBeEnabled();
    if (displayed) expect(screen.getByText(`登记 ${quantity} 只`)).toBeInTheDocument();
    else expect(screen.queryByText(/^登记 .* 只$/)).not.toBeInTheDocument();
    expect(screen.queryByText("登记数量")).not.toBeInTheDocument();
  },
);

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
  expect(screen.getByRole("button", { name: "合格证识别" })).toBeDisabled();
  expect(screen.getByTitle("1")).toHaveClass("ant-pagination-item-active");
  failList = false;
  fireEvent.click(screen.getByRole("button", { name: /重\s*试/ }));
  await screen.findByText("RECEPTION-TWO");
  expect(screen.getByRole("button", { name: "导出Excel" })).toBeEnabled();
  expect(screen.getByTitle("2")).toHaveClass("ant-pagination-item-active");
});

it("aborts a closed preview, ignores its late response, and clears selection when the authority source changes", async () => {
  let resolvePreview: (value: ReceptionPreviewSummaryResponse) => void = () => {};
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
  const [, init] = vi.mocked(requestJson).mock.calls.find(([url]) => String(url) === "/api/receptions/preview")!;
  expect(JSON.parse(String(init?.body))).toMatchObject({ view: "summary" });
  const signal = init?.signal;
  expect(signal).toBeInstanceOf(AbortSignal);
  expect(signal?.aborted).toBe(false);
  fireEvent.click(within(dialog).getByRole("button", { name: "取消" }));
  await waitFor(() => expect(signal?.aborted).toBe(true));
  const finishClosedPreview = resolvePreview;
  fireEvent.click(screen.getByRole("button", { name: "导出Excel" }));
  const nextDialog = await screen.findByRole("dialog", { name: "导出接收记录 Excel" });
  await act(async () => {
    finishClosedPreview({ ...preview, rowCount: 99 });
    await Promise.resolve();
  });
  expect(within(nextDialog).getByRole("status", { name: "接收导出预览正在加载" })).toBeInTheDocument();
  expect(within(nextDialog).queryByText(/Excel 共 99 行/)).not.toBeInTheDocument();
  await act(async () => {
    resolvePreview(preview);
    await Promise.resolve();
  });
  await within(nextDialog).findByText("已选择 1 个批次，Excel 共 2 行");
  fireEvent.click(within(nextDialog).getByRole("button", { name: "取消" }));
  await waitFor(() => expect(screen.queryByRole("dialog", { name: "导出接收记录 Excel" })).not.toBeInTheDocument());
  expect(requestDownload).not.toHaveBeenCalled();
  applicationVersion = "app-v2";
  fireEvent.click(screen.getByRole("button", { name: "刷新" }));
  await waitFor(() => expect(screen.getByRole("checkbox", { name: `选择 ${record.batchNo}` })).not.toBeChecked());
  expect(screen.getByRole("button", { name: "导出Excel" })).toBeDisabled();
});

it("retries a failed read-only preview with a new signal and accepts a summary without export rows", async () => {
  previewLoader = vi
    .fn<() => Promise<ReceptionPreviewSummaryResponse>>()
    .mockRejectedValueOnce(new Error("preview offline"))
    .mockResolvedValueOnce(preview);
  render(view());
  await screen.findByText(record.batchNo);
  fireEvent.click(screen.getByRole("checkbox", { name: `选择 ${record.batchNo}` }));
  fireEvent.click(screen.getByRole("button", { name: "导出Excel" }));
  const dialog = await screen.findByRole("dialog", { name: "导出接收记录 Excel" });
  await within(dialog).findByText("preview offline");
  const previewCalls = () =>
    vi.mocked(requestJson).mock.calls.filter(([url]) => String(url) === "/api/receptions/preview");
  const originalSignal = previewCalls()[0][1]?.signal;
  expect(originalSignal?.aborted).toBe(false);
  fireEvent.click(within(dialog).getByRole("button", { name: /重\s*试/ }));
  await within(dialog).findByText("已选择 1 个批次，Excel 共 2 行");
  expect(previewCalls()).toHaveLength(2);
  expect(originalSignal?.aborted).toBe(true);
  expect(previewCalls()[1][1]?.signal).not.toBe(originalSignal);
  expect(previewCalls()[1][1]?.signal?.aborted).toBe(false);
  expect(requestDownload).not.toHaveBeenCalled();
});
