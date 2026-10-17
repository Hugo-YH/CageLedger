import { ServiceColumnTitle } from "./ServiceColumnTitle";
import { useEffect, useRef, useState } from "react";
import { Alert, Button, Modal, Space, Tag } from "antd";

import type { TechnicalServiceSheet } from "../../../contracts/technicalServices";
import { useServiceList, useServiceMutation } from "../../api/technicalServices";
import { useListPageBounds } from "../../hooks/useListPageBounds";
import { useMediaQuery } from "../../hooks/useMediaQuery";
import { ListViewControls, type ListDensity } from "../../components/ui/ListViewControls";
import { useWorkspaceMemory, useWorkspaceScroll } from "../../state/workspaceMemory";
import { useNavigationGuard } from "../../state/ui";
import { ServiceEditor } from "./ServiceEditor";
import { ServiceDetails } from "./ServiceDetails";
import { DataTable } from "../../components/ui";
import { PageSkeleton, Pager } from "../../components/WorkspaceUi";

export function SavedServices() {
  const [page, setPage] = useWorkspaceMemory("technical-services:saved:page", 1);
  const [pageSize, setPageSize] = useWorkspaceMemory("technical-services:saved:pageSize", 10);
  const [viewing, setViewing] = useState<TechnicalServiceSheet | null>(null);
  const [editing, setEditing] = useState<TechnicalServiceSheet | null>(null);
  const [deleting, setDeleting] = useState<TechnicalServiceSheet | null>(null);
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
  const params = {
    columnFilters: filters,
    sortKey: sort.key,
    sortDir: sort.dir,
    limit: pageSize,
    offset: (page - 1) * pageSize,
  };
  function title(column: string, label: string) {
    return (
      <ServiceColumnTitle
        list="sheets"
        params={params}
        column={column}
        label={label}
        onFilter={(values) => {
          setHighlightedRowId(null);
          setFilters((previous) => ({ ...previous, [column]: values }));
          setPage(1);
        }}
        onSort={() => {
          setHighlightedRowId(null);
          setSort((previous) => ({
            key: column,
            dir: previous.key === column && previous.dir === "asc" ? "desc" : "asc",
          }));
          setPage(1);
        }}
      />
    );
  }
  const query = useServiceList(params);
  const mutation = useServiceMutation();
  const guard = useNavigationGuard();
  const total = query.data?.page.total || 0;
  const pages = Math.max(Math.ceil(total / pageSize), 1);
  useWorkspaceScroll("technical-service-saved", !query.isPending && !query.isError);
  useListPageBounds(page, pages, !query.isPending && !query.isError && !query.isPlaceholderData, setPage, [
    "technical-services",
    "sheets",
  ]);
  async function closeEditor() {
    if (await (guard.current?.() ?? Promise.resolve(true))) setEditing(null);
  }
  function openEditor(sheet: TechnicalServiceSheet) {
    setSavedNotice("");
    setHighlightedRowId(null);
    setEditing(sheet);
  }
  function finishEditing() {
    completedEditId.current = editing?.id || null;
    setEditing(null);
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
  function openDelete(sheet: TechnicalServiceSheet) {
    setHighlightedRowId(null);
    setDeleteError("");
    setDeleting(sheet);
  }
  function closeDelete() {
    setDeleteError("");
    setDeleting(null);
  }
  async function remove() {
    if (!deleting) return;
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
          title="明细列表读取失败"
          action={<Button onClick={() => void query.refetch()}>重试</Button>}
        />
      ) : null}
      {query.isPending ? (
        <PageSkeleton label="技术服务明细" variant="table" embedded />
      ) : (
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
          <DataTable<TechnicalServiceSheet>
            resizeKey="technical-service-saved"
            refreshing={query.isFetching}
            rowKey="id"
            loading={query.isPending || mutation.isPending}
            dataSource={query.data?.items}
            scroll={{ x: 1200 }}
            pagination={false}
            size={density}
            onRow={(row) =>
              row.id === highlightedRowId && !reducedMotion
                ? {
                    className: "technical-service-row-saved",
                    onAnimationEnd: (event) => {
                      if (event.animationName === "technical-service-row-saved") setHighlightedRowId(null);
                    },
                  }
                : {}
            }
            columns={[
              { title: title("month", "月份"), dataIndex: "month", width: 110 },
              { title: title("iacuc", "IACUC"), dataIndex: "iacuc", width: 150 },
              { title: title("pi", "项目负责人"), dataIndex: "pi", width: 160 },
              {
                title: title("facility", "服务设施"),
                width: 130,
                key: "facility",
                render: (_, row) => (row.facility === "zhujiang" ? "珠江新城" : "生物岛"),
              },
              { title: title("serviceName", "服务项目"), dataIndex: "serviceName", width: 180 },
              { title: title("serviceDayCount", "服务日数"), dataIndex: "serviceDayCount", width: 130 },
              {
                title: title("quantity", "计费数量"),
                width: 130,
                key: "quantity",
                render: (_, row) => `${row.totalQuantity} ${row.unit}`,
              },
              {
                title: title("amount", "金额（元）"),
                width: 150,
                key: "amount",
                align: "right",
                render: (_, row) => row.totalAmount.toFixed(2),
              },
              {
                title: title("status", "状态"),
                width: 130,
                key: "status",
                render: (_, row) => (
                  <Tag color={row.protected ? "processing" : "default"}>{row.protected ? "已发起结算" : "可编辑"}</Tag>
                ),
              },
              {
                title: "操作",
                key: "actions",
                width: 240,
                fixed: "right",
                render: (_, row) => (
                  <Space size={8} className="technical-service-row-actions" aria-label={`${row.iacuc}操作`}>
                    <Button color="blue" variant="filled" disabled={query.isFetching} onClick={() => setViewing(row)}>
                      预览
                    </Button>
                    <Button
                      ref={(node) => {
                        if (node) editButtonRefs.current.set(row.id, node);
                        else editButtonRefs.current.delete(row.id);
                      }}
                      type="primary"
                      disabled={query.isFetching}
                      onClick={() => openEditor(row)}
                    >
                      编辑
                    </Button>
                    <Button danger disabled={row.protected || query.isFetching} onClick={() => openDelete(row)}>
                      删除
                    </Button>
                  </Space>
                ),
              },
            ]}
          />
        </div>
      )}
      <Pager
        page={page}
        pageSize={pageSize}
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
      <Modal
        open={Boolean(viewing)}
        title="技术服务明细预览"
        rootClassName="app-modal-root technical-service-modal"
        width={1000}
        onCancel={() => setViewing(null)}
        footer={<Button onClick={() => setViewing(null)}>关闭</Button>}
      >
        {viewing ? <ServiceDetails sheet={viewing} /> : null}
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
        {editing ? (
          <ServiceEditor
            key={editing.id}
            initial={editing}
            onSaved={finishEditing}
            onCancel={() => void closeEditor()}
          />
        ) : null}
      </Modal>
      <Modal
        open={Boolean(deleting)}
        title="删除技术服务明细"
        rootClassName="app-modal-root technical-service-modal"
        okText="删除"
        cancelText="取消"
        okButtonProps={{ danger: true, loading: mutation.isPending }}
        onOk={() => void remove()}
        onCancel={closeDelete}
      >
        删除后该明细不再参与结算。{deleting?.serviceName}
        {deleteError ? <Alert role="alert" type="error" title={deleteError} /> : null}
      </Modal>
    </section>
  );
}
