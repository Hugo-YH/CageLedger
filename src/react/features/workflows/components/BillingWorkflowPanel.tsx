import { ModalPresence } from "../../../components/ui/ModalPresence";
import { useListPageBounds } from "../../../hooks/useListPageBounds";
import { queryKeys } from "../../../api/queryKeys";
import { BatchFailureDetails } from "../../../components/BatchFailureDetails";
import { useWorkspaceMemory, useWorkspaceScroll } from "../../../state/workspaceMemory";
import { ListViewControls, type ListDensity } from "../../../components/ui/ListViewControls";
import { Alert, Button, Popconfirm, Select, Tag } from "antd";
import { ExclamationCircleOutlined, LockOutlined } from "@ant-design/icons";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { SessionUser } from "../../../api/contracts";
import type { BillingWorkflow } from "../../../api/workflows";
import { useAdvanceWorkflow, useBillingWorkflows, type WorkflowAdvancePayload } from "../../../api/workflows";
import { useBatchAdvanceWorkflow } from "../../../api/useBatchAdvanceWorkflow";
import { CommandBar, HelpPopover } from "../../../components/ui";
import { Pager } from "../../../components/WorkspaceUi";
import { QueryFeedback } from "./LedgerListShared";
import { WorkflowDetailModal } from "./WorkflowDetailModal";
import { WorkflowReimbursementRecordingModal } from "./WorkflowReimbursementRecordingModal";
import { WorkflowRegistrationModal } from "./WorkflowRegistrationModal";
import { WorkflowRevokeModal, type WorkflowRevokeTarget } from "./WorkflowRevokeModal";
import { useSelectionScope } from "../../../hooks/useSelectionScope";
import { useAsyncFormAction } from "../../../hooks/useAsyncFormAction";
import { BillingWorkflowTable } from "./BillingWorkflowTable";
import { WorkflowLockContext } from "./workflowLockContext";

const EMPTY_WORKFLOWS: BillingWorkflow[] = [];

export function BillingWorkflowPanel({ user }: { user: SessionUser }) {
  const [page, setPage] = useWorkspaceMemory("workflow:page", 1);
  const [pageSize, setPageSize] = useWorkspaceMemory("workflow:pageSize", 10);
  const [sort, setSort] = useWorkspaceMemory<{ key: string; dir: "asc" | "desc" }>("workflow:sort", {
    key: "month",
    dir: "desc",
  });
  const [filters, setFilters] = useWorkspaceMemory<Record<string, string[]>>("workflow:filters", {});
  const [density, setDensity] = useWorkspaceMemory<ListDensity>("workflow:density", "middle");
  const scopeRef = useRef(JSON.stringify(filters));
  useEffect(() => {
    scopeRef.current = JSON.stringify(filters);
  }, [filters]);
  const [sourceType, setSourceType] = useWorkspaceMemory("workflow:feeType", "");
  const query = useBillingWorkflows({
    sourceType,
    limit: pageSize,
    offset: (page - 1) * pageSize,
    sortKey: sort.key,
    sortDir: sort.dir,
    columnFilters: filters,
  });
  const advance = useAdvanceWorkflow();
  const lockAction = useAsyncFormAction("结算流程操作失败，请重试");
  const batchAdvance = useBatchAdvanceWorkflow();
  const [registerTarget, setRegisterTarget] = useState<BillingWorkflow | null>(null);
  const [detailTarget, setDetailTarget] = useState<BillingWorkflow | null>(null);
  const [recordingTarget, setRecordingTarget] = useState<BillingWorkflow | null>(null);
  const [revokeTarget, setRevokeTarget] = useState<WorkflowRevokeTarget | null>(null);
  const [selectedLockable, setSelectedLockable] = useState<string[]>([]);
  const selectedRows = useRef(new Map<string, BillingWorkflow>());
  const clearSelection = useCallback(() => {
    setSelectedLockable([]);
    selectedRows.current.clear();
  }, []);
  useSelectionScope(JSON.stringify([user.id, filters]), clearSelection, selectedLockable.length > 0);
  const [batchFailures, setBatchFailures] = useState<string[]>([]);
  const [batchLocking, setBatchLocking] = useState(false);
  const [batchLockNotice, setBatchLockNotice] = useState<{ kind: "success" | "error" | "info"; text: string } | null>(
    null,
  );
  useWorkspaceScroll("workflow-center", !query.isPending && !query.isError);
  const items = query.data?.items || EMPTY_WORKFLOWS;
  const total = query.data?.page.total || 0;
  const pages = Math.max(Math.ceil(total / pageSize), 1);
  const lockableItems = useMemo(
    () =>
      items.filter((item) => item.workflowStatus === "statement_sent" || item.workflowStatus === "statement_archived"),
    [items],
  );
  const allLockableSelected =
    lockableItems.length > 0 && lockableItems.every((item) => selectedLockable.includes(item.id));

  const toggleLockable = useCallback((item: BillingWorkflow, checked: boolean) => {
    if (checked) selectedRows.current.set(item.id, item);
    else selectedRows.current.delete(item.id);
    setSelectedLockable((current) =>
      checked ? [...new Set([...current, item.id])] : current.filter((id) => id !== item.id),
    );
  }, []);

  const toggleAllLockable = useCallback(() => {
    for (const item of lockableItems) {
      if (allLockableSelected) selectedRows.current.delete(item.id);
      else selectedRows.current.set(item.id, item);
    }
    setSelectedLockable((current) => {
      if (allLockableSelected) {
        const currentIds = new Set(lockableItems.map((item) => item.id));
        return current.filter((id) => !currentIds.has(id));
      }
      return [...new Set([...current, ...lockableItems.map((item) => item.id)])];
    });
  }, [allLockableSelected, lockableItems]);

  async function lockSelected() {
    if (lockAction.pending || batchLocking) return;
    const targets = selectedLockable
      .map((id) => selectedRows.current.get(id))
      .filter((item): item is BillingWorkflow => Boolean(item));
    if (!targets.length) return;
    const submittedScope = scopeRef.current;
    setBatchFailures([]);
    setBatchLocking(true);
    setBatchLockNotice({ kind: "info", text: `正在锁定结算流程 ${0}/${targets.length}…` });
    try {
      const result = await batchAdvance.run(
        targets.map((target) => ({
          workflowId: target.id,
          toStatus: "statement_locked",
          note: "批量锁定结算流程",
        })),
      );
      const failures = result.failures.map(
        (failure) =>
          `${targets.find((target) => target.id === failure.item.workflowId)?.pi || "结算流程"}（${failure.message}）`,
      );
      const failedIds = new Set(
        submittedScope === scopeRef.current ? result.failures.map((failure) => failure.item.workflowId) : [],
      );
      setSelectedLockable(targets.filter((target) => failedIds.has(target.id)).map((target) => target.id));
      selectedRows.current = new Map(
        targets.filter((target) => failedIds.has(target.id)).map((target) => [target.id, target]),
      );
      setBatchFailures(failures);
      setBatchLockNotice({
        kind: failures.length ? "error" : "success",
        text: failures.length
          ? `已锁定 ${targets.length - failures.length} 条结算流程；${failures.length} 条未完成。`
          : `已锁定 ${targets.length} 条结算流程。`,
      });
    } catch (error) {
      setBatchLockNotice({
        kind: "error",
        text: `批量结果未能同步，请刷新列表确认：${error instanceof Error ? error.message : "同步失败"}`,
      });
    } finally {
      setBatchLocking(false);
    }
  }

  useListPageBounds(
    page,
    pages,
    !query.isPending && !query.isError && !query.isPlaceholderData,
    setPage,
    queryKeys.workflowsRoot,
  );

  const toggleSort = useCallback(
    (key: string) => {
      setSort((current) => ({ key, dir: current.key === key && current.dir === "asc" ? "desc" : "asc" }));
      setPage(1);
    },
    [setSort, setPage],
  );

  const applyFilter = useCallback(
    (key: string, values: string[]) => {
      setFilters((current) => ({ ...current, [key]: values }));
      setPage(1);
    },
    [setFilters, setPage],
  );

  const runLockAction = lockAction.run;
  const advanceWorkflow = advance.mutateAsync;
  const onAdvance = useCallback(
    (payload: WorkflowAdvancePayload) => runLockAction(() => advanceWorkflow(payload)),
    [runLockAction, advanceWorkflow],
  );
  const lockState = useMemo(
    () => ({
      pending: batchLocking || lockAction.pending,
      activeId: lockAction.pending ? advance.variables?.workflowId || "" : "",
      onAdvance,
    }),
    [batchLocking, lockAction.pending, advance.variables?.workflowId, onAdvance],
  );

  return (
    <section className="ledger-section" aria-label="结算流程列表">
      <CommandBar
        title="单据跟踪"
        className="app-command-bar-list"
        ariaLabel="结算流程批量操作"
        filters={
          <ListViewControls
            filters={filters}
            onFiltersChange={(next) => {
              setFilters(next);
              setPage(1);
            }}
            density={density}
            onDensity={setDensity}
            disabled={batchLocking || lockAction.pending}
          />
        }
        context={
          <>
            <HelpPopover label="单据跟踪说明" icon={<ExclamationCircleOutlined aria-hidden="true" />}>
              饲养费与技术服务费分别出单，共用流程：发起结算流程、交回登记、锁定归档；解锁后恢复未归档，经手人或锁定授权账号可撤回。
            </HelpPopover>
            <Tag color="blue">{total} 条结算流程</Tag>
            <Select
              aria-label="费用类型"
              value={sourceType}
              onChange={(value) => {
                setSourceType(value);
                setPage(1);
                clearSelection();
              }}
              options={[
                { value: "", label: "全部费用" },
                { value: "feeding", label: "饲养费" },
                { value: "pi_merged_technical_service", label: "技术服务费" },
              ]}
            />
          </>
        }
        selection={
          user.billingLockAllowed
            ? { count: selectedLockable.length, onClear: clearSelection, pending: batchLocking }
            : undefined
        }
        sticky="selection"
        primaryAction={
          user.billingLockAllowed && selectedLockable.length ? (
            <Popconfirm
              title={`批量锁定 ${selectedLockable.length} 条结算流程？`}
              description="锁定后标记为已归档，流程进入只读，单据交回状态保持当前记录；仅授权账号可解锁。"
              okText="批量锁定"
              cancelText="取消"
              onConfirm={lockSelected}
            >
              <Button
                icon={<LockOutlined aria-hidden />}
                loading={batchLocking}
                disabled={lockAction.pending || query.isPlaceholderData}
                type="primary"
              >
                批量锁定
              </Button>
            </Popconfirm>
          ) : undefined
        }
      />
      {lockAction.error ? <Alert role="alert" showIcon title={lockAction.error} type="error" /> : null}
      {batchLockNotice ? (
        <Alert
          className="ledger-batch-notice"
          role={batchLockNotice.kind === "error" ? "alert" : "status"}
          showIcon
          title={batchLocking ? `正在锁定结算流程，已处理 ${batchAdvance.completed} 条…` : batchLockNotice.text}
          description={<BatchFailureDetails key={batchFailures.join("|")} failures={batchFailures} />}
          type={batchLockNotice.kind}
        />
      ) : null}
      <QueryFeedback
        error={query.isError}
        errorText="结算流程加载失败"
        loading={query.isPending}
        loadingText="正在同步结算流程..."
        retry={() => void query.refetch()}
      />
      {!query.isPending && !query.isError ? (
        <WorkflowLockContext.Provider value={lockState}>
          <BillingWorkflowTable
            user={user}
            items={items}
            refreshing={query.isFetching}
            density={density}
            filters={filters}
            selectedLockable={selectedLockable}
            allLockableSelected={allLockableSelected}
            hasLockableItems={Boolean(lockableItems.length)}
            onToggleLockable={toggleLockable}
            onToggleAllLockable={toggleAllLockable}
            onSort={toggleSort}
            onFilter={applyFilter}
            onRegister={setRegisterTarget}
            onDetail={setDetailTarget}
            onRevoke={setRevokeTarget}
          />
        </WorkflowLockContext.Provider>
      ) : null}
      <Pager
        itemLabel="条"
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
      <WorkflowRegistrationModal
        target={registerTarget}
        onCancel={() => setRegisterTarget(null)}
        onRegistered={() => {
          setRegisterTarget(null);
        }}
      />
      <ModalPresence>
        {detailTarget ? (
          <WorkflowDetailModal
            key={`detail:${detailTarget.id}`}
            target={detailTarget}
            recordable={Boolean(
              detailTarget &&
              user.billingLockAllowed &&
              (detailTarget.reimbursementRequired ?? Number(detailTarget.totalAmount || 0) > 0) &&
              !detailTarget.reimbursementFormReturned,
            )}
            onCancel={() => setDetailTarget(null)}
            onRecord={(workflow) => {
              setDetailTarget(null);
              setRecordingTarget(workflow);
            }}
          />
        ) : recordingTarget ? (
          <WorkflowReimbursementRecordingModal
            key={`record:${recordingTarget.id}`}
            target={recordingTarget}
            onCancel={() => setRecordingTarget(null)}
            onRecorded={() => {
              setRecordingTarget(null);
              void query.refetch();
            }}
          />
        ) : null}
      </ModalPresence>
      <WorkflowRevokeModal target={revokeTarget} onCancel={() => setRevokeTarget(null)} />
    </section>
  );
}
