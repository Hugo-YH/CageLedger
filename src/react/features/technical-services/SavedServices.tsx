import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Alert, Button } from "antd";
import { Modal } from "../../components/ui/Modal";

import type { TechnicalServiceListItem, TechnicalServiceSheet } from "../../../contracts/technicalServices";
import { useServiceDetail, useServiceList, useServiceMutation } from "../../api/technicalServices";
import { queryKeys } from "../../api/queryKeys";
import { useRetainedListData } from "../../hooks/useRetainedListData";
import { useListPageBounds } from "../../hooks/useListPageBounds";
import { useMediaQuery } from "../../hooks/useMediaQuery";
import { ListViewControls, type ListDensity } from "../../components/ui/ListViewControls";
import { useWorkspaceMemory, useWorkspaceScroll } from "../../state/workspaceMemory";
import { useNavigationGuard } from "../../state/ui";
import { ServiceEditor } from "./ServiceEditor";
import { ServiceDetails } from "./ServiceDetails";
import { SavedServicesTable } from "./SavedServicesTable";
import { PageSkeleton, PageState, Pager } from "../../components/WorkspaceUi";

export function SavedServices() {
  const [page, setPage] = useWorkspaceMemory("technical-services:saved:page", 1);
  const [pageSize, setPageSize] = useWorkspaceMemory("technical-services:saved:pageSize", 10);
  const [viewing, setViewing] = useState<TechnicalServiceListItem | null>(null);
  const [editing, setEditing] = useState<TechnicalServiceListItem | null>(null);
  const [editingSheet, setEditingSheet] = useState<TechnicalServiceSheet | null>(null);
  const [deleting, setDeleting] = useState<TechnicalServiceListItem | null>(null);
  const viewingDetail = useServiceDetail(viewing?.id || "");
  const editingDetail = useServiceDetail(editing?.id || "");
  const [deleteError, setDeleteError] = useState("");
  const [savedNotice, setSavedNotice] = useState("");
  const [highlightedRowId, setHighlightedRowId] = useState<string | null>(null);
  const reducedMotion = useMediaQuery("(prefers-reduced-motion: reduce)");
  const [filters, setFilters] = useWorkspaceMemory<Record<string, string[]>>("technical-services:saved:filters", {});
  const [sort, setSort] = useWorkspaceMemory<{ key: string; dir: "asc" | "desc" }>("technical-services:saved:sort", {
    key: "month",
    dir: "desc",
  });
  const [density, setDensity] = useWorkspaceMemory<ListDensity>("technical-services:saved:density", "middle");
  const editButtonRefs = useRef(new Map<string, HTMLElement>());
  const listRegionRef = useRef<HTMLDivElement>(null);
  const completedEditId = useRef<string | null>(null);
  const params = useMemo(
    () => ({
      columnFilters: filters,
      sortKey: sort.key,
      sortDir: sort.dir,
      limit: pageSize,
      offset: (page - 1) * pageSize,
    }),
    [filters, sort.key, sort.dir, pageSize, page],
  );
  const onFilter = useCallback(
    (column: string, values: string[]) => {
      setHighlightedRowId(null);
      setFilters((previous) => ({ ...previous, [column]: values }));
      setPage(1);
    },
    [setFilters, setPage],
  );
  const onSort = useCallback(
    (column: string) => {
      setHighlightedRowId(null);
      setSort((previous) => ({ key: column, dir: previous.key === column && previous.dir === "asc" ? "desc" : "asc" }));
      setPage(1);
    },
    [setPage, setSort],
  );
  const query = useServiceList(params);
  const { data, blocked, loading } = useRetainedListData(
    query,
    queryKeys.technicalServiceSheets(params),
    "technical-service-saved",
  );
  const mutation = useServiceMutation();
  const guard = useNavigationGuard();
  const total = data?.page.total || 0;
  const pages = Math.max(Math.ceil(total / (data?.page.limit || pageSize)), 1);
  useWorkspaceScroll("technical-service-saved", !query.isPending && !query.isError);
  useListPageBounds(
    page,
    pages,
    !query.isPending && !query.isError && !query.isPlaceholderData && !query.isFetching,
    setPage,
    ["technical-services", "sheets"],
  );
  async function closeEditor() {
    if (await (guard.current?.() ?? Promise.resolve(true))) {
      setEditing(null);
      setEditingSheet(null);
    }
  }
  const openEditor = useCallback((sheet: TechnicalServiceListItem) => {
    setSavedNotice("");
    setHighlightedRowId(null);
    setEditingSheet(null);
    setEditing(sheet);
  }, []);
  function finishEditing() {
    completedEditId.current = editing?.id || null;
    setEditing(null);
    setEditingSheet(null);
    setSavedNotice("技术服务明细已保存。");
  }
  function restoreCompletedEditFocus() {
    const id = completedEditId.current;
    if (!id) return;
    completedEditId.current = null;
    const trigger = editButtonRefs.current.get(id);
    if (trigger && !reducedMotion && !query.isError) setHighlightedRowId(id);
    (trigger && !trigger.matches(":disabled") ? trigger : listRegionRef.current)?.focus();
  }
  const openDelete = useCallback((sheet: TechnicalServiceListItem) => {
    setHighlightedRowId(null);
    setDeleteError("");
    setDeleting(sheet);
  }, []);
  function closeDelete() {
    setDeleteError("");
    setDeleting(null);
  }
  async function remove() {
    if (blocked || !deleting) return;
    setSavedNotice("");
    try {
      await mutation.mutateAsync({ kind: "delete", sheet: deleting });
      setDeleting(null);
      setDeleteError("");
    } catch (error) {
      setDeleteError(error instanceof Error ? error.message : "删除失败");
    }
  }
  useEffect(() => {
    if (query.isError) setSavedNotice("");
    if (query.isError || reducedMotion) setHighlightedRowId(null);
  }, [query.isError, reducedMotion]);
  useEffect(() => {
    const item = editingDetail.data?.item;
    if (editing && !editingSheet && !editingDetail.isFetching && !editingDetail.isError && item?.id === editing.id) {
      setEditingSheet(item);
    }
  }, [editing, editingSheet, editingDetail.data, editingDetail.isFetching, editingDetail.isError]);
  return (
    <section className="panel technical-service-list-panel">
      {savedNotice && !query.isError ? (
        <Alert
          closable={{ onClose: () => setSavedNotice("") }}
          role="status"
          showIcon
          title={savedNotice}
          type="success"
        />
      ) : null}
      {query.isError ? (
        <Alert
          showIcon
          type="error"
          role="alert"
          title="明细列表读取失败"
          description={data ? "暂显示上次成功结果，重试成功后继续操作。" : undefined}
          action={<Button onClick={() => void query.refetch()}>重试</Button>}
        />
      ) : null}
      <div
        ref={listRegionRef}
        className="technical-service-table-region"
        role="region"
        tabIndex={0}
        aria-label="已保存技术服务明细列表"
        aria-busy={query.isFetching}
      >
        <ListViewControls
          filters={filters}
          valueLabels={{
            facility: { zhujiang: "珠江新城", bioisland: "生物岛" },
            status: { protected: "已发起结算", editable: "可编辑" },
          }}
          labels={{
            month: "月份",
            iacuc: "IACUC",
            pi: "项目负责人",
            facility: "服务设施",
            serviceName: "服务项目",
            serviceDayCount: "服务日数",
            quantity: "计费数量",
            amount: "金额",
            status: "状态",
          }}
          onFiltersChange={(next) => {
            setHighlightedRowId(null);
            setFilters(next);
            setPage(1);
          }}
          density={density}
          onDensity={setDensity}
          disabled={query.isFetching || mutation.isPending}
        />
        {loading ? (
          <PageSkeleton label="技术服务明细" variant="table" embedded />
        ) : data ? (
          <SavedServicesTable
            items={data.items}
            params={params}
            density={density}
            blocked={blocked}
            fetching={query.isFetching}
            pending={query.isPending || mutation.isPending}
            highlightedRowId={highlightedRowId}
            reducedMotion={reducedMotion}
            editButtonRefs={editButtonRefs}
            onClearHighlight={setHighlightedRowId}
            onFilter={onFilter}
            onSort={onSort}
            onView={setViewing}
            onEdit={openEditor}
            onDelete={openDelete}
          />
        ) : null}
      </div>
      {data ? (
        <Pager
          page={Math.floor((data?.page.offset ?? 0) / (data?.page.limit || pageSize)) + 1}
          pageSize={data?.page.limit || pageSize}
          pages={pages}
          total={total}
          onPage={(next) => {
            setHighlightedRowId(null);
            setPage(next);
          }}
          onPageSize={(size) => {
            setHighlightedRowId(null);
            setPageSize(size);
            setPage(1);
          }}
        />
      ) : null}
      <Modal
        open={Boolean(viewing)}
        title="技术服务明细预览"
        rootClassName="app-modal-root technical-service-modal"
        width={1000}
        onCancel={() => setViewing(null)}
        footer={<Button onClick={() => setViewing(null)}>关闭</Button>}
      >
        {viewing ? (
          viewingDetail.isFetching ? (
            <PageSkeleton label="技术服务明细预览" variant="detail" />
          ) : viewingDetail.isError ? (
            <PageState
              title="技术服务明细读取失败"
              detail={viewingDetail.error.message}
              retry={() => void viewingDetail.refetch()}
            />
          ) : viewingDetail.data ? (
            <ServiceDetails sheet={viewingDetail.data.item} />
          ) : null
        ) : null}
      </Modal>
      <Modal
        open={Boolean(editing)}
        title="技术服务明细"
        rootClassName="app-modal-root technical-service-modal"
        width={1000}
        footer={null}
        destroyOnHidden
        onCancel={() => void closeEditor()}
        afterClose={restoreCompletedEditFocus}
      >
        {editing && editingSheet ? (
          <ServiceEditor
            key={editing.id}
            initial={editingSheet}
            onSaved={finishEditing}
            onCancel={() => void closeEditor()}
          />
        ) : editing && editingDetail.isFetching ? (
          <PageSkeleton label="技术服务明细编辑" variant="form" />
        ) : editing && editingDetail.isError ? (
          <PageState
            title="技术服务明细读取失败"
            detail={editingDetail.error.message}
            retry={() => void editingDetail.refetch()}
          />
        ) : editing ? (
          <PageSkeleton label="技术服务明细编辑" variant="form" />
        ) : null}
      </Modal>
      <Modal
        open={Boolean(deleting)}
        title="删除技术服务明细"
        rootClassName="app-modal-root technical-service-modal"
        okText="删除"
        cancelText="取消"
        okButtonProps={{ danger: true, loading: mutation.isPending, disabled: blocked }}
        onOk={() => void remove()}
        onCancel={closeDelete}
      >
        删除后该明细不再参与结算。{deleting?.serviceName}
        {deleteError ? <Alert role="alert" type="error" title={deleteError} /> : null}
      </Modal>
    </section>
  );
}
