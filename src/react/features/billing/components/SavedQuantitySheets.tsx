import { ActionIcon } from "../../../components/ui/ActionIcon";
import { Alert, Button, Checkbox, Flex, Pagination, Space, Tag, Typography, type TableProps } from "antd";
import { Modal } from "../../../components/ui/Modal";
import { memo, useMemo, useState } from "react";
import { iacucExpiryStatus } from "../../../../domain/iacucValidity";
import type { QuantitySheetListItem } from "../../../api/contracts";
import { useIacucExpiry } from "../../../api/iacuc";
import {
  fetchQuantitySheetsForPrint,
  useDeleteQuantitySheet,
  useQuantitySheetDetail,
} from "../../../api/quantitySheets";
import { ActionButton, CommandBar, ModalPresence } from "../../../components/ui";
import { useSelectionScope } from "../../../hooks/useSelectionScope";
import { PageSkeleton } from "../../../components/WorkspaceUi";
import { openQuantitySheetsPrint } from "../../../print/quantitySheets";
import { usePdfExport } from "../hooks/usePdfExport";
import { useSavedQuantityList } from "../hooks/useSavedQuantityList";
import { useQuantitySheetSelection } from "../hooks/useQuantitySheetSelection";
import { SavedQuantitySheetTable } from "./SavedQuantitySheetTable";
import { QuantityColumnTitle } from "./QuantityColumnTitle";
import { QuantityPreviewModal } from "./QuantityPreviewModal";

const EMPTY_SHEETS: QuantitySheetListItem[] = [];

export const SavedQuantitySheets = memo(function SavedQuantitySheets({
  onEdit,
  navigationAction,
}: {
  onEdit: (id: string) => void;
  navigationAction?: React.ReactNode;
}) {
  const { setPage, setPageSize, setSort, filters, setFilters, params, list, data, blocked, loading } =
    useSavedQuantityList();
  const selection = useQuantitySheetSelection();
  const { selected, selectingAll, allFilteredSelected, clear, toggle, toggleAll } = selection;
  useSelectionScope(JSON.stringify(filters), clear, selected.length > 0 || selectingAll);
  const [viewId, setViewId] = useState("");
  const [deleteId, setDeleteId] = useState("");
  const [exportError, setExportError] = useState("");
  const [printPending, setPrintPending] = useState(false);
  const pdfExport = usePdfExport();
  const iacucExpiry = useIacucExpiry();
  const detail = useQuantitySheetDetail(viewId);
  const remove = useDeleteQuantitySheet();
  const items = data?.items || EMPTY_SHEETS;
  const total = data?.page.total || 0;
  const iacucExpiryByCode = useMemo(
    () =>
      new Map((iacucExpiry.data?.items || []).map((item) => [item.iacuc.trim().toUpperCase(), item.projectEndDate])),
    [iacucExpiry.data?.items],
  );
  const columns = useMemo<TableProps<QuantitySheetListItem>["columns"]>(
    () => [
      {
        key: "selection",
        width: 40,
        title: (
          <Checkbox
            aria-label="全选当前筛选结果统计表"
            disabled={blocked || selectingAll || !total}
            checked={total > 0 && allFilteredSelected}
            onChange={() => void toggleAll(params)}
          />
        ),
        render: (_, item) => (
          <Checkbox
            aria-label={`选择 ${item.iacuc}`}
            checked={selected.includes(item.id)}
            disabled={blocked}
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
        render: (value: string, item: QuantitySheetListItem) => {
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
            <Button color="blue" variant="filled" disabled={blocked} onClick={() => setViewId(item.id)}>
              预览
            </Button>
            <Button type="primary" disabled={blocked} onClick={() => onEdit(item.id)}>
              编辑
            </Button>
            <Button danger disabled={blocked} onClick={() => setDeleteId(item.id)}>
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
      blocked,
      onEdit,
      params,
      selected,
      selectingAll,
      setFilters,
      setPage,
      setSort,
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
        context={
          <Tag color="blue">
            {!data
              ? "列表未加载"
              : selectingAll
                ? `正在选择全部 ${total} 条`
                : list.isError || list.isPlaceholderData
                  ? `上次结果共 ${total} 条`
                  : `共 ${total} 条`}
          </Tag>
        }
        actions={
          <>
            {navigationAction}
            <ActionButton
              icon={<ActionIcon name="print" />}
              disabled={!selected.length || blocked || selectingAll || printPending}
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
            disabled={!selected.length || blocked || pdfExport.isExporting || selectingAll}
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
        {loading ? <PageSkeleton embedded label="已保存数量统计表" variant="table" /> : null}
        {list.isError ? (
          <Alert
            role="alert"
            showIcon
            type="error"
            title={data ? "列表更新失败，当前显示上次成功结果，操作已暂停" : "无法加载数量统计表列表"}
            description={list.error instanceof Error ? list.error.message : "请重试读取列表"}
            action={
              <Button
                disabled={list.isFetching}
                loading={list.isFetching}
                onClick={() => void list.refetch({ cancelRefetch: false })}
              >
                重试
              </Button>
            }
          />
        ) : null}
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
        {data ? (
          <>
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
                  current={Math.floor(data.page.offset / data.page.limit) + 1}
                  onChange={(nextPage, nextPageSize) => {
                    if (nextPageSize !== data.page.limit) {
                      setPageSize(nextPageSize);
                      setPage(1);
                      return;
                    }
                    setPage(nextPage);
                  }}
                  pageSize={data.page.limit}
                  pageSizeOptions={[5, 10, 20, 50, 100]}
                  showSizeChanger={{ "aria-label": "每页显示条数" }}
                  total={total}
                />
              </div>
            </Flex>
          </>
        ) : null}
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
                    disabled={blocked || remove.isPending}
                    loading={remove.isPending}
                    tone="destructive"
                    onClick={async () => {
                      if (blocked || remove.isPending) return;
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
