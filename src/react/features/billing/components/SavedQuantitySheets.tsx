import { useEffect, useState } from "react";

import type { QuantitySheet, QuantitySheetListParams } from "../../../api/contracts";
import { requestJson } from "../../../api/client";
import {
  useDeleteQuantitySheet,
  useQuantityFilterOptions,
  useQuantitySheetDetail,
  useQuantitySheets,
} from "../../../api/quantitySheets";
import { FilterableTableHeader } from "../../../components/FilterableTableHeader";
import { ModalShell } from "../../../components/WorkspaceUi";
import { openQuantitySheetsPrint, quantitySheetPagesMarkup } from "../../../print/quantitySheets";

const pageSize = 5;

export function SavedQuantitySheets({ onEdit }: { onEdit: (sheet: QuantitySheet) => void }) {
  const [page, setPage] = useState(1);
  const [sort, setSort] = useState<{ key: string; dir: "asc" | "desc" }>({ key: "month", dir: "desc" });
  const [filters, setFilters] = useState<Record<string, string[]>>({});
  const [selected, setSelected] = useState<string[]>([]);
  const [viewId, setViewId] = useState("");
  const [editId, setEditId] = useState("");
  const [deleteId, setDeleteId] = useState("");
  const params: QuantitySheetListParams = {
    limit: pageSize,
    offset: (page - 1) * pageSize,
    sortKey: sort.key,
    sortDir: sort.dir,
    columnFilters: filters,
  };
  const list = useQuantitySheets(params);
  const detail = useQuantitySheetDetail(viewId || editId);
  const remove = useDeleteQuantitySheet();
  const items = list.data?.items || [];
  const total = list.data?.page.total || 0;
  const pages = Math.max(Math.ceil(total / pageSize), 1);

  useEffect(() => {
    if (editId && detail.data?.item) {
      onEdit(detail.data.item);
      setEditId("");
    }
  }, [detail.data, editId, onEdit]);

  async function exportSelected() {
    const sheets = await Promise.all(
      selected.map((id) =>
        requestJson<{ item: QuantitySheet }>(`/api/quantity-sheets/${encodeURIComponent(id)}`).then(
          (response) => response.item,
        ),
      ),
    );
    openQuantitySheetsPrint(sheets);
  }

  return (
    <section className="panel quantity-saved-panel">
      <div className="panel-head">
        <div className="panel-title-line">
          <h2>已保存数量统计表</h2>
        </div>
        <div className="panel-head-actions">
          <span className="panel-summary-chip">
            {total} 条 · 已选 {selected.length}
          </span>
          <button
            className="secondary info-button"
            type="button"
            disabled={!selected.length}
            onClick={() => void exportSelected()}
          >
            导出数量统计表 PDF
          </button>
        </div>
      </div>
      <div className="list-meta">
        <span>{list.isFetching ? "正在加载" : `当前加载 ${items.length} 条`}</span>
        <span>
          第 {page} / {pages} 页
        </span>
      </div>
      <div className="table-wrap" role="region" tabIndex={0} aria-label="已保存数量统计表">
        <table className="dense-table">
          <thead>
            <tr>
              <th>
                <input
                  aria-label="全选当前页统计表"
                  type="checkbox"
                  checked={items.length > 0 && items.every((item) => selected.includes(item.id))}
                  onChange={(event) => setSelected(event.target.checked ? items.map((item) => item.id) : [])}
                />
              </th>
              {[
                ["month", "月份"],
                ["iacuc", "IACUC"],
                ["roomName", "房间"],
                ["pi", "负责人"],
                ["updatedAt", "更新时间"],
              ].map(([key, label]) => (
                <QuantityHeader
                  key={key}
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
              ))}
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            {items.length ? (
              items.map((item) => (
                <tr key={item.id}>
                  <td>
                    <input
                      aria-label={`选择 ${item.iacuc}`}
                      type="checkbox"
                      checked={selected.includes(item.id)}
                      onChange={(event) =>
                        setSelected((current) =>
                          event.target.checked
                            ? [...new Set([...current, item.id])]
                            : current.filter((id) => id !== item.id),
                        )
                      }
                    />
                  </td>
                  <td>{item.month}</td>
                  <td>{item.iacuc}</td>
                  <td>{item.roomName || "-"}</td>
                  <td>{item.pi || "-"}</td>
                  <td>{formatTime(item.updatedAt)}</td>
                  <td>
                    <div className="table-actions">
                      <button
                        className="secondary info-button compact"
                        type="button"
                        onClick={() => setViewId(item.id)}
                      >
                        预览
                      </button>
                      <button
                        className="secondary info-button compact"
                        type="button"
                        onClick={() => setEditId(item.id)}
                      >
                        编辑
                      </button>
                      <button className="ghost danger-text compact" type="button" onClick={() => setDeleteId(item.id)}>
                        删除
                      </button>
                    </div>
                  </td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={7}>当前没有已保存数量统计表。</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <div className="pager">
        <span>共 {total} 条</span>
        <div>
          <button
            className="secondary"
            type="button"
            disabled={page <= 1}
            onClick={() => setPage((value) => value - 1)}
          >
            上一页
          </button>
          <button
            className="secondary"
            type="button"
            disabled={page >= pages}
            onClick={() => setPage((value) => value + 1)}
          >
            下一页
          </button>
        </div>
      </div>
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
            <button className="secondary" type="button" onClick={() => setDeleteId("")}>
              取消
            </button>
            <button
              className="danger"
              type="button"
              onClick={async () => {
                await remove.mutateAsync(deleteId);
                setSelected((current) => current.filter((id) => id !== deleteId));
                setDeleteId("");
              }}
            >
              确认删除
            </button>
          </div>
        </ModalShell>
      ) : null}
    </section>
  );
}

function QuantityHeader({
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
    <FilterableTableHeader
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
  return (
    <ModalShell ariaLabel="预览数量统计表" className="quantity-react-preview" onClose={onClose}>
      <div className="modal-shell-head">
        <div>
          <h2>预览数量统计表</h2>
          <p>{sheet ? `${sheet.month} · ${sheet.iacuc}` : "正在加载"}</p>
        </div>
        <button className="secondary" type="button" onClick={onClose}>
          关闭
        </button>
      </div>
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
function formatTime(value: string) {
  return value ? new Date(value).toLocaleString("zh-CN", { hour12: false }) : "-";
}
