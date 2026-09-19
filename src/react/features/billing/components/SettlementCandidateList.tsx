import { Alert, Button, Empty, Space, Typography } from "antd";
import { useRef, useState } from "react";

import { buildSettlementNoticeEmail, type SettlementNoticeEmail } from "../../../../domain/settlementNotice";
import type {
  BillingStatementResponse,
  SessionUser,
  SettlementCandidate,
  SettlementCandidateListParams,
} from "../../../api/contracts";
import { exportSettlementXlsx, useSettlementCandidates } from "../../../api/billing";
import { useAdvanceWorkflow } from "../../../api/workflows";
import { useSettlementBatch } from "../../../api/useSettlementBatch";
import { useLatestRequest } from "../../../hooks/useLatestRequest";
import { useSelectionScope } from "../../../hooks/useSelectionScope";
import { PageSkeleton, Pager } from "../../../components/WorkspaceUi";
import { DataTable } from "../../../components/ui";
import { useGenerateBillingStatement } from "../../../api/quantitySheets";
import { usePdfExport } from "../hooks/usePdfExport";
import { useSettlementSelection } from "../hooks/useSettlementSelection";
import { BatchStartConfirmModal } from "./BatchStartConfirmModal";
import { BatchWithdrawConfirmModal } from "./BatchWithdrawConfirmModal";
import { SettlementBatchToolbar } from "./SettlementBatchToolbar";
import { SettlementNoticeModal } from "./SettlementNoticeModal";
import { SettlementPreviewModal } from "./SettlementPreviewModal";
import { buildSettlementColumns } from "./settlementCandidateColumns";

export function SettlementCandidateList({
  source,
  user,
}: {
  source: "quantity_sheet" | "cage_map";
  user: SessionUser;
}) {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [sort, setSort] = useState<{
    key: SettlementCandidateListParams["sortKey"];
    dir: "asc" | "desc";
  }>({ key: "month", dir: "desc" });
  const [filters, setFilters] = useState<Record<string, string[]>>({});
  const selection = useSettlementSelection();
  const { selectedCandidates, allFilteredSelected, selectingAll } = selection;
  const [selected, setSelected] = useState<SettlementCandidate | null>(null);
  const [result, setResult] = useState<BillingStatementResponse | null>(null);
  const [noticeEmail, setNoticeEmail] = useState<{
    candidate: SettlementCandidate;
    email: SettlementNoticeEmail;
  } | null>(null);
  const [notice, setNotice] = useState("");
  const [noticeKind, setNoticeKind] = useState<"success" | "error" | "info">("info");
  const [batchConfirmOpen, setBatchConfirmOpen] = useState(false);
  const [batchWithdrawOpen, setBatchWithdrawOpen] = useState(false);
  const [batchAction, setBatchAction] = useState<"start" | "withdraw" | null>(null);
  const batchActionRef = useRef<"start" | "withdraw" | null>(null);
  const batch = useSettlementBatch();
  const batchStarting = batchAction === "start";
  const batchWithdrawing = batchAction === "withdraw";
  const [xlsxExporting, setXlsxExporting] = useState(false);
  const pdfExport = usePdfExport();
  const previewRequest = useLatestRequest();
  const generating = useRef(false);
  const exportingXlsx = useRef(false);

  useSelectionScope(
    JSON.stringify({ source, filters }),
    () => {
      selection.clear();
      if (!batchActionRef.current) {
        setBatchConfirmOpen(false);
        setBatchWithdrawOpen(false);
      }
    },
    selectedCandidates.length > 0 || selectingAll,
  );

  function showNotice(message: string, kind: "success" | "error" | "info" = "info") {
    setNotice(message);
    setNoticeKind(kind);
  }

  const params: SettlementCandidateListParams = {
    limit: pageSize,
    offset: (page - 1) * pageSize,
    sortKey: sort.key,
    sortDir: sort.dir,
    columnFilters: filters,
  };
  const list = useSettlementCandidates(params, source === "quantity_sheet");
  const generate = useGenerateBillingStatement();
  const advanceWorkflow = useAdvanceWorkflow();
  const items = list.data?.items || [];
  const total = list.data?.page.total || 0;
  const pages = Math.max(Math.ceil(total / pageSize), 1);

  const columns = buildSettlementColumns({
    allFilteredSelected,
    filters,
    params,
    previewing: generate.isPending,
    selectedCandidates,
    selectingAll,
    disabled: list.isPlaceholderData || batch.isPending,
    total,
    onFilter: (column, values) => {
      setFilters((current) => ({ ...current, [column]: values }));
      setPage(1);
    },
    onPreview: (candidate) => void generateFor(candidate, false),
    onSort: (column) => {
      setSort((current) => ({
        key: column,
        dir: current.key === column && current.dir === "asc" ? "desc" : "asc",
      }));
      setPage(1);
    },
    onToggle: selection.toggle,
    onToggleAll: () => void selection.toggleAll(params),
  });

  async function revertFor(candidate: SettlementCandidate) {
    if (!candidate.workflowId) return;
    try {
      await advanceWorkflow.mutateAsync({
        workflowId: candidate.workflowId,
        toStatus: "statement_generated",
        note: "退回已生成",
      });
      setSelected(null);
      setResult(null);
      showNotice(`${candidate.pi} ${candidate.month} 的结算流程已撤回，退回已生成状态。`, "success");
    } catch (error) {
      showNotice(error instanceof Error ? error.message : "撤回结算流程失败", "error");
    }
  }

  async function generateFor(candidate: SettlementCandidate, persist: boolean): Promise<boolean> {
    if (generating.current) return false;
    generating.current = true;
    const isCurrent = previewRequest.begin();
    try {
      const response = await generate.mutateAsync({
        month: candidate.month,
        pi: candidate.pi,
        sourceType: source,
        persist,
      });
      if (!isCurrent()) return false;
      setSelected(candidate);
      setResult(response);
      showNotice(persist ? "结算流程已发起，可到单据跟踪继续处理。" : "结算预览已生成。", "success");
      return true;
    } catch (error) {
      if (isCurrent()) showNotice(error instanceof Error ? error.message : "生成结算单失败", "error");
      return false;
    } finally {
      generating.current = false;
    }
  }

  async function prepareNoticeEmail(candidate: SettlementCandidate) {
    if (generating.current) return;
    generating.current = true;
    const isCurrent = previewRequest.begin();
    try {
      const response = await generate.mutateAsync({
        month: candidate.month,
        pi: candidate.pi,
        sourceType: source,
        persist: false,
      });
      if (!isCurrent()) return;
      setSelected(candidate);
      setResult(response);
      if (!response.statement) return;
      setNoticeEmail({
        candidate,
        email: buildSettlementNoticeEmail({
          month: response.statement.month,
          totalAmount: response.statement.totalAmount,
          staffName: user.displayName,
          staffPhone: user.phone,
        }),
      });
      showNotice("请复制通知邮件并确认发起结算流程。", "info");
    } catch (error) {
      if (isCurrent()) showNotice(error instanceof Error ? error.message : "生成结算单失败", "error");
    } finally {
      generating.current = false;
    }
  }

  async function confirmNoticeEmail() {
    if (!noticeEmail) return;
    const ok = await generateFor(noticeEmail.candidate, true);
    if (ok) {
      setNoticeEmail(null);
      // 预览弹窗立即反映已发起状态，无需退出重新进入。
      setSelected((current) =>
        current ? { ...current, hasWorkflow: true, workflowStatus: "statement_sent" } : current,
      );
    }
  }

  async function exportCandidates(candidates: SettlementCandidate[]) {
    setNotice("");
    try {
      await pdfExport.exportPdf({
        kind: "billing_statement",
        items: candidates.map((candidate) => ({ month: candidate.month, pi: candidate.pi, sourceType: source })),
      });
    } catch (error) {
      showNotice(error instanceof Error ? error.message : "PDF 导出失败", "error");
    }
  }

  async function exportCandidatesXlsx(candidates: SettlementCandidate[]) {
    if (exportingXlsx.current) return;
    exportingXlsx.current = true;
    setXlsxExporting(true);
    setNotice("");
    try {
      showNotice(`正在导出 ${candidates.length > 1 ? `${candidates.length} 份` : ""}Excel…`, "info");
      const filename = await exportSettlementXlsx(
        candidates.map((candidate) => ({ month: candidate.month, pi: candidate.pi, sourceType: source })),
      );
      showNotice(`已导出 Excel：${filename}`, "success");
    } catch (error) {
      showNotice(error instanceof Error ? error.message : "Excel 导出失败", "error");
    } finally {
      exportingXlsx.current = false;
      setXlsxExporting(false);
    }
  }

  async function runSelectedBatch(action: "start" | "withdraw") {
    if (batchActionRef.current) return;
    const candidates = selectedCandidates.filter((candidate) =>
      action === "start"
        ? candidate.totalAmount != null &&
          (!candidate.hasWorkflow || candidate.workflowStatus === "statement_generated")
        : candidate.hasWorkflow &&
          (candidate.workflowStatus === "statement_generated" || candidate.workflowStatus === "statement_sent"),
    );
    if (!candidates.length) return;
    batchActionRef.current = action;
    setBatchAction(action);
    setNotice("");
    const verb = action === "start" ? "发起" : "撤回";
    try {
      const result = await batch.run(candidates.map((candidate) => ({ candidate, action, source })));
      selection.removeCompleted(new Set(result.completed.map((item) => item.candidate.id)));
      const failures = result.failures.map(({ item, message }) => `${item.candidate.pi}（${message}）`);
      showNotice(
        failures.length
          ? `已${verb} ${result.completed.length} 个结算流程；${failures.length} 个未完成：${failures.join("、")}`
          : action === "start"
            ? `已发起 ${result.completed.length} 个结算流程，可到单据跟踪继续处理。`
            : `已撤回 ${result.completed.length} 个结算流程，可重新发起结算。`,
        failures.length ? "error" : "success",
      );
    } catch (error) {
      showNotice(`批量结果未能同步，请刷新列表确认：${error instanceof Error ? error.message : "同步失败"}`, "error");
    } finally {
      batchActionRef.current = null;
      setBatchAction(null);
      setBatchConfirmOpen(false);
      setBatchWithdrawOpen(false);
    }
  }

  if (source === "cage_map") {
    return (
      <Empty
        className="settlement-candidate-empty"
        description={
          <Space orientation="vertical" size={4}>
            <Typography.Text strong>动态笼位图结算正在调试</Typography.Text>
            <Typography.Text type="secondary">请切换到“录入数量统计表”查看结算管理候选列表。</Typography.Text>
          </Space>
        }
        image={Empty.PRESENTED_IMAGE_SIMPLE}
      />
    );
  }

  if (list.isPending) return <PageSkeleton embedded label="结算管理" variant="table" />;
  if (list.isError)
    return (
      <Alert
        role="alert"
        type="error"
        showIcon
        title={`结算列表加载失败：${list.error.message}`}
        action={<Button onClick={() => void list.refetch()}>重试</Button>}
      />
    );

  const allSelectedNonInitiative =
    selectedCandidates.length > 0 &&
    selectedCandidates.every((item) => item.hasWorkflow && item.workflowStatus !== "statement_generated");
  const withdrawableSelected = selectedCandidates.filter(
    (candidate) =>
      candidate.hasWorkflow &&
      (candidate.workflowStatus === "statement_generated" || candidate.workflowStatus === "statement_sent"),
  );
  return (
    <>
      {selection.error ? <Alert role="alert" type="error" showIcon title={selection.error} /> : null}
      {notice || pdfExport.isExporting || xlsxExporting || batchStarting || batchWithdrawing ? (
        <Alert
          title={
            notice ||
            (pdfExport.isExporting
              ? settlementExportProgress(pdfExport.job?.completed, pdfExport.job?.total)
              : xlsxExporting
                ? "正在导出 Excel，完成后自动下载…"
                : batchStarting
                  ? `正在发起结算 ${batch.completed}/${batch.total}`
                  : batchWithdrawing
                    ? `正在撤回结算流程 ${batch.completed}/${batch.total}`
                    : "")
          }
          role={noticeKind === "error" ? "alert" : "status"}
          showIcon
          type={notice ? (noticeKind === "error" ? "error" : noticeKind === "success" ? "success" : "info") : "info"}
        />
      ) : null}
      <SettlementBatchToolbar
        allSelectedNonInitiative={allSelectedNonInitiative}
        disabled={list.isPlaceholderData || batch.isPending}
        batchStarting={batchStarting}
        batchWithdrawing={batchWithdrawing}
        pdfExporting={pdfExport.isExporting}
        selectedCount={selectedCandidates.length}
        selectingAll={selectingAll}
        total={total}
        withdrawableCount={withdrawableSelected.length}
        xlsxExporting={xlsxExporting}
        onExportPdf={() => void exportCandidates(selectedCandidates)}
        onExportXlsx={() => void exportCandidatesXlsx(selectedCandidates)}
        onInitiate={() => setBatchConfirmOpen(true)}
        onWithdraw={() => setBatchWithdrawOpen(true)}
        onClear={selection.clear}
      />
      <div
        className="ant-table-region settlement-candidate-list"
        role="region"
        tabIndex={0}
        aria-busy={list.isFetching}
        aria-label="结算管理列表"
      >
        <DataTable
          refreshing={list.isFetching}
          columns={columns}
          dataSource={items}
          pagination={false}
          resizeKey="settlement-candidates"
          rowKey="id"
        />
      </div>
      <Pager
        itemLabel="项"
        page={page}
        pageSize={pageSize}
        pages={pages}
        total={total}
        onPage={(nextPage) => {
          setPage(nextPage);
        }}
        onPageSize={(nextSize) => {
          setPageSize(nextSize);
          setPage(1);
        }}
      />
      <BatchStartConfirmModal
        count={
          selectedCandidates.filter((item) => !item.hasWorkflow || item.workflowStatus === "statement_generated").length
        }
        open={batchConfirmOpen}
        pending={batchStarting}
        onCancel={() => {
          if (!batchStarting) setBatchConfirmOpen(false);
        }}
        onConfirm={() => void runSelectedBatch("start")}
      />
      <BatchWithdrawConfirmModal
        count={withdrawableSelected.length}
        open={batchWithdrawOpen}
        pending={batchWithdrawing}
        onCancel={() => {
          if (!batchWithdrawing) setBatchWithdrawOpen(false);
        }}
        onConfirm={() => void runSelectedBatch("withdraw")}
      />
      {selected && result ? (
        <SettlementPreviewModal
          generatePending={generate.isPending}
          hasWorkflow={Boolean(selected.hasWorkflow)}
          revertPending={advanceWorkflow.isPending}
          workflowStatus={selected.workflowStatus}
          notice={notice}
          noticeKind={noticeKind}
          pdfExporting={pdfExport.isExporting}
          result={result}
          selected={selected}
          onClose={() => {
            previewRequest.invalidate();
            setSelected(null);
          }}
          onExportPdf={() => void exportCandidates([selected])}
          onRevert={() => void revertFor(selected)}
          onStartSettlement={() => void prepareNoticeEmail(selected)}
        />
      ) : null}
      {noticeEmail ? (
        <SettlementNoticeModal
          email={noticeEmail.email}
          pending={generate.isPending}
          onCancel={() => {
            previewRequest.invalidate();
            setNoticeEmail(null);
          }}
          onConfirm={() => void confirmNoticeEmail()}
        />
      ) : null}
    </>
  );
}

function settlementExportProgress(completed = 0, total = 0) {
  return total > 1 ? `正在导出 ${completed}/${total}` : "PDF 正在生成，完成后自动下载。";
}
