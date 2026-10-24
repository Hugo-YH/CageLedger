import { ActionIcon } from "../../../components/ui/ActionIcon";
import { Alert, Button, Checkbox, Flex, Pagination, Space, Tag, Typography, type TableProps } from "antd";
import { Modal } from "../../../components/ui/Modal";
import { memo, useMemo, useState } from "react";
import { iacucExpiryStatus } from "../../../../domain/iacucValidity";
import type { QuantitySheet, QuantitySheetListParams } from "../../../api/contracts";
import { useIacucExpiry } from "../../../api/iacuc";
import {
  fetchQuantitySheetsForPrint,
  useDeleteQuantitySheet,
  useQuantitySheetDetail,
  useQuantitySheets,
} from "../../../api/quantitySheets";
import { ActionButton, CommandBar, ModalPresence } from "../../../components/ui";
import { useSelectionScope } from "../../../hooks/useSelectionScope";
import { PageSkeleton } from "../../../components/WorkspaceUi";
import { openQuantitySheetsPrint } from "../../../print/quantitySheets";
import { usePdfExport } from "../hooks/usePdfExport";
import { useQuantitySheetSelection } from "../hooks/useQuantitySheetSelection";
import { SavedQuantitySheetTable } from "./SavedQuantitySheetTable";
import { QuantityColumnTitle } from "./QuantityColumnTitle";
import { QuantityPreviewModal } from "./QuantityPreviewModal";

const EMPTY_SHEETS: QuantitySheet[] = [];

export const SavedQuantitySheets = memo(function SavedQuantitySheets({
  onEdit,
  navigationAction,
}: {
  onEdit: (id: string) => void;
  navigationAction?: React.ReactNode;
}) {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [sort, setSort] = useState<{ key: string; dir: "asc" | "desc" }>({ key: "month", dir: "desc" });
  const [filters, setFilters] = useState<Record<string, string[]>>({});
  const selection = useQuantitySheetSelection();
  const { selected, selectingAll, allFilteredSelected, clear, toggle, toggleAll } = selection;
  useSelectionScope(JSON.stringify(filters), clear, selected.length > 0 || selectingAll);
  const [viewId, setViewId] = useState("");
  const [deleteId, setDeleteId] = useState("");
  const [exportError, setExportError] = useState("");
  const [printPending, setPrintPending] = useState(false);
  const pdfExport = usePdfExport();
  const params = useMemo<QuantitySheetListParams>(
    () => ({
      limit: pageSize,
      offset: (page - 1) * pageSize,
      sortKey: sort.key,
      sortDir: sort.dir,
      columnFilters: filters,
    }),
    [filters, page, pageSize, sort],
  );
  const list = useQuantitySheets(params);
  const iacucExpiry = useIacucExpiry();
  const detail = useQuantitySheetDetail(viewId);
  const remove = useDeleteQuantitySheet();
  const items = list.data?.items || EMPTY_SHEETS;
  const total = list.data?.page.total || 0;
  const iacucExpiryByCode = useMemo(
    () =>
      new Map((iacucExpiry.data?.items || []).map((item) => [item.iacuc.trim().toUpperCase(), item.projectEndDate])),
    [iacucExpiry.data?.items],
  );
  const initialLoading = list.isPending;
  const columns = useMemo<TableProps<QuantitySheet>["columns"]>(
    () => [
      {
        key: "selection",
        width: 40,
        title: (
          <Checkbox
            aria-label="全选当前筛选结果统计表"
            disabled={list.isFetching || selectingAll || !total}
            checked={total > 0 && allFilteredSelected}
            onChange={() => void toggleAll(params)}
          />
        ),
        render: (_, item) => (
          <Checkbox
            aria-label={`选择 ${item.iacuc}`}
            checked={selected.includes(item.id)}
            disabled={list.isFetching}
            onChange={(event) => toggle(item.id, event.target.checked)}
          />
        ),
      },
      ...(
        [
          { key: "month", label: "月份", width: 110 },
          { key: "iacuc", label: "IACUC", width: 250 },
          { key: "roomName", label: "房间", width: 140 },
          { key: "manager", label: "登记人员", width: 130 },
          { key: "pi", label: "负责人", width: 140 },
          { key: "updatedAt", label: "更新时间", width: 190 },
        ] as const
      ).map(({ key, label, width }) => ({
        key,
        dataIndex: key,
        width,
        title: (
          <QuantityColumnTitle
            column={key}
            label={label}
            params={params}
            values={filters[key] || []}
            onSort={() => {
              setSort((current) => ({ key, dir: current.key === key && current.dir === "asc" ? "desc" : "asc" }));
              setPage(1);
            }}
            onFilter={(values) => {
              setFilters((current) => ({ ...current, [key]: values }));
              setPage(1);
            }}
          />
        ),
        render: (value: string, item: QuantitySheet) => {
          if (key === "updatedAt") return formatTime(item.updatedAt);
          const text = value || "-";
          if (key === "iacuc") {
            const projectEndDate = iacucExpiryByCode.get(item.iacuc.trim().toUpperCase());
            return (
              <Space size={4} wrap className="quantity-iacuc-cell">
                <span title={text}>{text}</span>
                {projectEndDate ? <IacucExpiryTag endDate={projectEndDate} /> : null}
              </Space>
            );
          }
          return <span title={text}>{text}</span>;
        },
      })),
      {
        key: "actions",
        title: "操作",
        fixed: "right" as const,
        width: 240,
        align: "right",
        render: (_, item) => (
          <Space aria-label={`${item.iacuc}操作`} className="quantity-saved-row-actions" size={8}>
            <Button color="blue" variant="filled" disabled={list.isFetching} onClick={() => setViewId(item.id)}>
              预览
            </Button>
            <Button type="primary" disabled={list.isFetching} onClick={() => onEdit(item.id)}>
              编辑
            </Button>
            <Button danger disabled={list.isFetching} onClick={() => setDeleteId(item.id)}>
              删除
            </Button>
          </Space>
        ),
      },
    ],
    [
      allFilteredSelected,
      filters,
      iacucExpiryByCode,
      list.isFetching,
      onEdit,
      params,
      selected,
      selectingAll,
      toggle,
      toggleAll,
      total,
    ],
  );

  async function printSelected() {
    setExportError("");
    setPrintPending(true);
    try {
      const { items: sheets } = await fetchQuantitySheetsForPrint(selected);
      openQuantitySheetsPrint(sheets);
    } catch (error) {
      setExportError(error instanceof Error ? error.message : "无法加载待打印统计表");
    } finally {
      setPrintPending(false);
    }
  }

  async function exportSelected() {
    setExportError("");
    try {
      await pdfExport.exportPdf({ kind: "quantity_sheet", ids: selected });
    } catch (error) {
      setExportError(error instanceof Error ? error.message : "PDF 导出失败");
    }
  }

  if (initialLoading) return <PageSkeleton label="已保存数量统计表" variant="table" />;

  return (
    <>
      <CommandBar
        className="quantity-saved-toolbar"
        ariaLabel="已保存统计表操作"
        title="已保存数量统计表"
        sticky="selection"
        selection={{
          count: selected.length,
          onClear: clear,
          pending: selectingAll || printPending || pdfExport.isExporting,
        }}
        context={<Tag color="blue">{selectingAll ? `正在选择全部 ${total} 条` : `共 ${total} 条`}</Tag>}
        actions={
          <>
            {navigationAction}
            <ActionButton
              icon={<ActionIcon name="print" />}
              disabled={!selected.length || list.isFetching || selectingAll || printPending}
              loading={printPending}
              onClick={() => void printSelected()}
            >
              {printPending ? "正在准备打印…" : "打印数量统计表"}
            </ActionButton>
          </>
        }
        primaryAction={
          <ActionButton
            icon={<ActionIcon name="download" />}
            disabled={!selected.length || list.isFetching || pdfExport.isExporting || selectingAll}
            loading={pdfExport.isExporting}
            tone="primary"
            onClick={() => void exportSelected()}
          >
            {pdfExport.isExporting
              ? exportProgress(pdfExport.job?.completed, pdfExport.job?.total)
              : selected.length > 1
                ? "批量导出 PDF"
                : "导出 PDF"}
          </ActionButton>
        }
      />
      <section className="panel quantity-saved-panel">
        {selection.error ? <Alert role="alert" showIcon title={selection.error} type="error" /> : null}
        {pdfExport.isExporting || exportError ? (
          <Alert
            role="status"
            showIcon
            title={
              exportError ||
              `PDF 正在后台生成，完成后会自动下载。${
                pdfExport.job && pdfExport.job.total > 1
                  ? `（${exportProgress(pdfExport.job?.completed, pdfExport.job?.total)}）`
                  : ""
              }`
            }
            type={exportError ? "error" : "info"}
          />
        ) : null}
        <div
          className="table-wrap quantity-saved-list"
          data-ui="data-table"
          role="region"
          tabIndex={0}
          aria-busy={list.isFetching}
          aria-label="已保存数量统计表"
        >
          <SavedQuantitySheetTable columns={columns} items={items} refreshing={list.isFetching} />
        </div>
        <Flex align="center" className="quantity-saved-pagination" justify="space-between" wrap>
          <Typography.Text type="secondary">共 {total} 条</Typography.Text>
          <div className="quantity-saved-pagination-scroll">
            <Pagination
              current={page}
              onChange={(nextPage, nextPageSize) => {
                if (nextPageSize !== pageSize) {
                  setPageSize(nextPageSize);
                  setPage(1);
                  return;
                }
                setPage(nextPage);
              }}
              pageSize={pageSize}
              pageSizeOptions={[5, 10, 20, 50, 100]}
              showSizeChanger={{ "aria-label": "每页显示条数" }}
              total={total}
            />
          </div>
        </Flex>
        <ModalPresence>
          {viewId ? (
            <QuantityPreviewModal
              key={viewId}
              sheet={detail.data?.item}
              loading={detail.isPending}
              onClose={() => setViewId("")}
            />
          ) : null}
        </ModalPresence>
        <ModalPresence>
          {deleteId ? (
            <Modal
              key={deleteId}
              footer={
                <Space>
                  <ActionButton onClick={() => setDeleteId("")}>取消</ActionButton>
                  <ActionButton
                    loading={remove.isPending}
                    tone="destructive"
                    onClick={async () => {
                      await remove.mutateAsync(deleteId);
                      toggle(deleteId, false);
                      setDeleteId("");
                    }}
                  >
                    确认删除
                  </ActionButton>
                </Space>
              }
              onCancel={() => setDeleteId("")}
              open
              title="删除数量统计表"
            >
              <p>删除后，该统计表将退出结算合表范围。</p>
            </Modal>
          ) : null}
        </ModalPresence>
      </section>
    </>
  );
});

function IacucExpiryTag({ endDate }: { endDate: string }) {
  const { color, label } = iacucExpiryStatus(endDate);
  return <Tag color={color}>{label}</Tag>;
}

function formatTime(value: string) {
  return value ? new Date(value).toLocaleString("zh-CN", { hour12: false }) : "-";
}

function exportProgress(completed = 0, total = 0) {
  return total > 1 ? `正在导出 ${completed}/${total}` : "正在生成…";
}
