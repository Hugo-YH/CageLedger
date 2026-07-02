import { useState } from "react";

import type { IntakeBatch, IntakeBatchStatus, IntakeListParams } from "../../../api/contracts";
import { useIntakeFilterOptions } from "../../../api/intake";
import { FilterableTableHeader } from "../../../components/FilterableTableHeader";
import { Pager } from "../../../components/WorkspaceUi";
import { intakeStatusLabel } from "../../../../domain/intake";

const statuses: Array<[IntakeBatchStatus, string]> = [
  ["pending_print", "未打印"],
  ["printed", "已打印"],
  ["received", "已接收"],
  ["draft", "草稿"],
];

export function IntakeEntryPanel({
  editing,
  draft,
  roomNames,
  notice,
  saving,
  onSubmit,
  onNew,
  onParse,
  onPrint,
  onUpdate,
}: {
  editing: boolean;
  draft: IntakeBatch;
  roomNames: string[];
  notice: string;
  saving: boolean;
  onSubmit: React.FormEventHandler<HTMLFormElement>;
  onNew: () => void;
  onParse: () => void;
  onPrint: () => void;
  onUpdate: <K extends keyof IntakeBatch>(key: K, value: IntakeBatch[K]) => void;
}) {
  return (
    <form id="intake-entry-panel" className="panel large intake-entry-panel" onSubmit={onSubmit}>
      <div className="panel-head">
        <div className="panel-title-line">
          <h2>{editing ? "编辑接收笼卡" : "接收笼卡"}</h2>
        </div>
        <div className="panel-head-actions">
          <button className="secondary" type="button" onClick={onNew}>
            新建批次
          </button>
          <button className="primary" type="submit" disabled={saving}>
            {saving ? "保存中..." : "保存待接收批次"}
          </button>
        </div>
      </div>
      <div className="intake-entry-layout">
        <div className="intake-message-field">
          <div className="intake-message-head">
            <span>预约消息识别</span>
            <button className="secondary compact-action" type="button" onClick={onParse}>
              识别文本
            </button>
          </div>
          <textarea
            aria-label="预约消息"
            rows={6}
            value={draft.rawMessage}
            onChange={(event) => onUpdate("rawMessage", event.target.value)}
            placeholder="粘贴预约接收文本，自动提取批次号、供应商、品系、数量、房间和接收日期。"
          />
        </div>
        <div className="intake-action-panel">
          <strong>{draft.finalCardCount || 0} 张笼卡</strong>
          <span>{draft.batchNo || "尚未识别批次"}</span>
          <button
            className="secondary info-button"
            type="button"
            disabled={!draft.finalCardCount || saving}
            onClick={onPrint}
          >
            打印当前笼卡
          </button>
        </div>
      </div>
      {notice ? (
        <div className="react-inline-notice" role="status">
          {notice}
        </div>
      ) : null}
      <div className="intake-form-grid">
        <div className="intake-field-row three">
          <Field label="购买单位" required value={draft.supplier} onChange={(value) => onUpdate("supplier", value)} />
          <Field label="批次号" value={draft.batchNo} onChange={(value) => onUpdate("batchNo", value)} />
          <Field label="IACUC 编号" required value={draft.iacuc} onChange={(value) => onUpdate("iacuc", value)} />
        </div>
        <div className="intake-field-row two">
          <Field label="项目负责人" required value={draft.pi} onChange={(value) => onUpdate("pi", value)} />
          <Field label="实验负责人" required value={draft.owner} onChange={(value) => onUpdate("owner", value)} />
        </div>
        <div className="intake-field-row four">
          <label>
            物种
            <select value={draft.species} onChange={(event) => onUpdate("species", event.target.value)}>
              <option value="mouse">小鼠</option>
              <option value="rat">大鼠</option>
              <option value="guinea_pig">豚鼠</option>
              <option value="rabbit">兔</option>
              <option value="monkey">猴</option>
              <option value="pig">猪</option>
              <option value="dog">犬</option>
            </select>
          </label>
          <Field label="品系" value={draft.strainStandard} onChange={(value) => onUpdate("strainStandard", value)} />
          <Field
            label="数量（只）"
            type="number"
            value={draft.quantity ?? ""}
            onChange={(value) => onUpdate("quantity", value ? Number(value) : null)}
          />
          <label className="field-required">
            房间
            <select required value={draft.roomName} onChange={(event) => onUpdate("roomName", event.target.value)}>
              <option value="">请选择系统房间</option>
              {roomNames.map((room) => (
                <option key={room} value={room}>
                  {room}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="intake-field-row three">
          <Field
            label="接收日期"
            required
            type="date"
            value={draft.intakeDate}
            onChange={(value) => onUpdate("intakeDate", value)}
          />
          <Field
            label="饲养周期（天）"
            type="number"
            value={draft.husbandryDays ?? ""}
            onChange={(value) => onUpdate("husbandryDays", value ? Number(value) : null)}
          />
          <Field label="结束日期" type="date" value={draft.endDate} onChange={(value) => onUpdate("endDate", value)} />
        </div>
        <div className="intake-field-row three">
          <Field label="性别" value={draft.sex} onChange={(value) => onUpdate("sex", value)} />
          <Field label="接收人员" value={draft.receiverName} onChange={(value) => onUpdate("receiverName", value)} />
          <Field label="兽医电话" value={draft.vetPhone} onChange={(value) => onUpdate("vetPhone", value)} />
        </div>
        <div className="intake-field-row two">
          <Field
            label="打印张数"
            type="number"
            value={draft.finalCardCount}
            onChange={(value) => onUpdate("finalCardCount", Number(value) || 0)}
          />
          <label>
            状态
            <select
              value={draft.status}
              onChange={(event) => onUpdate("status", event.target.value as IntakeBatchStatus)}
            >
              {statuses.map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
        </div>
      </div>
    </form>
  );
}

export function IntakeBatchList({
  total,
  selected,
  selectedItems,
  items,
  loading,
  page,
  totalPages,
  pageSize,
  params,
  filters,
  onTogglePage,
  onToggleItem,
  onSort,
  onFilter,
  onPrint,
  onMarkPrinted,
  onReceive,
  onEdit,
  onDelete,
  onPage,
  onPageSize,
}: {
  total: number;
  selected: string[];
  selectedItems: IntakeBatch[];
  items: IntakeBatch[];
  loading: boolean;
  page: number;
  totalPages: number;
  pageSize: number;
  params: IntakeListParams;
  filters: Record<string, string[]>;
  onTogglePage: (checked: boolean) => void;
  onToggleItem: (id: string, checked: boolean) => void;
  onSort: (key: string) => void;
  onFilter: (key: string, values: string[]) => void;
  onPrint: (items: IntakeBatch[]) => void;
  onMarkPrinted: (items: IntakeBatch[]) => void;
  onReceive: (items: IntakeBatch[]) => void;
  onEdit: (item: IntakeBatch) => void;
  onDelete: (item: IntakeBatch) => void;
  onPage: (page: number) => void;
  onPageSize: (pageSize: number) => void;
}) {
  return (
    <section className="panel intake-batch-list-panel">
      <div className="panel-head">
        <div className="panel-title-line">
          <h2>待接收批次列表</h2>
        </div>
        <div className="panel-head-actions">
          <span className="panel-summary-chip">
            {total} 条 · 已选 {selected.length}
          </span>
        </div>
      </div>
      {selectedItems.length ? (
        <div className="bulk-action-bar">
          <strong>已选 {selectedItems.length} 项</strong>
          <div>
            <button className="primary" type="button" onClick={() => onPrint(selectedItems)}>
              打印笼卡
            </button>
            <button className="secondary" type="button" onClick={() => onMarkPrinted(selectedItems)}>
              标记已打印
            </button>
            <button className="secondary" type="button" onClick={() => onReceive(selectedItems)}>
              确认接收
            </button>
          </div>
        </div>
      ) : null}
      <div className="list-meta">
        <span>{loading ? "正在加载" : `当前加载 ${items.length} 条`}</span>
        <span>
          第 {page} / {totalPages} 页
        </span>
      </div>
      <div className="table-wrap" role="region" tabIndex={0} aria-label="待接收批次列表">
        <table className="workflow-table intake-batch-table dense-table">
          <thead>
            <tr>
              <th>
                <input
                  type="checkbox"
                  aria-label="全选当前页"
                  checked={items.length > 0 && selectedItems.length === items.length}
                  onChange={(event) => onTogglePage(event.target.checked)}
                />
              </th>
              {[
                ["status", "状态"],
                ["batchNo", "批次号"],
                ["supplier", "购买单位"],
                ["pi", "项目负责人"],
                ["owner", "实验负责人"],
                ["quantity", "数量"],
                ["roomName", "房间"],
                ["intakeDate", "接收日期"],
                ["cardCount", "笼卡"],
              ].map(([key, label]) => (
                <IntakeHeader
                  key={key}
                  column={key}
                  label={label}
                  params={params}
                  values={filters[key] || []}
                  onSort={() => onSort(key)}
                  onFilter={(values) => {
                    onFilter(key, values);
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
                      type="checkbox"
                      aria-label={`选择 ${item.batchNo}`}
                      checked={selected.includes(item.id)}
                      onChange={(event) => onToggleItem(item.id, event.target.checked)}
                    />
                  </td>
                  <td>
                    <span className={`pill ${item.status}`}>{intakeStatusLabel(item.status)}</span>
                  </td>
                  <td>
                    <span className="table-cell-text" title={item.batchNo}>
                      {item.batchNo}
                    </span>
                  </td>
                  <td>
                    <span className="table-cell-text" title={item.supplier}>
                      {item.supplier}
                    </span>
                  </td>
                  <td>
                    <span className="table-cell-text" title={item.pi || "-"}>
                      {item.pi || "-"}
                    </span>
                  </td>
                  <td>
                    <span className="table-cell-text" title={item.owner || "-"}>
                      {item.owner || "-"}
                    </span>
                  </td>
                  <td>{item.quantity ?? "-"}</td>
                  <td>{item.roomName || "-"}</td>
                  <td>{item.intakeDate || "-"}</td>
                  <td>{item.finalCardCount}</td>
                  <td>
                    <div className="table-actions">
                      <button className="ghost info-button compact" type="button" onClick={() => onEdit(item)}>
                        编辑
                      </button>
                      <button className="ghost danger-text compact" type="button" onClick={() => onDelete(item)}>
                        删除
                      </button>
                    </div>
                  </td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={11}>
                  <div className="empty-state">
                    <h3>暂无待接收批次</h3>
                    <p>在上方识别预约消息并保存后，批次会显示在这里。</p>
                  </div>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <Pager page={page} pages={totalPages} total={total} pageSize={pageSize} onPage={onPage} onPageSize={onPageSize} />
    </section>
  );
}

function IntakeHeader({
  column,
  label,
  params,
  values,
  onSort,
  onFilter,
}: {
  column: string;
  label: string;
  params: IntakeListParams;
  values: string[];
  onSort: () => void;
  onFilter: (values: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const options = useIntakeFilterOptions(params, column, open);
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

function Field({
  label,
  value,
  onChange,
  type = "text",
  required = false,
}: {
  label: string;
  value: string | number;
  onChange: (value: string) => void;
  type?: string;
  required?: boolean;
}) {
  return (
    <label className={required ? "field-required" : undefined}>
      {label}
      <input
        type={type}
        value={value}
        min={type === "number" ? 0 : undefined}
        required={required}
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  );
}
