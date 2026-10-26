import { ActionIcon } from "../../../components/ui/ActionIcon";
import { useListPageBounds } from "../../../hooks/useListPageBounds";
import { queryKeys } from "../../../api/queryKeys";
import { BatchFailureDetails } from "../../../components/BatchFailureDetails";
import { useWorkspaceMemory, useWorkspaceScroll } from "../../../state/workspaceMemory";
import { ListViewControls, type ListDensity } from "../../../components/ui/ListViewControls";
import { Alert, Button, Empty, Space, Typography } from "antd";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { settlementCandidateScope } from "../../../../domain/settlementCandidateScope";
import type { SessionUser, SettlementCandidate, SettlementCandidateListParams } from "../../../api/contracts";
import { exportSettlementXlsx, useSettlementCandidates } from "../../../api/settlements";
import { useSettlementBatch } from "../../../api/useSettlementBatch";
import { useSelectionScope } from "../../../hooks/useSelectionScope";
import { useRetainedListData } from "../../../hooks/useRetainedListData";
import { PageSkeleton, Pager } from "../../../components/WorkspaceUi";
import { settlementExportProgress, usePdfExport } from "../hooks/usePdfExport";
import { useSettlementSelection } from "../hooks/useSettlementSelection";
import { BatchStartConfirmModal } from "./BatchStartConfirmModal";
import { BatchWithdrawConfirmModal } from "./BatchWithdrawConfirmModal";
import { SettlementBatchToolbar } from "./SettlementBatchToolbar";
import { SettlementCandidateTable } from "./SettlementCandidateTable";
import { SettlementPreviewProvider } from "./SettlementPreviewProvider";
import { canWithdrawCandidate } from "./settlementPreviewContext";

export function SettlementCandidateList({
  source,
  user,
  navigationAction,
}: {
  source: "quantity_sheet" | "cage_map";
  user: SessionUser;
  navigationAction?: React.ReactNode;
}) {
  const [page, setPage] = useWorkspaceMemory("settlement:page", 1);
  const [pageSize, setPageSize] = useWorkspaceMemory("settlement:pageSize", 10);
  const [sort, setSort] = useWorkspaceMemory<{
    key: SettlementCandidateListParams["sortKey"];
    dir: "asc" | "desc";
  }>("settlement:sort", { key: "month", dir: "desc" });
  const [filters, setFilters] = useWorkspaceMemory<Record<string, string[]>>("settlement:filters", {});
  const [density, setDensity] = useWorkspaceMemory<ListDensity>("settlement:density", "middle");
  const scopeRef = useRef(JSON.stringify(filters));
  useEffect(() => {
    scopeRef.current = JSON.stringify(filters);
  }, [filters]);
  const selection = useSettlementSelection();
  const { selectedCandidates, allFilteredSelected, selectingAll } = selection;
  const [batchFailures, setBatchFailures] = useState<string[]>([]);
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
    setBatchFailures([]);
    setNotice(message);
    setNoticeKind(kind);
  }

  const params = useMemo<SettlementCandidateListParams>(
    () => ({
      limit: pageSize,
      offset: (page - 1) * pageSize,
      sortKey: sort.key,
      sortDir: sort.dir,
      columnFilters: filters,
    }),
    [pageSize, page, sort, filters],
  );
  const list = useSettlementCandidates(params, source === "quantity_sheet");
  const { data, blocked, loading } = useRetainedListData(
    list,
    queryKeys.settlementCandidates({ ...params }),
    `settlement:${source}`,
  );
  useWorkspaceScroll("billing-settlement", !list.isPending && !list.isError);
  const items = data?.items || [];
  const total = data?.page.total || 0;
  const pages = Math.max(Math.ceil(total / (data?.page.limit || pageSize)), 1);

  useListPageBounds(
    page,
    pages,
    !list.isPending && !list.isError && !list.isPlaceholderData && !list.isFetching,
    setPage,
    queryKeys.settlementCandidatesRoot,
  );

  const onFilter = useCallback(
    (column: string, values: string[]) => {
      setFilters((current) => ({ ...current, [column]: values }));
      setPage(1);
    },
    [setFilters, setPage],
  );
  const onSort = useCallback(
    (column: NonNullable<SettlementCandidateListParams["sortKey"]>) => {
      setSort((current) => ({ key: column, dir: current.key === column && current.dir === "asc" ? "desc" : "asc" }));
      setPage(1);
    },
    [setSort, setPage],
  );
  const { toggleAll } = selection;
  const onToggleAll = useCallback(() => {
    if (!blocked) void toggleAll(params);
  }, [blocked, toggleAll, params]);
  const canWithdraw = (candidate: SettlementCandidate) => canWithdrawCandidate(candidate, user);

  async function exportCandidates(candidates: SettlementCandidate[]) {
    if (blocked) return;
    setNotice("");
    try {
      await pdfExport.exportPdf({
        kind: "billing_statement",
        items: candidates.map((candidate) => settlementCandidateScope(candidate, source)),
      });
    } catch (error) {
      showNotice(error instanceof Error ? error.message : "PDF 导出失败", "error");
    }
  }

  async function exportCandidatesXlsx(candidates: SettlementCandidate[]) {
    if (blocked || exportingXlsx.current) return;
    exportingXlsx.current = true;
    setXlsxExporting(true);
    setNotice("");
    try {
      showNotice(`正在导出 ${candidates.length > 1 ? `${candidates.length} 份` : ""}Excel…`, "info");
      const filename = await exportSettlementXlsx(
        candidates.map((candidate) => settlementCandidateScope(candidate, source)),
      );
      showNotice(`已导出 Excel：${filename}`, "success");
    } catch (error) {
      showNotice(error instanceof Error ? error.message : "Excel 导出失败", "error");
    } finally {
      exportingXlsx.current = false;
      setXlsxExporting(false);
    }
  }

  async function runSelectedBatch(action: "start" | "withdraw", note?: string) {
    if (blocked || batchActionRef.current) return;
    const candidates = selectedCandidates.filter((candidate) =>
      action === "start"
        ? candidate.totalAmount != null &&
          (!candidate.hasWorkflow || candidate.workflowStatus === "statement_generated")
        : canWithdraw(candidate),
    );
    if (!candidates.length) return;
    const submittedScope = scopeRef.current;
    batchActionRef.current = action;
    setBatchAction(action);
    setBatchFailures([]);
    setNotice("");
    const verb = action === "start" ? "发起" : "撤回";
    try {
      const result = await batch.run(
        candidates.map((candidate) => ({ candidate, action, source: candidate.sourceType || source, note })),
      );
      selection.removeCompleted(new Set(result.completed.map((item) => item.candidate.id)));
      const failures = result.failures.map(({ item, message }) => `${item.candidate.pi}（${message}）`);
      showNotice(
        failures.length
          ? `已${verb} ${result.completed.length} 个结算流程；${failures.length} 个未完成。${submittedScope === scopeRef.current ? "失败项仍保留选择。" : "筛选已改变，请在原范围核对结果。"}`
          : action === "start"
            ? `已发起 ${result.completed.length} 个结算流程，可到单据跟踪继续处理。`
            : `已撤回 ${result.completed.length} 个结算流程，可重新发起结算。`,
        failures.length ? "error" : "success",
      );
      setBatchFailures(failures);
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

  const allSelectedNonInitiative =
    selectedCandidates.length > 0 &&
    selectedCandidates.every((item) => item.hasWorkflow && item.workflowStatus !== "statement_generated");
  const withdrawableSelected = selectedCandidates.filter(canWithdraw);
  return (
    <SettlementPreviewProvider
      source={source}
      user={user}
      exportPdf={pdfExport.exportPdf}
      pdfExporting={pdfExport.isExporting}
    >
      {list.isError ? (
        <Alert
          role="alert"
          type="error"
          showIcon
          title={`结算列表加载失败：${list.error.message}`}
          description={data ? "暂显示上次成功结果，重试成功后继续操作。" : undefined}
          action={
            <Button icon={<ActionIcon name="refresh" />} loading={list.isFetching} onClick={() => void list.refetch()}>
              重试
            </Button>
          }
        />
      ) : null}
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
          description={<BatchFailureDetails key={batchFailures.join("|")} failures={batchFailures} />}
          role={noticeKind === "error" ? "alert" : "status"}
          showIcon
          type={notice ? (noticeKind === "error" ? "error" : noticeKind === "success" ? "success" : "info") : "info"}
        />
      ) : null}
      <SettlementBatchToolbar
        navigationAction={navigationAction}
        filters={
          <ListViewControls
            filters={filters}
            onFiltersChange={(next) => {
              setFilters(next);
              setPage(1);
            }}
            density={density}
            onDensity={setDensity}
            disabled={batch.isPending}
          />
        }
        allSelectedNonInitiative={allSelectedNonInitiative}
        disabled={blocked || batch.isPending}
        batchStarting={batchStarting}
        batchWithdrawing={batchWithdrawing}
        pdfExporting={pdfExport.isExporting}
        selectedCandidates={selectedCandidates}
        selectingAll={selectingAll}
        onClearSelection={selection.clear}
        withdrawableCount={withdrawableSelected.length}
        xlsxExporting={xlsxExporting}
        onExportPdf={() => void exportCandidates(selectedCandidates)}
        onExportXlsx={() => void exportCandidatesXlsx(selectedCandidates)}
        onInitiate={() => setBatchConfirmOpen(true)}
        onWithdraw={() => setBatchWithdrawOpen(true)}
      />
      {data ? (
        <SettlementCandidateTable
          items={items}
          refreshing={list.isFetching}
          density={density}
          allFilteredSelected={allFilteredSelected}
          filters={filters}
          params={params}
          selectedCandidates={selectedCandidates}
          selectingAll={selectingAll}
          disabled={blocked || batch.isPending}
          total={total}
          onFilter={onFilter}
          onSort={onSort}
          onToggle={selection.toggle}
          onToggleAll={onToggleAll}
        />
      ) : loading ? (
        <PageSkeleton embedded label="结算管理" variant="table" />
      ) : null}
      {data ? (
        <Pager
          itemLabel="项"
          page={Math.floor((data?.page.offset ?? 0) / (data?.page.limit || pageSize)) + 1}
          pageSize={data?.page.limit || pageSize}
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
      ) : null}
      <BatchStartConfirmModal
        count={
          selectedCandidates.filter((item) => !item.hasWorkflow || item.workflowStatus === "statement_generated").length
        }
        open={batchConfirmOpen}
        pending={batchStarting}
        disabled={blocked}
        onCancel={() => {
          if (!batchStarting) setBatchConfirmOpen(false);
        }}
        onConfirm={() => void runSelectedBatch("start")}
      />
      <BatchWithdrawConfirmModal
        count={withdrawableSelected.length}
        open={batchWithdrawOpen}
        pending={batchWithdrawing}
        disabled={blocked}
        onCancel={() => {
          if (!batchWithdrawing) setBatchWithdrawOpen(false);
        }}
        onConfirm={(note) => runSelectedBatch("withdraw", note)}
      />
    </SettlementPreviewProvider>
  );
}
