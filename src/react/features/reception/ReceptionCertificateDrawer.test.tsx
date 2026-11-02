import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ModalProps } from "antd";
import type { ReactNode } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import type {
  ReceptionCertificateAttachment,
  ReceptionRecognitionRun,
  ReceptionRecord,
  ReceptionRegistrationResponse,
} from "../../../contracts/reception";
import { requestJson, requestMultipart } from "../../api/client";
import { queryKeys } from "../../api/queryKeys";
import { AntdProvider } from "../../components/ui";
import type * as UiModule from "../../components/ui";
import { UiProvider } from "../../state/ui";
import { newCertificateLine } from "./certificateDraft";
import { ReceptionCertificateDrawer } from "./ReceptionCertificateDrawer";

vi.mock("../../api/client", () => ({ requestJson: vi.fn(), requestDownload: vi.fn(), requestMultipart: vi.fn() }));
vi.mock("../../api/session", () => ({
  useSession: () => ({ data: { user: { id: "admin", role: "admin", roomIds: [] } } }),
}));
vi.mock("../../components/ui", async (load) => {
  const actual = await load<typeof UiModule>();
  return {
    ...actual,
    Modal: ({ children, title, footer }: ModalProps) => (
      <section role="dialog" aria-label={String(title)}>
        {children}
        {typeof footer === "function" ? null : footer}
      </section>
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
  id: "b1",
  batchId: "b1",
  batchNo: "BATCH-1",
  purchaseOrderNo: "PO-1",
  iacuc: "Z1",
  pi: "甲",
  owner: "乙",
  project: "项目",
  funding: "经费",
  fundCode: "F1",
  projectEndDate: "2027-01-01",
  strain: "ICR",
  specification: "8周",
  sex: "雌雄",
  roomName: "8014",
  supplier: "预约供应商",
  updatedAt: "batch-v1",
  quantity: 8,
  receiptDates: ["2026-11-01"],
  receipts: [
    { id: "receipt-1", actualReceiptDate: "2026-11-01" },
    { id: "receipt-2", actualReceiptDate: "2026-11-02" },
  ],
  projectMatched: true,
  warnings: [],
  source: { batchUpdatedAt: "batch-v1", applicationUpdatedAt: "a1", applicationSource: "汇总表" },
};
const attachment: ReceptionCertificateAttachment = {
  id: "a1",
  batchId: "b1",
  name: "合格证.pdf",
  size: 100,
  sha256: "hash",
  pageCount: 2,
  createdAt: "2026-11-01",
  createdBy: "管理员",
  fileUrl: "/api/receptions/b1/certificates/a1/file",
  previewUrl: "/api/receptions/b1/certificates/a1/preview",
};
let client: QueryClient;
let detail: ReceptionRegistrationResponse;
let saved: ReturnType<typeof vi.fn<() => void>>;

function view(children?: ReactNode) {
  return (
    <QueryClientProvider client={client}>
      <UiProvider>
        <AntdProvider>
          {children ?? <ReceptionCertificateDrawer record={record} onClose={vi.fn()} onSaved={saved} />}
        </AntdProvider>
      </UiProvider>
    </QueryClientProvider>
  );
}
beforeEach(() => {
  client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity }, mutations: { retry: false } },
  });
  detail = {
    batch: record,
    applicationVersion: "app-v1",
    registration: null,
    attachments: [attachment],
    runs: [],
    canWrite: true,
  };
  saved = vi.fn();
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: query === "(prefers-reduced-motion: reduce)",
    addEventListener() {},
    removeEventListener() {},
  }));
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  vi.mocked(requestJson).mockReset();
  vi.mocked(requestMultipart).mockReset();
  vi.mocked(requestJson).mockImplementation((url, init) => {
    if (String(url).endsWith("/registration") && !init?.method) return Promise.resolve(detail);
    if (init?.method === "PUT")
      return Promise.resolve({ registration: { id: "registration-1", updatedAt: "registration-v1" } });
    throw new Error(`Unexpected request ${url}`);
  });
});
afterEach(() => {
  cleanup();
  client.clear();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function completedRun(quantity: number | null = null): ReceptionRecognitionRun {
  return {
    id: "run-1",
    attachmentId: "a1",
    batchId: "b1",
    status: "completed",
    sourceBatchUpdatedAt: "batch-v1",
    createdAt: "now",
    updatedAt: "now",
    error: "",
    model: "test",
    result: {
      lines: [
        {
          ...newCertificateLine("a1"),
          runId: "run-1",
          certificateNo: "CERT-1",
          certificateStrain: "ICR 原文",
          grade: "SPF",
          supplier: "证载供应商",
          sex: "雄性",
          quantity,
        },
      ],
      warnings: ["请核对数量"],
    },
  };
}
function saveCurrentLines(lines = completedRun(2).result!.lines) {
  detail = {
    ...detail,
    registration: {
      id: "reg-1",
      batchId: "b1",
      updatedAt: "reg-v1",
      sourceBatchUpdatedAt: "batch-v1",
      applicationVersion: "app-v1",
      confirmedAt: "2026-11-01",
      confirmedBy: "管理员",
      lines,
      warnings: [],
    },
  };
}
function mockRecognition(loader: () => Promise<{ run: ReceptionRecognitionRun }>) {
  const regular = vi.mocked(requestJson).getMockImplementation()!;
  vi.mocked(requestJson).mockImplementation((url, init) =>
    String(url).endsWith("/recognize") ? loader() : regular(url, init),
  );
}
async function approveReplacement() {
  await screen.findAllByText("替换本附件的编辑明细？");
  fireEvent.click(screen.getByRole("button", { name: "重新识别并替换" }));
}

it("automatically uploads and recognizes a selected PDF, prefills every certificate line and waits for human save", async () => {
  detail = { ...detail, attachments: [] };
  const run = completedRun();
  run.result!.lines.push({
    ...run.result!.lines[0],
    id: "second",
    certificateIndex: 2,
    certificateLineIndex: 2,
    certificateNo: "CERT-2",
    quantity: 4,
  });
  let finishUpload: (value: { attachment: ReceptionCertificateAttachment; reused: boolean }) => void = () => {};
  vi.mocked(requestMultipart).mockImplementation(
    () =>
      new Promise((resolve) => {
        finishUpload = resolve;
      }),
  );
  mockRecognition(() => Promise.resolve({ run }));
  render(
    view(
      <ReceptionCertificateDrawer
        record={record}
        initialFile={new File(["%PDF"], "合格证.pdf", { type: "application/pdf" })}
        onClose={vi.fn()}
        onSaved={saved}
      />,
    ),
  );
  await screen.findByText("正在上传 PDF 原件…");
  detail = { ...detail, attachments: [attachment] };
  await act(() => Promise.resolve().then(() => finishUpload({ attachment, reused: false })));
  expect(await screen.findByRole("textbox", { name: "明细1 合格证编号" })).toHaveValue("CERT-1");
  expect(screen.getByRole("textbox", { name: "明细2 合格证编号" })).toHaveValue("CERT-2");
  expect(screen.getByRole("spinbutton", { name: "明细1 证载数量" })).toHaveValue("");
  expect(screen.getByRole("img", { name: "合格证.pdf 首页原图" })).toHaveAttribute("src", attachment.previewUrl);
  expect(screen.getByRole("link", { name: "下载" })).toHaveAttribute("href", attachment.fileUrl);
  expect(requestMultipart).toHaveBeenCalledOnce();
  expect(vi.mocked(requestJson).mock.calls.filter(([url]) => String(url).endsWith("/recognize"))).toHaveLength(1);
  expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "采用识别结果" })).not.toBeInTheDocument();
  expect(screen.queryByRole("spinbutton", { name: "明细2 证件序号" })).not.toBeInTheDocument();
  fireEvent.click(screen.getAllByText("高级信息：来源原件与证件序号")[1]);
  expect(screen.getByRole("spinbutton", { name: "明细2 证件序号" })).toHaveValue("2");
  expect(screen.getByRole("spinbutton", { name: "明细2 证内行号" })).toHaveValue("2");
  expect(requestJson).not.toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ method: "PUT" }));
});

it("omits the generic prefill notice and read-only comparison while keeping relevant highlighted differences", async () => {
  detail.batch = {
    ...record,
    warnings: ["数量、性别、规格来自预约预填，需核对实际到货；合格证资料待补录", "证号需核对原件"],
  };
  detail.runs = [completedRun(7)];
  render(view());
  await screen.findByRole("textbox", { name: "明细1 合格证编号" });
  const warningPanel = screen.getByRole("button", { name: /识别核对提示/ });
  expect(warningPanel).toHaveAttribute("aria-expanded", "false");
  fireEvent.click(warningPanel);
  expect(screen.getByText("证号需核对原件")).toBeVisible();
  expect(screen.queryByText(/数量、性别、规格来自预约预填/)).not.toBeInTheDocument();
  expect(screen.queryByText("原预约与接收记录（只读对照）")).not.toBeInTheDocument();
  expect(document.querySelector(".ant-descriptions")).not.toBeInTheDocument();
  expect(document.querySelectorAll("mark").length).toBeGreaterThan(0);
  expect(vi.mocked(requestJson).mock.calls.every(([, init]) => !init?.method)).toBe(true);
});

it("preserves drafts on failure, reuses unknown requests and saves directly with acknowledged true after validation", async () => {
  let recognitionCount = 0;
  mockRecognition(() => {
    recognitionCount += 1;
    if (recognitionCount === 1) return Promise.reject(new Error("network interrupted"));
    return Promise.resolve({ run: completedRun() });
  });
  render(view());
  await screen.findByText("识别明细");
  fireEvent.click(screen.getByRole("button", { name: "添加手工明细" }));
  fireEvent.change(screen.getByRole("textbox", { name: "明细1 合格证编号" }), { target: { value: "KEEP-MY-DRAFT" } });
  fireEvent.click(screen.getByRole("button", { name: "识别" }));
  await screen.findAllByText("替换本附件的编辑明细？");
  fireEvent.click(screen.getByRole("button", { name: "保留当前明细" }));
  await waitFor(() => expect(screen.queryByRole("button", { name: "保留当前明细" })).not.toBeInTheDocument());
  expect(recognitionCount).toBe(0);
  fireEvent.click(screen.getByRole("button", { name: "识别" }));
  await approveReplacement();
  await screen.findByText("network interrupted");
  expect(screen.getByRole("textbox", { name: "明细1 合格证编号" })).toHaveValue("KEEP-MY-DRAFT");
  fireEvent.click(screen.getByRole("button", { name: "识别" }));
  await approveReplacement();
  await waitFor(() => expect(screen.getByRole("textbox", { name: "明细1 合格证编号" })).toHaveValue("CERT-1"));
  const calls = vi.mocked(requestJson).mock.calls.filter(([url]) => String(url).endsWith("/recognize"));
  expect(JSON.parse(String(calls[0][1]?.body)).requestId).toBe(JSON.parse(String(calls[1][1]?.body)).requestId);
  for (const quantity of ["", "0", "1.5"]) {
    fireEvent.change(screen.getByRole("spinbutton", { name: "明细1 证载数量" }), { target: { value: quantity } });
    fireEvent.click(screen.getByRole("button", { name: "核对并保存" }));
    expect(await screen.findByText("数量须为正整数；未知数量请核对原图后填写，0 行请删除")).toBeInTheDocument();
    expect(requestJson).not.toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ method: "PUT" }));
  }
  fireEvent.change(screen.getByRole("spinbutton", { name: "明细1 证载数量" }), { target: { value: "5" } });
  fireEvent.click(screen.getByRole("button", { name: "核对并保存" }));
  await waitFor(() => expect(saved).toHaveBeenCalledOnce());
  const payload = JSON.parse(
    String(vi.mocked(requestJson).mock.calls.find(([, init]) => init?.method === "PUT")?.[1]?.body),
  );
  expect(payload).toMatchObject({
    expectedBatchUpdatedAt: "batch-v1",
    expectedRegistrationUpdatedAt: null,
    expectedApplicationVersion: "app-v1",
    acknowledged: true,
    lines: [{ certificateNo: "CERT-1", certificateStrain: "ICR 原文", quantity: 5, runId: "run-1" }],
  });
  expect(detail.batch.strain).toBe("ICR");
});

it("appends a newly uploaded PDF without replacing another attachment's saved lines", async () => {
  saveCurrentLines();
  const second = { ...attachment, id: "a2", name: "第二份.pdf" };
  const run = completedRun(3);
  run.attachmentId = "a2";
  run.result!.lines = run.result!.lines.map((line) => ({ ...line, attachmentId: "a2", certificateNo: "SECOND" }));
  vi.mocked(requestMultipart).mockImplementation(() => {
    detail = { ...detail, attachments: [attachment, second] };
    return Promise.resolve({ attachment: second, reused: false });
  });
  mockRecognition(() => Promise.resolve({ run }));
  render(view());
  await screen.findByRole("textbox", { name: "明细1 合格证编号" });
  fireEvent.change(screen.getByRole("textbox", { name: "明细1 合格证编号" }), { target: { value: "KEEP-EDIT" } });
  fireEvent.change(screen.getByLabelText("上传合格证 PDF"), {
    target: { files: [new File(["%PDF"], "第二份.pdf", { type: "application/pdf" })] },
  });
  expect(await screen.findByRole("textbox", { name: "明细2 合格证编号" })).toHaveValue("SECOND");
  expect(screen.getByRole("textbox", { name: "明细1 合格证编号" })).toHaveValue("KEEP-EDIT");
  expect(screen.queryAllByText("替换本附件的编辑明细？")).toHaveLength(0);
});

it("keeps a saved draft when recognition returns no lines", async () => {
  saveCurrentLines();
  const run = completedRun();
  run.result!.lines = [];
  mockRecognition(() => Promise.resolve({ run }));
  render(view());
  await screen.findByRole("textbox", { name: "明细1 合格证编号" });
  fireEvent.click(screen.getByRole("button", { name: "识别" }));
  await approveReplacement();
  await screen.findByText("未识别到可登记明细，原有草稿已保留。请核对原件后重试或手工填写。");
  expect(screen.getByRole("textbox", { name: "明细1 合格证编号" })).toHaveValue("CERT-1");
});

it("shows shared certificate fields once and saves both sex rows without changing their source or receipt links", async () => {
  const male = { ...completedRun(13).result!.lines[0], id: "male", certificateLineIndex: 1, receiptId: "receipt-1" };
  const female = { ...male, id: "female", sex: "雌性", quantity: 8, certificateLineIndex: 2, receiptId: "receipt-2" };
  saveCurrentLines([male, female]);
  render(view());
  const number = await screen.findByRole("textbox", { name: "明细1 合格证编号" });
  expect(screen.queryByRole("textbox", { name: "明细2 合格证编号" })).not.toBeInTheDocument();
  expect(screen.getByRole("spinbutton", { name: "明细1 证载数量" })).toHaveValue("13");
  expect(screen.getByRole("spinbutton", { name: "明细2 证载数量" })).toHaveValue("8");
  expect(screen.getByText("合计 21 只")).toBeInTheDocument();
  number.focus();
  fireEvent.change(number, { target: { value: "CERT-CORRECTED" } });
  expect(number).toHaveFocus();
  fireEvent.click(screen.getByRole("button", { name: "核对并保存" }));
  await waitFor(() => expect(saved).toHaveBeenCalledOnce());
  const payload = JSON.parse(
    String(vi.mocked(requestJson).mock.calls.find(([, init]) => init?.method === "PUT")?.[1]?.body),
  );
  expect(payload.lines).toEqual([
    expect.objectContaining({
      id: "male",
      certificateNo: "CERT-CORRECTED",
      sex: "雄性",
      quantity: 13,
      runId: "run-1",
      receiptId: "receipt-1",
      certificateLineIndex: 1,
    }),
    expect.objectContaining({
      id: "female",
      certificateNo: "CERT-CORRECTED",
      sex: "雌性",
      quantity: 8,
      runId: "run-1",
      receiptId: "receipt-2",
      certificateLineIndex: 2,
    }),
  ]);
});

it("adds an editable sex row within the same certificate without duplicating its quantity", async () => {
  saveCurrentLines();
  render(view());
  await screen.findByRole("textbox", { name: "明细1 合格证编号" });
  fireEvent.click(screen.getByRole("button", { name: "补充性别和数量" }));
  expect(screen.queryByRole("textbox", { name: "明细2 合格证编号" })).not.toBeInTheDocument();
  expect(screen.getByRole("spinbutton", { name: "明细2 证载数量" })).toHaveValue("");
  expect(screen.getByText("合计待确认")).toBeInTheDocument();
  fireEvent.change(screen.getByRole("spinbutton", { name: "明细2 证载数量" }), { target: { value: "8" } });
  expect(screen.getByText("合计 10 只")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "删除明细2" }));
  expect(screen.queryByRole("spinbutton", { name: "明细2 证载数量" })).not.toBeInTheDocument();
  expect(screen.getByText("合计 2 只")).toBeInTheDocument();
});

it("adds a manual certificate and deletes it only after confirmation while preserving another edited draft", async () => {
  saveCurrentLines();
  render(view());
  await screen.findByRole("textbox", { name: "明细1 合格证编号" });
  fireEvent.change(screen.getByRole("textbox", { name: "明细1 合格证编号" }), { target: { value: "KEEP-EDIT" } });
  fireEvent.change(screen.getByRole("textbox", { name: "明细1 登记备注" }), { target: { value: "保留核对备注" } });
  fireEvent.change(screen.getByRole("spinbutton", { name: "明细1 证载数量" }), { target: { value: "5" } });
  fireEvent.click(screen.getByRole("button", { name: "添加手工明细" }));
  expect(screen.getByRole("textbox", { name: "明细2 合格证编号" })).toHaveValue("");
  expect(screen.getByRole("spinbutton", { name: "明细2 证载数量" })).toHaveValue("");
  expect(screen.getByText("未知")).toBeVisible();
  expect(screen.getAllByRole("spinbutton", { name: /证载数量/ })).toHaveLength(2);

  const remove = screen.getByRole("button", { name: "删除合格证2" });
  expect(remove).toHaveTextContent("删除合格证");
  fireEvent.click(remove);
  let confirmation = await screen.findByRole("tooltip");
  await waitFor(() => expect(within(confirmation).getByText("删除这张合格证的登记明细？")).toBeVisible());
  expect(screen.getByRole("textbox", { name: "明细2 合格证编号" })).toBeInTheDocument();
  fireEvent.click(within(confirmation).getByRole("button", { name: "取消" }));
  await waitFor(() => expect(screen.queryByRole("tooltip")).not.toBeInTheDocument());
  expect(screen.getByRole("textbox", { name: "明细2 合格证编号" })).toBeInTheDocument();
  expect(requestJson).not.toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ method: "PUT" }));

  fireEvent.click(screen.getByRole("button", { name: "删除合格证2" }));
  confirmation = await screen.findByRole("tooltip");
  fireEvent.click(within(confirmation).getByRole("button", { name: "删除" }));
  await waitFor(() => expect(screen.queryByRole("textbox", { name: "明细2 合格证编号" })).not.toBeInTheDocument());
  expect(screen.getByRole("textbox", { name: "明细1 合格证编号" })).toHaveValue("KEEP-EDIT");
  expect(screen.getByRole("textbox", { name: "明细1 登记备注" })).toHaveValue("保留核对备注");
  expect(screen.getByRole("spinbutton", { name: "明细1 证载数量" })).toHaveValue("5");
  expect(screen.getAllByRole("button", { name: /^删除合格证\d+$/ })).toHaveLength(1);
  expect(requestJson).not.toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ method: "PUT" }));

  fireEvent.click(screen.getByRole("button", { name: "核对并保存" }));
  await waitFor(() => expect(saved).toHaveBeenCalledOnce());
  const payload = JSON.parse(
    String(vi.mocked(requestJson).mock.calls.find(([, init]) => init?.method === "PUT")?.[1]?.body),
  );
  expect(payload.lines).toEqual([
    expect.objectContaining({ certificateNo: "KEEP-EDIT", notes: "保留核对备注", quantity: 5, runId: "run-1" }),
  ]);
});

it("deletes every sex row in the selected certificate group and preserves another group with the same source index", async () => {
  const male = { ...completedRun(13).result!.lines[0], id: "male", certificateLineIndex: 1, receiptId: "receipt-1" };
  const female = { ...male, id: "female", sex: "雌性", quantity: 8, certificateLineIndex: 2, receiptId: "receipt-2" };
  const other = { ...male, id: "other", certificateNo: "OTHER-CERT", quantity: 4, certificateLineIndex: 3 };
  saveCurrentLines([male, other, female]);
  render(view());
  await screen.findByRole("textbox", { name: "明细1 合格证编号" });
  expect(screen.getByRole("spinbutton", { name: "明细1 证载数量" })).toHaveValue("13");
  expect(screen.getByRole("spinbutton", { name: "明细3 证载数量" })).toHaveValue("8");
  expect(screen.getByRole("textbox", { name: "明细2 合格证编号" })).toHaveValue("OTHER-CERT");
  fireEvent.change(screen.getByRole("textbox", { name: "明细2 登记规格" }), { target: { value: "保留修改规格" } });

  fireEvent.click(screen.getByRole("button", { name: "删除合格证1" }));
  const confirmation = await screen.findByRole("tooltip");
  expect(screen.getByText("合计 21 只")).toBeInTheDocument();
  expect(requestJson).not.toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ method: "PUT" }));
  fireEvent.click(within(confirmation).getByRole("button", { name: "删除" }));
  await waitFor(() => expect(screen.getAllByRole("spinbutton", { name: /证载数量/ })).toHaveLength(1));
  expect(screen.getByRole("textbox", { name: "明细1 合格证编号" })).toHaveValue("OTHER-CERT");
  expect(screen.getByRole("textbox", { name: "明细1 登记规格" })).toHaveValue("保留修改规格");
  expect(screen.getByRole("spinbutton", { name: "明细1 证载数量" })).toHaveValue("4");
  expect(screen.queryByText("合计 21 只")).not.toBeInTheDocument();
  expect(requestJson).not.toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ method: "PUT" }));

  fireEvent.click(screen.getByRole("button", { name: "核对并保存" }));
  await waitFor(() => expect(saved).toHaveBeenCalledOnce());
  const payload = JSON.parse(
    String(vi.mocked(requestJson).mock.calls.find(([, init]) => init?.method === "PUT")?.[1]?.body),
  );
  expect(payload.lines).toEqual([
    expect.objectContaining({
      ...other,
      specification: "保留修改规格",
    }),
  ]);
});

it("discards a late recognition response after closing and prevents duplicate recognition clicks", async () => {
  let finish: (value: { run: ReceptionRecognitionRun }) => void = () => {};
  mockRecognition(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const onClose = vi.fn();
  render(view(<ReceptionCertificateDrawer record={record} onClose={onClose} onSaved={saved} />));
  await screen.findByText("识别明细");
  const recognize = screen.getByRole("button", { name: "识别" });
  fireEvent.click(recognize);
  fireEvent.click(recognize);
  await screen.findByText("正在识别合格证，完成后自动预填…");
  fireEvent.click(screen.getByRole("button", { name: "取消" }));
  await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
  await act(() => Promise.resolve().then(() => finish({ run: completedRun(3) })));
  expect(screen.queryByRole("textbox", { name: "明细1 合格证编号" })).not.toBeInTheDocument();
  expect(vi.mocked(requestJson).mock.calls.filter(([url]) => String(url).endsWith("/recognize"))).toHaveLength(1);
  expect(saved).not.toHaveBeenCalled();
});

it("opens existing saved data without re-recognizing and preserves edits when source versions change", async () => {
  saveCurrentLines();
  render(view());
  await screen.findByRole("textbox", { name: "明细1 合格证编号" });
  expect(requestMultipart).not.toHaveBeenCalled();
  expect(requestJson).not.toHaveBeenCalledWith(expect.stringContaining("/recognize"), expect.anything());
  fireEvent.change(screen.getByRole("textbox", { name: "明细1 合格证编号" }), { target: { value: "KEEP" } });
  detail = { ...detail, batch: { ...record, updatedAt: "batch-v2" } };
  await act(async () => {
    await client.invalidateQueries({ queryKey: queryKeys.receptionRegistration("b1") });
  });
  expect(await screen.findByText("预约、申请汇总表或登记版本已变化")).toBeInTheDocument();
  expect(screen.getByRole("textbox", { name: "明细1 合格证编号" })).toHaveValue("KEEP");
  expect(screen.getByRole("button", { name: "核对并保存" })).toBeDisabled();
});

it("retains edited recognition lines when refreshed recognition data changes its source", async () => {
  const run = completedRun(2);
  saveCurrentLines(run.result!.lines);
  detail = { ...detail, runs: [run] };
  render(view());
  await screen.findByRole("textbox", { name: "明细1 合格证编号" });
  fireEvent.change(screen.getByRole("textbox", { name: "明细1 合格证编号" }), { target: { value: "KEEP-EDIT" } });
  detail = {
    ...detail,
    runs: [
      {
        ...run,
        sourceBatchUpdatedAt: "older-batch",
        result: { lines: [{ ...run.result!.lines[0], certificateNo: "BACKGROUND-RESULT" }], warnings: [] },
      },
    ],
  };
  await act(async () => {
    await client.invalidateQueries({ queryKey: queryKeys.receptionRegistration("b1") });
  });
  expect(await screen.findByText("识别或登记所依据的预约版本已变化")).toBeInTheDocument();
  expect(screen.getByRole("textbox", { name: "明细1 合格证编号" })).toHaveValue("KEEP-EDIT");
  expect(screen.getByRole("button", { name: "核对并保存" })).toBeEnabled();
});

it("shows original evidence and saved lines as read-only and never uploads an initial file without write permission", async () => {
  saveCurrentLines();
  detail = { ...detail, canWrite: false };
  render(
    view(
      <ReceptionCertificateDrawer
        record={record}
        initialFile={new File(["%PDF"], "合格证.pdf", { type: "application/pdf" })}
        onClose={vi.fn()}
        onSaved={saved}
      />,
    ),
  );
  await screen.findByText("当前账号仅可查看合格证及已确认登记");
  expect(screen.getByRole("link", { name: "下载" })).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "上传" })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "识别" })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "核对并保存" })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /^删除合格证\d+$/ })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /^删除明细\d+$/ })).not.toBeInTheDocument();
  expect(screen.getByRole("textbox", { name: "明细1 合格证编号" })).toBeDisabled();
  expect(requestMultipart).not.toHaveBeenCalled();
});
