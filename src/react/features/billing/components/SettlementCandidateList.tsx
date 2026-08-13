import { Alert, Empty, Space, Typography } from "antd";
import { useState } from "react";

import { buildSettlementNoticeEmail, type SettlementNoticeEmail } from "../../../../domain/settlementNotice";
import type {
  BillingStatementResponse,
  SessionUser,
  SettlementCandidate,
  SettlementCandidateListParams,
} from "../../../api/contracts";
import { exportSettlementXlsx, listAllSettlementCandidates, useSettlementCandidates } from "../../../api/billing";
import { useAdvanceWorkflow, useDeleteBillingWorkflow } from "../../../api/workflows";
import { Pager } from "../../../components/WorkspaceUi";
import { DataTable } from "../../../components/ui";
import { useGenerateBillingStatement } from "../../../api/quantitySheets";
import { usePdfExport } from "../hooks/usePdfExport";
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
  const [selectedCandidates, setSelectedCandidates] = useState<SettlementCandidate[]>([]);
  const [selected, setSelected] = useState<SettlementCandidate | null>(null);
  const [result, setResult] = useState<BillingStatementResponse | null>(null);
  const [noticeEmail, setNoticeEmail] = useState<{
    candidate: SettlementCandidate;
    email: SettlementNoticeEmail;
  } | null>(null);
  const [notice, setNotice] = useState("");
  const [noticeKind, setNoticeKind] = useState<"success" | "error" | "info">("info");
  const [batchConfirmOpen, setBatchConfirmOpen] = useState(false);
  const [batchStarting, setBatchStarting] = useState(false);
  const [batchWithdrawOpen, setBatchWithdrawOpen] = useState(false);
  const [batchWithdrawing, setBatchWithdrawing] = useState(false);
  const [batchProgress, setBatchProgress] = useState({ completed: 0, total: 0 });
  const [xlsxExporting, setXlsxExporting] = useState(false);
  const [selectingAll, setSelectingAll] = useState(false);
  const [allFilteredSelected, setAllFilteredSelected] = useState(false);
  const pdfExport = usePdfExport();

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
  const withdrawWorkflow = useDeleteBillingWorkflow();
  const advanceWorkflow = useAdvanceWorkflow();
  const items = list.data?.items || [];
  const total = list.data?.page.total || 0;
  const pages = Math.max(Math.ceil(total / pageSize), 1);

  async function toggleAllFiltered() {
    if (allFilteredSelected) {
      setSelectedCandidates([]);
      setAllFilteredSelected(false);
      return;
    }
    setSelectingAll(true);
    setAllFilteredSelected(true);
    setNotice("");
    try {
      const candidates = await listAllSettlementCandidates(params);
      setSelectedCandidates(candidates.filter((candidate) => candidate.totalAmount != null));
      setAllFilteredSelected(true);
    } catch (error) {
      setAllFilteredSelected(false);
      showNotice(error instanceof Error ? error.message : "无法读取全部结算项", "error");
    } finally {
      setSelectingAll(false);
    }
  }

  function toggleCandidate(candidate: SettlementCandidate, checked: boolean) {
    setAllFilteredSelected(false);
    setSelectedCandidates((current) =>
      checked
        ? [...current.filter((item) => item.id !== candidate.id), candidate]
        : current.filter((item) => item.id !== candidate.id),
    );
  }

  const columns = buildSettlementColumns({
    allFilteredSelected,
    filters,
    params,
    previewing: generate.isPending,
    selectedCandidates,
    selectingAll,
    total,
    onFilter: (column, values) => {
      setFilters((current) => ({ ...current, [column]: values }));
      setSelectedCandidates([]);
      setAllFilteredSelected(false);
      setPage(1);
    },
    onPreview: (candidate) => void generateFor(candidate, false),
    onSort: (column) => {
      setSort((current) => ({
        key: column as SettlementCandidateListParams["sortKey"],
        dir: current.key === column && current.dir === "asc" ? "desc" : "asc",
      }));
      setPage(1);
    },
    onToggle: (candidate, checked) => toggleCandidate(candidate, checked),
    onToggleAll: () => void toggleAllFiltered(),
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
    try {
      const response = await generate.mutateAsync({
        month: candidate.month,
        pi: candidate.pi,
        sourceType: source,
        persist,
      });
      setSelected(candidate);
      setResult(response);
      showNotice(persist ? "结算流程已发起，可到单据跟踪继续处理。" : "结算预览已生成。", "success");
      return true;
    } catch (error) {
      showNotice(error instanceof Error ? error.message : "生成结算单失败", "error");
      return false;
    }
  }

  async function prepareNoticeEmail(candidate: SettlementCandidate) {
    try {
      const response = await generate.mutateAsync({
        month: candidate.month,
        pi: candidate.pi,
        sourceType: source,
        persist: false,
      });
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
      showNotice(error instanceof Error ? error.message : "生成结算单失败", "error");
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
      setXlsxExporting(false);
    }
  }

  async function startSelectedCandidates() {
    const candidates = selectedCandidates.filter(
      (candidate) =>
        candidate.totalAmount != null && (!candidate.hasWorkflow || candidate.workflowStatus === "statement_generated"),
    );
    if (!candidates.length) return;
    setBatchStarting(true);
    setBatchProgress({ completed: 0, total: candidates.length });
    setNotice("");
    const completedIds: string[] = [];
    const failures: string[] = [];
    for (let index = 0; index < candidates.length; index += 1) {
      const candidate = candidates[index];
      try {
        await generate.mutateAsync({ month: candidate.month, pi: candidate.pi, sourceType: source, persist: true });
        completedIds.push(candidate.id);
      } catch (error) {
        failures.push(`${candidate.pi}（${error instanceof Error ? error.message : "生成失败"}）`);
      }
      setBatchProgress((current) => ({ ...current, completed: current.completed + 1 }));
    }
    setSelectedCandidates((current) => current.filter((candidate) => !completedIds.includes(candidate.id)));
    setAllFilteredSelected(false);
    setBatchStarting(false);
    setBatchConfirmOpen(false);
    showNotice(
      failures.length
        ? `已发起 ${completedIds.length} 个结算流程；${failures.length} 个未完成：${failures.join("、")}`
        : `已发起 ${completedIds.length} 个结算流程，可到单据跟踪继续处理。`,
      failures.length ? "error" : "success",
    );
  }

  async function withdrawSelectedCandidates() {
    const candidates = selectedCandidates.filter(
      (candidate) =>
        candidate.hasWorkflow &&
        (candidate.workflowStatus === "statement_generated" || candidate.workflowStatus === "statement_sent"),
    );
    if (!candidates.length) return;
    setBatchWithdrawing(true);
    setBatchProgress({ completed: 0, total: candidates.length });
    setNotice("");
    const completedIds: string[] = [];
    const failures: string[] = [];
    for (let index = 0; index < candidates.length; index += 1) {
      const candidate = candidates[index];
      if (!candidate.workflowId) {
        failures.push(`${candidate.pi}（缺少流程编号）`);
        setBatchProgress((current) => ({ ...current, completed: current.completed + 1 }));
        continue;
      }
      try {
        if (candidate.workflowStatus === "statement_generated") {
          await withdrawWorkflow.mutateAsync(candidate.workflowId);
        } else {
          await advanceWorkflow.mutateAsync({
            workflowId: candidate.workflowId,
            toStatus: "statement_generated",
            note: "批量撤回，退回已生成",
          });
        }
        completedIds.push(candidate.id);
      } catch (error) {
        failures.push(`${candidate.pi}（${error instanceof Error ? error.message : "撤回失败"}）`);
      }
      setBatchProgress((current) => ({ ...current, completed: current.completed + 1 }));
    }
    setSelectedCandidates((current) => current.filter((candidate) => !completedIds.includes(candidate.id)));
    setAllFilteredSelected(false);
    setBatchWithdrawing(false);
    setBatchWithdrawOpen(false);
    showNotice(
      failures.length
        ? `已撤回 ${completedIds.length} 个结算流程；${failures.length} 个未完成：${failures.join("、")}`
        : `已撤回 ${completedIds.length} 个结算流程，可重新发起结算。`,
      failures.length ? "error" : "success",
    );
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
      {notice || pdfExport.isExporting || xlsxExporting || batchStarting || batchWithdrawing ? (
        <Alert
          title={
            notice ||
            (pdfExport.isExporting
              ? settlementExportProgress(pdfExport.job?.completed, pdfExport.job?.total)
              : xlsxExporting
                ? "正在导出 Excel，完成后自动下载…"
                : batchStarting
                  ? `正在发起结算 ${batchProgress.completed}/${batchProgress.total}`
                  : batchWithdrawing
                    ? `正在撤回结算流程 ${batchProgress.completed}/${batchProgress.total}`
                    : "")
          }
          role="status"
          showIcon
          type={notice ? (noticeKind === "error" ? "error" : noticeKind === "success" ? "success" : "info") : "info"}
        />
      ) : null}
      <SettlementBatchToolbar
        allSelectedNonInitiative={allSelectedNonInitiative}
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
      />
      <div className="ant-table-region settlement-candidate-list" role="region" tabIndex={0} aria-label="结算管理列表">
        <DataTable
          columns={columns}
          dataSource={items}
          loading={list.isPending}
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
        onPage={setPage}
        onPageSize={(nextSize) => {
          setPageSize(nextSize);
          setPage(1);
        }}
      />
      <BatchStartConfirmModal
        count={selectedCandidates.filter((item) => !item.hasWorkflow).length}
        open={batchConfirmOpen}
        pending={batchStarting}
        onCancel={() => {
          if (!batchStarting) setBatchConfirmOpen(false);
        }}
        onConfirm={() => void startSelectedCandidates()}
      />
      <BatchWithdrawConfirmModal
        count={withdrawableSelected.length}
        open={batchWithdrawOpen}
        pending={batchWithdrawing}
        onCancel={() => {
          if (!batchWithdrawing) setBatchWithdrawOpen(false);
        }}
        onConfirm={() => void withdrawSelectedCandidates()}
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
          onClose={() => setSelected(null)}
          onExportPdf={() => void exportCandidates([selected])}
          onRevert={() => void revertFor(selected)}
          onStartSettlement={() => void prepareNoticeEmail(selected)}
        />
      ) : null}
      {noticeEmail ? (
        <SettlementNoticeModal
          email={noticeEmail.email}
          pending={generate.isPending}
          onCancel={() => setNoticeEmail(null)}
          onConfirm={() => void confirmNoticeEmail()}
        />
      ) : null}
    </>
  );
}

function settlementExportProgress(completed = 0, total = 0) {
  return total > 1 ? `正在导出 ${completed}/${total}` : "PDF 正在生成，完成后自动下载。";
}
