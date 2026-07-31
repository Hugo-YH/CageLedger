import { Button, Checkbox, Space, Tag, Typography, type TableProps } from "antd";
import { useEffect, useState } from "react";

import type { QuantitySheet, QuantitySheetListParams } from "../../../api/contracts";
import { requestJson } from "../../../api/client";
import { useIacucIndex } from "../../../api/iacuc";
import {
  useDeleteQuantitySheet,
  listAllQuantitySheets,
  useQuantityFilterOptions,
  useQuantitySheetDetail,
  useQuantitySheets,
} from "../../../api/quantitySheets";
import { FilterableColumnTitle } from "../../../components/FilterableTableHeader";
import { ActionButton, DataTable } from "../../../components/ui";
import { ModalShell, Pager } from "../../../components/WorkspaceUi";
import { openQuantitySheetsPrint, quantitySheetPagesMarkup } from "../../../print/quantitySheets";
import { usePdfExport } from "../hooks/usePdfExport";

export function SavedQuantitySheets({ onEdit }: { onEdit: (sheet: QuantitySheet) => void }) {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(5);
  const [sort, setSort] = useState<{ key: string; dir: "asc" | "desc" }>({ key: "month", dir: "desc" });
  const [filters, setFilters] = useState<Record<string, string[]>>({});
  const [selected, setSelected] = useState<string[]>([]);
  const [selectingAll, setSelectingAll] = useState(false);
  const [viewId, setViewId] = useState("");
  const [editId, setEditId] = useState("");
  const [deleteId, setDeleteId] = useState("");
  const [exportError, setExportError] = useState("");
  const [allFilteredSelected, setAllFilteredSelected] = useState(false);
  const pdfExport = usePdfExport();
  const params: QuantitySheetListParams = {
    limit: pageSize,
    offset: (page - 1) * pageSize,
    sortKey: sort.key,
    sortDir: sort.dir,
    columnFilters: filters,
  };
  const list = useQuantitySheets(params);
  const iacucIndex = useIacucIndex();
  const detail = useQuantitySheetDetail(viewId || editId);
  const remove = useDeleteQuantitySheet();
  const items = list.data?.items || [];
  const total = list.data?.page.total || 0;
  const pages = Math.max(Math.ceil(total / pageSize), 1);
  const iacucExpiryByCode = new Map(
    (iacucIndex.data?.items || []).map((item) => [item.iacuc.trim().toUpperCase(), item.projectEndDate]),
  );
  const toggleAllFiltered = async () => {
    if (allFilteredSelected) {
      setSelected([]);
      setAllFilteredSelected(false);
      return;
    }
    setSelectingAll(true);
    setAllFilteredSelected(true);
    try {
      const allItems = await listAllQuantitySheets(params);
      setSelected(allItems.map((item) => item.id));
    } catch (error) {
      setAllFilteredSelected(false);
      setExportError(error instanceof Error ? error.message : "无法读取全部统计表");
    } finally {
      setSelectingAll(false);
    }
  };
  const columns: TableProps<QuantitySheet>["columns"] = [
    {
      key: "selection",
      width: 52,
      title: (
        <Checkbox
          aria-label="全选当前筛选结果统计表"
          disabled={selectingAll || !total}
          checked={total > 0 && allFilteredSelected}
          onChange={() => void toggleAllFiltered()}
        />
      ),
      render: (_, item) => (
        <Checkbox
          aria-label={`选择 ${item.iacuc}`}
          checked={selected.includes(item.id)}
          onChange={(event) => {
            setAllFilteredSelected(false);
            setSelected((current) =>
              event.target.checked ? [...new Set([...current, item.id])] : current.filter((id) => id !== item.id),
            );
          }}
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
            setSelected([]);
            setAllFilteredSelected(false);
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
      width: 152,
      align: "right",
      render: (_, item) => (
        <Space size={4} className="table-actions">
          <Button size="small" type="link" onClick={() => setViewId(item.id)}>
            预览
          </Button>
          <Button size="small" type="link" onClick={() => setEditId(item.id)}>
            编辑
          </Button>
          <Button danger size="small" type="link" onClick={() => setDeleteId(item.id)}>
            删除
          </Button>
        </Space>
      ),
    },
  ];

  useEffect(() => {
    if (editId && detail.data?.item) {
      onEdit(detail.data.item);
      setEditId("");
    }
  }, [detail.data, editId, onEdit]);

  async function printSelected() {
    const sheets = await Promise.all(
      selected.map((id) =>
        requestJson<{ item: QuantitySheet }>(`/api/quantity-sheets/${encodeURIComponent(id)}`).then(
          (response) => response.item,
        ),
      ),
    );
    openQuantitySheetsPrint(sheets);
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
    <section className="panel quantity-saved-panel">
      <div className="workspace-toolbar quantity-saved-toolbar">
        <div className="workspace-toolbar-main">
          <Typography.Text className="panel-summary-chip" type="secondary">
            {selectingAll ? `正在选择全部 ${total} 条` : `${total} 条 · 已选 ${selected.length}`}
          </Typography.Text>
        </div>
        <div className="workspace-toolbar-actions">
          <Space className="workspace-toolbar-action-group">
            <ActionButton disabled={!selected.length || selectingAll} onClick={() => void printSelected()}>
              打印数量统计表
            </ActionButton>
            <ActionButton
              disabled={!selected.length || pdfExport.isExporting || selectingAll}
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
          </Space>
        </div>
      </div>
      {pdfExport.isExporting || exportError ? (
        <div className="react-inline-notice" role="status" aria-live="polite">
          {exportError || "PDF 正在后台生成，完成后会自动下载。"}
        </div>
      ) : null}
      <div className="panel-head">
        <div className="panel-title-line">
          <h2>已保存数量统计表</h2>
        </div>
      </div>
      <div className="list-meta">
        <span>{list.isFetching ? "正在加载" : `当前加载 ${items.length} 条`}</span>
        <span>
          第 {page} / {pages} 页
        </span>
      </div>
      <div className="table-wrap quantity-saved-list" role="region" tabIndex={0} aria-label="已保存数量统计表">
        <DataTable
          className="quantity-saved-table"
          columns={columns}
          dataSource={items}
          loading={list.isFetching}
          pagination={false}
          rowKey="id"
        />
      </div>
      <Pager
        page={page}
        pages={pages}
        total={total}
        pageSize={pageSize}
        onPage={setPage}
        onPageSize={(value) => {
          setPageSize(value);
          setPage(1);
          setSelected([]);
          setAllFilteredSelected(false);
        }}
      />
      {viewId ? (
        <QuantityPreviewModal sheet={detail.data?.item} loading={detail.isPending} onClose={() => setViewId("")} />
      ) : null}
      {deleteId ? (
        <ModalShell ariaLabel="删除数量统计表" onClose={() => setDeleteId("")}>
          <div className="modal-shell-head">
            <h2>删除数量统计表</h2>
          </div>
          <div className="modal-shell-body">
            <p>删除后，该统计表将退出结算合表范围。</p>
          </div>
          <div className="modal-shell-actions">
            <ActionButton onClick={() => setDeleteId("")}>取消</ActionButton>
            <ActionButton
              loading={remove.isPending}
              tone="destructive"
              onClick={async () => {
                await remove.mutateAsync(deleteId);
                setSelected((current) => current.filter((id) => id !== deleteId));
                setDeleteId("");
              }}
            >
              确认删除
            </ActionButton>
          </div>
        </ModalShell>
      ) : null}
    </section>
  );
}

function QuantityColumnTitle({
  column,
  label,
  params,
  values,
  onSort,
  onFilter,
}: {
  column: string;
  label: string;
  params: QuantitySheetListParams;
  values: string[];
  onSort: () => void;
  onFilter: (values: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const options = useQuantityFilterOptions(params, column, open);
  return (
    <FilterableColumnTitle
      label={label}
      values={values}
      options={options.data?.items || []}
      loading={options.isFetching}
      onOpenChange={setOpen}
      onSort={onSort}
      onFilter={onFilter}
    />
  );
}

function QuantityPreviewModal({
  sheet,
  loading,
  onClose,
}: {
  sheet?: QuantitySheet;
  loading: boolean;
  onClose: () => void;
}) {
  const [exportError, setExportError] = useState("");
  const pdfExport = usePdfExport();

  async function exportSheet() {
    if (!sheet) return;
    setExportError("");
    try {
      await pdfExport.exportPdf({ kind: "quantity_sheet", ids: [sheet.id] });
    } catch (error) {
      setExportError(error instanceof Error ? error.message : "PDF 导出失败");
    }
  }

  return (
    <ModalShell ariaLabel="预览数量统计表" className="quantity-react-preview" onClose={onClose}>
      <div className="modal-shell-head">
        <div>
          <h2>预览数量统计表</h2>
          <p>{sheet ? `${sheet.month} · ${sheet.iacuc}` : "正在加载"}</p>
        </div>
        <div className="modal-shell-actions">
          <ActionButton
            className="info-button"
            disabled={!sheet}
            onClick={() => sheet && openQuantitySheetsPrint([sheet])}
          >
            打印
          </ActionButton>
          <ActionButton
            className="info-button"
            disabled={!sheet || pdfExport.isExporting}
            loading={pdfExport.isExporting}
            onClick={() => void exportSheet()}
          >
            {pdfExport.isExporting ? "正在生成…" : "导出 PDF"}
          </ActionButton>
          <ActionButton onClick={onClose}>关闭</ActionButton>
        </div>
      </div>
      {pdfExport.isExporting || exportError ? (
        <div className="react-inline-notice" role="status" aria-live="polite">
          {exportError || "PDF 正在后台生成，完成后会自动下载。"}
        </div>
      ) : null}
      <div className="modal-shell-body">
        {loading || !sheet ? <div className="empty-state">正在加载...</div> : <QuantityPreview sheet={sheet} />}
      </div>
    </ModalShell>
  );
}

function QuantityPreview({ sheet }: { sheet: QuantitySheet }) {
  return (
    <div className="quantity-stat-preview" dangerouslySetInnerHTML={{ __html: quantitySheetPagesMarkup([sheet]) }} />
  );
}

function IacucExpiryTag({ endDate }: { endDate: string }) {
  const today = new Date().toISOString().slice(0, 10);
  const remainingDays = Math.ceil(
    (new Date(`${endDate}T00:00:00`).getTime() - new Date(`${today}T00:00:00`).getTime()) / 86_400_000,
  );
  const color = remainingDays < 0 ? "error" : remainingDays <= 30 ? "warning" : "blue";
  const event = remainingDays < 0 ? "已到期" : remainingDays <= 30 ? "即将到期" : "到期";
  const label = `${endDate} ${event}`;
  return <Tag color={color}>{label}</Tag>;
}

function formatTime(value: string) {
  return value ? new Date(value).toLocaleString("zh-CN", { hour12: false }) : "-";
}

function exportProgress(completed = 0, total = 0) {
  return total > 1 ? `正在导出 ${completed}/${total}` : "正在生成…";
}
