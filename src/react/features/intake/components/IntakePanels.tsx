import { Button, Checkbox, Input, Select, Space, Tag, type TableProps } from "antd";
import { useState } from "react";

import type { IntakeBatch, IntakeBatchStatus, IntakeListParams } from "../../../api/contracts";
import { useIntakeFilterOptions } from "../../../api/intake";
import { FilterableColumnTitle } from "../../../components/FilterableTableHeader";
import { DataTable } from "../../../components/ui";
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
  headActions,
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
  headActions?: React.ReactNode;
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
        {headActions ? <div className="panel-head-actions">{headActions}</div> : null}
      </div>
      <div className="intake-entry-layout">
        <div className="intake-message-field">
          <div className="intake-message-head">
            <span>预约消息识别</span>
            <Button className="compact-action" size="small" onClick={onParse}>
              识别文本
            </Button>
          </div>
          <Input.TextArea
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
          <Button className="info-button" disabled={!draft.finalCardCount || saving} onClick={onPrint}>
            打印当前笼卡
          </Button>
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
          <label className="intake-ant-field" htmlFor="intake-species">
            <span>物种</span>
            <Select
              aria-label="物种"
              id="intake-species"
              options={[
                ["mouse", "小鼠"],
                ["rat", "大鼠"],
                ["guinea_pig", "豚鼠"],
                ["rabbit", "兔"],
                ["monkey", "猴"],
                ["pig", "猪"],
                ["dog", "犬"],
              ].map(([value, label]) => ({ value, label }))}
              value={draft.species}
              onChange={(value) => onUpdate("species", value)}
            />
          </label>
          <Field label="品系" value={draft.strainStandard} onChange={(value) => onUpdate("strainStandard", value)} />
          <Field
            label="数量（只）"
            type="number"
            value={draft.quantity ?? ""}
            onChange={(value) => onUpdate("quantity", value ? Number(value) : null)}
          />
          <label className="intake-ant-field intake-ant-field-required" htmlFor="intake-room">
            <span>房间</span>
            <Select
              aria-label="房间"
              id="intake-room"
              options={[
                { value: "", label: "请选择系统房间" },
                ...roomNames.map((room) => ({ value: room, label: room })),
              ]}
              value={draft.roomName}
              onChange={(value) => onUpdate("roomName", value)}
            />
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
          <label className="intake-ant-field" htmlFor="intake-status">
            <span>状态</span>
            <Select<IntakeBatchStatus>
              aria-label="状态"
              id="intake-status"
              value={draft.status}
              options={statuses.map(([value, label]) => ({ value, label }))}
              onChange={(value) => onUpdate("status", value)}
            />
          </label>
        </div>
      </div>
    </form>
  );
}

export function IntakeBatchList({
  total,
  selectedItems,
  items,
  loading,
  selectingAll,
  allFilteredSelected,
  page,
  totalPages,
  pageSize,
  params,
  filters,
  onToggleAll,
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
  selectedItems: IntakeBatch[];
  items: IntakeBatch[];
  loading: boolean;
  selectingAll: boolean;
  allFilteredSelected: boolean;
  page: number;
  totalPages: number;
  pageSize: number;
  params: IntakeListParams;
  filters: Record<string, string[]>;
  onToggleAll: () => void;
  onToggleItem: (item: IntakeBatch, checked: boolean) => void;
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
  const columns: TableProps<IntakeBatch>["columns"] = [
    {
      key: "selection",
      width: 44,
      fixed: "left",
      title: (
        <Checkbox
          aria-label="全选当前筛选结果"
          disabled={selectingAll || !total}
          checked={total > 0 && allFilteredSelected}
          onChange={() => onToggleAll()}
        />
      ),
      render: (_, item) => (
        <Checkbox
          aria-label={`选择 ${item.batchNo}`}
          checked={selectedItems.some((selectedItem) => selectedItem.id === item.id)}
          onChange={(event) => onToggleItem(item, event.target.checked)}
        />
      ),
    },
    ...(
      [
        { key: "status", label: "状态", width: 82 },
        { key: "batchNo", label: "批次号", width: 140 },
        { key: "supplier", label: "购买单位", width: 128 },
        { key: "pi", label: "项目负责人", width: 110 },
        { key: "owner", label: "实验负责人", width: 110 },
        { key: "quantity", label: "数量", width: 64 },
        { key: "roomName", label: "房间", width: 64 },
        { key: "intakeDate", label: "接收日期", width: 108 },
        { key: "cardCount", label: "笼卡", width: 56 },
      ] as const
    ).map(({ key, label, width }) => ({
      key,
      dataIndex: key === "cardCount" ? "finalCardCount" : key,
      width,
      align: key === "quantity" || key === "cardCount" ? ("right" as const) : undefined,
      title: (
        <IntakeColumnTitle
          column={key}
          label={label}
          params={params}
          values={filters[key] || []}
          onSort={() => onSort(key)}
          onFilter={(values) => onFilter(key, values)}
        />
      ),
      render: (_: unknown, item: IntakeBatch) => {
        if (key === "status") return <Tag color={intakeStatusColor(item.status)}>{intakeStatusLabel(item.status)}</Tag>;
        if (key === "cardCount") return item.finalCardCount;
        const value = item[key];
        const text = value == null || value === "" ? "-" : String(value);
        return (
          <span className="table-cell-text" title={text}>
            {text}
          </span>
        );
      },
    })),
    {
      key: "actions",
      title: "操作",
      width: 92,
      align: "right",
      fixed: "right",
      render: (_, item) => (
        <Space size={4} className="table-actions">
          <Button size="small" type="link" onClick={() => onEdit(item)}>
            编辑
          </Button>
          <Button danger size="small" type="link" onClick={() => onDelete(item)}>
            删除
          </Button>
        </Space>
      ),
    },
  ];
  return (
    <section className="panel intake-batch-list-panel">
      <div className="panel-head">
        <div className="panel-title-line">
          <h2>待接收批次列表</h2>
        </div>
        <div className="panel-head-actions">
          <Tag className="panel-summary-chip">
            {selectingAll ? `正在选择全部 ${total} 条` : `${total} 条 · 已选 ${selectedItems.length}`}
          </Tag>
        </div>
      </div>
      {selectedItems.length ? (
        <div className="bulk-action-bar">
          <strong>已选 {selectedItems.length} 项</strong>
          <Space>
            <Button type="primary" onClick={() => onPrint(selectedItems)}>
              打印笼卡
            </Button>
            <Button onClick={() => onMarkPrinted(selectedItems)}>标记已打印</Button>
            <Button onClick={() => onReceive(selectedItems)}>确认接收</Button>
          </Space>
        </div>
      ) : null}
      <div className="list-meta">
        <span>{loading ? "正在加载" : `当前加载 ${items.length} 条`}</span>
        <span>
          第 {page} / {totalPages} 页
        </span>
      </div>
      <div className="ant-table-region" role="region" tabIndex={0} aria-label="待接收批次列表">
        <DataTable
          className="intake-batch-table"
          columns={columns}
          dataSource={items}
          loading={loading}
          pagination={false}
          rowKey="id"
          scroll={{ x: 998 }}
        />
      </div>
      <Pager page={page} pages={totalPages} total={total} pageSize={pageSize} onPage={onPage} onPageSize={onPageSize} />
    </section>
  );
}

function IntakeColumnTitle({
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

function intakeStatusColor(status: IntakeBatchStatus) {
  if (status === "received") return "green";
  if (status === "printed") return "blue";
  if (status === "pending_print") return "gold";
  return "default";
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
    <label className={`intake-ant-field${required ? " intake-ant-field-required" : ""}`}>
      <span>{label}</span>
      <Input
        type={type}
        value={value}
        min={type === "number" ? 0 : undefined}
        required={required}
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  );
}
