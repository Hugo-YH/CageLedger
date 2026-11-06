import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { BillingStatementResponse, SettlementCandidate, SessionUser } from "../../../api/contracts";
import { requestJson } from "../../../api/client";
import { SettlementCandidateActions } from "./SettlementCandidateActions";
import { SettlementPreviewProvider } from "./SettlementPreviewProvider";

vi.mock("../../../api/client", () => ({
  requestDownload: vi.fn(),
  requestJson: vi.fn(),
  requestMultipart: vi.fn(),
}));

vi.mock("antd", () => ({
  Alert: ({ title }: { title: ReactNode }) => <div role="status">{title}</div>,
  Button: ({
    children,
    disabled,
    loading,
    onClick,
  }: {
    children: ReactNode;
    disabled?: boolean;
    loading?: boolean;
    onClick?: () => void;
  }) => (
    <button type="button" data-loading={loading ? "true" : "false"} disabled={disabled} onClick={onClick}>
      {children}
    </button>
  ),
  Space: ({ children }: { children: ReactNode }) => <span>{children}</span>,
  Tooltip: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

vi.mock("../../../components/ui", () => ({
  ModalPresence: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

vi.mock("./SettlementPreviewModal", () => ({
  SettlementPreviewModal: ({
    selected,
    result,
    loading,
    error,
    onClose,
    afterClose,
    onRetry,
    onStartSettlement,
  }: {
    selected: SettlementCandidate;
    result: BillingStatementResponse | null;
    loading: boolean;
    error: string;
    onClose: () => void;
    afterClose?: () => void;
    onRetry: () => void;
    onStartSettlement: () => void;
  }) => (
    <section aria-label={`预览 ${selected.id}`}>
      <p>{loading ? "正在加载结算预览" : `审阅版本 ${result?.sourceVersions?.["service-1"] || "feeding"}`}</p>
      {error ? <p role="alert">{error}</p> : null}
      <button
        type="button"
        onClick={() => {
          onClose();
          afterClose?.();
        }}
      >
        关闭预览
      </button>
      <button type="button" onClick={onRetry}>
        重试预览
      </button>
      <button type="button" onClick={onStartSettlement}>
        生成通知邮件
      </button>
    </section>
  ),
}));

vi.mock("./SettlementNoticeModal", () => ({
  SettlementNoticeModal: ({
    error,
    pending,
    onCancel,
    onConfirm,
  }: {
    pending: boolean;
    error?: string;
    onCancel: () => void;
    onConfirm: () => void;
  }) => (
    <section aria-label="结算通知">
      {error ? <div role="alert">{error}</div> : null}
      <button type="button" disabled={pending} onClick={onConfirm}>
        确认发起
      </button>
      <button type="button" onClick={onCancel}>
        取消通知
      </button>
    </section>
  ),
}));

const user: SessionUser = {
  id: "admin",
  username: "admin",
  displayName: "管理员",
  phone: "13800000000",
  role: "admin",
  roomIds: [],
  active: true,
  updatedAt: "2026-10-01",
};

const feedingCandidate = (id: string): SettlementCandidate => ({
  id,
  month: "2026-10",
  pi: `负责人${id}`,
  iacucs: ["Z2026001"],
  manager: "登记人员",
  totalAmount: 100,
});
const serviceCandidate: SettlementCandidate = {
  ...feedingCandidate("service"),
  feeType: "technical_service",
  sourceType: "pi_merged_technical_service",
};

function statement(sourceVersions?: Record<string, string>): BillingStatementResponse {
  return {
    statement: {
      month: "2026-10",
      iacuc: "Z2026001",
      project: "项目",
      pi: "负责人service",
      owner: "实验负责人",
      funding: "经费",
      sourceType: sourceVersions ? "pi_merged_technical_service" : "quantity_sheet",
      totalCageDays: 1,
      totalAnimalDays: 0,
      totalFreeCageDays: 0,
      totalBillableCageDays: 1,
      totalAmount: 100,
    },
    lines: [],
    sourceVersions,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

function renderProvider(children: ReactNode) {
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false }, queries: { retry: false } } });
  const view = render(
    <QueryClientProvider client={client}>
      <SettlementPreviewProvider source="quantity_sheet" user={user} exportPdf={vi.fn()} pdfExporting={false}>
        {children}
      </SettlementPreviewProvider>
    </QueryClientProvider>,
  );
  return { ...view, client };
}

describe("SettlementPreviewProvider", () => {
  beforeEach(() => vi.mocked(requestJson).mockReset());
  afterEach(() => cleanup());

  it("aborts a closed preview and lets another row load without an old finally clearing its pending state", async () => {
    const pending = deferred<BillingStatementResponse>();
    const next = deferred<BillingStatementResponse>();
    vi.mocked(requestJson).mockReturnValueOnce(pending.promise).mockReturnValueOnce(next.promise);
    renderProvider(
      <>
        <SettlementCandidateActions candidate={feedingCandidate("one")} />
        <SettlementCandidateActions candidate={feedingCandidate("two")} />
      </>,
    );
    const [first, second] = screen.getAllByRole("button", { name: "预览结算单" });
    first.focus();
    fireEvent.click(first);

    expect(screen.getByLabelText("预览 one")).toHaveTextContent("正在加载结算预览");
    await waitFor(() => expect(first).toHaveAttribute("data-loading", "true"));
    expect(second).toHaveAttribute("data-loading", "false");
    expect(second).toBeDisabled();
    fireEvent.click(second);
    expect(requestJson).toHaveBeenCalledOnce();

    fireEvent.click(screen.getByRole("button", { name: "关闭预览" }));
    expect(first).toHaveFocus();
    const oldSignal = vi.mocked(requestJson).mock.calls[0][1]?.signal;
    expect(oldSignal?.aborted).toBe(true);
    expect(second).toBeEnabled();
    fireEvent.click(second);
    expect(screen.getByLabelText("预览 two")).toHaveTextContent("正在加载结算预览");
    await waitFor(() => expect(requestJson).toHaveBeenCalledTimes(2));
    await act(async () => {
      pending.resolve(statement());
      await pending.promise;
    });
    expect(screen.queryByLabelText("预览 one")).not.toBeInTheDocument();
    expect(screen.getByLabelText("预览 two")).toHaveTextContent("正在加载结算预览");
    expect(second).toHaveAttribute("data-loading", "true");
    expect(first).toBeDisabled();
    expect(vi.mocked(requestJson).mock.calls[1][1]?.signal?.aborted).toBe(false);
    await act(async () => {
      next.resolve(statement({ "service-1": "current" }));
      await next.promise;
    });
    expect(screen.getByLabelText("预览 two")).toHaveTextContent("审阅版本 current");
  });

  it("ignores a closed preview failure after a newer preview succeeds and aborts reads on unmount", async () => {
    const old = deferred<BillingStatementResponse>();
    const next = deferred<BillingStatementResponse>();
    vi.mocked(requestJson)
      .mockReturnValueOnce(old.promise)
      .mockResolvedValueOnce(statement({ "service-1": "new" }))
      .mockReturnValueOnce(next.promise);
    const view = renderProvider(
      <>
        <SettlementCandidateActions candidate={feedingCandidate("one")} />
        <SettlementCandidateActions candidate={feedingCandidate("two")} />
      </>,
    );
    const [first, second] = screen.getAllByRole("button", { name: "预览结算单" });
    fireEvent.click(first);
    await waitFor(() => expect(requestJson).toHaveBeenCalledOnce());
    fireEvent.click(screen.getByRole("button", { name: "关闭预览" }));
    fireEvent.click(second);
    await screen.findByText("审阅版本 new");
    await act(async () => {
      old.reject(new Error("旧预览错误"));
      await old.promise.catch(() => undefined);
    });
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByLabelText("预览 two")).toHaveTextContent("审阅版本 new");
    fireEvent.click(screen.getByRole("button", { name: "关闭预览" }));
    fireEvent.click(first);
    await waitFor(() => expect(requestJson).toHaveBeenCalledTimes(3));
    const signal = vi.mocked(requestJson).mock.calls[2][1]?.signal;
    view.unmount();
    expect(signal?.aborted).toBe(true);
    await act(async () => {
      next.resolve(statement());
      await next.promise;
    });
  });

  it("lets an initiated write finish and reconcile caches after the preview workspace unmounts", async () => {
    const write = deferred<BillingStatementResponse>();
    vi.mocked(requestJson)
      .mockResolvedValueOnce(statement({ "service-1": "v1" }))
      .mockResolvedValueOnce(statement({ "service-1": "v2" }))
      .mockReturnValueOnce(write.promise);
    const view = renderProvider(<SettlementCandidateActions candidate={serviceCandidate} />);
    const invalidate = vi.spyOn(view.client, "invalidateQueries").mockResolvedValue();
    fireEvent.click(screen.getByRole("button", { name: "预览结算单" }));
    await screen.findByText("审阅版本 v1");
    fireEvent.click(screen.getByRole("button", { name: "生成通知邮件" }));
    await screen.findByLabelText("结算通知");
    fireEvent.click(screen.getByRole("button", { name: "确认发起" }));
    await waitFor(() => expect(requestJson).toHaveBeenCalledTimes(3));
    expect(vi.mocked(requestJson).mock.calls[2][1]).not.toHaveProperty("signal");
    const reviewedSignal = vi.mocked(requestJson).mock.calls[1][1]?.signal;
    view.unmount();
    expect(reviewedSignal?.aborted).toBe(false);
    await act(async () => {
      write.resolve(statement({ "service-1": "v2" }));
      await write.promise;
    });
    expect(invalidate).toHaveBeenCalledTimes(7);
  });

  it("keeps the failed preview open and retries the same candidate", async () => {
    vi.mocked(requestJson).mockRejectedValueOnce(new Error("预览服务失败")).mockResolvedValueOnce(statement());
    renderProvider(<SettlementCandidateActions candidate={feedingCandidate("retry")} />);
    fireEvent.click(screen.getByRole("button", { name: "预览结算单" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("预览服务失败");

    fireEvent.click(screen.getByRole("button", { name: "重试预览" }));
    await waitFor(() => expect(screen.getByLabelText("预览 retry")).toHaveTextContent("审阅版本 feeding"));
    expect(requestJson).toHaveBeenCalledTimes(2);
  });

  it("initiates technical-service settlement with the second reviewed sourceVersions and ignores double confirmation", async () => {
    vi.mocked(requestJson)
      .mockResolvedValueOnce(statement({ "service-1": "v1" }))
      .mockResolvedValueOnce(statement({ "service-1": "v2" }))
      .mockResolvedValueOnce(statement({ "service-1": "v2" }));
    renderProvider(<SettlementCandidateActions candidate={serviceCandidate} />);
    fireEvent.click(screen.getByRole("button", { name: "预览结算单" }));
    await screen.findByText("审阅版本 v1");
    fireEvent.click(screen.getByRole("button", { name: "生成通知邮件" }));
    await screen.findByLabelText("结算通知");

    const confirm = screen.getByRole("button", { name: "确认发起" });
    fireEvent.click(confirm);
    fireEvent.click(confirm);
    await waitFor(() => expect(requestJson).toHaveBeenCalledTimes(3));
    expect(requestJson).toHaveBeenNthCalledWith(3, "/api/technical-services/settlements", {
      method: "POST",
      body: JSON.stringify({
        pi: serviceCandidate.pi,
        month: serviceCandidate.month,
        sourceVersions: { "service-1": "v2" },
      }),
    });
  });

  it("retains the second reviewed technical-service result when initiation fails", async () => {
    vi.mocked(requestJson)
      .mockResolvedValueOnce(statement({ "service-1": "v1" }))
      .mockResolvedValueOnce(statement({ "service-1": "v2" }))
      .mockRejectedValueOnce(new Error("来源版本已变化"));
    renderProvider(<SettlementCandidateActions candidate={serviceCandidate} />);
    fireEvent.click(screen.getByRole("button", { name: "预览结算单" }));
    await screen.findByText("审阅版本 v1");
    fireEvent.click(screen.getByRole("button", { name: "生成通知邮件" }));
    await screen.findByLabelText("结算通知");
    fireEvent.click(screen.getByRole("button", { name: "确认发起" }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("来源版本已变化"));

    fireEvent.click(screen.getByRole("button", { name: "取消通知" }));
    expect(screen.getByLabelText("预览 service")).toHaveTextContent("审阅版本 v2");
    expect(requestJson).toHaveBeenCalledTimes(3);
  });
});

const operationFeedback = vi.hoisted(() => ({
  success: vi.fn(),
  info: vi.fn(),
  warning: vi.fn(),
  error: vi.fn(),
  message: { success: vi.fn(), info: vi.fn(), warning: vi.fn(), error: vi.fn() },
}));
vi.mock("../../../hooks/useOperationFeedback", () => ({ useOperationFeedback: () => operationFeedback }));
