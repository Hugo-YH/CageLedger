import { Alert, Button, Card, Checkbox, Flex, Pagination, Space, Tag, Typography, type TableProps } from "antd";
import { useState } from "react";

import type { IntakeBatch, IntakeBatchStatus, IntakeListParams } from "../../../api/contracts";
import { useIntakeFilterOptions } from "../../../api/intake";
import { FilterableColumnTitle } from "../../../components/FilterableTableHeader";
import { DataTable } from "../../../components/ui";
import { intakeStatusLabel } from "../../../../domain/intake";

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
          aria-label="全选筛选结果"
          checked={total > 0 && allFilteredSelected}
          disabled={selectingAll || !total}
          onChange={onToggleAll}
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
          onFilter={(values) => onFilter(key, values)}
          onSort={() => onSort(key)}
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
        <Space className="table-actions" size={4}>
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
    <Card
      className="intake-batch-list-card"
      extra={
        <Tag color="blue">
          {selectingAll ? `正在选择全部 ${total} 条` : `${total} 条 · 已选 ${selectedItems.length}`}
        </Tag>
      }
      title="待接收批次列表"
    >
      {selectedItems.length ? (
        <Alert
          className="intake-bulk-alert"
          title={
            <Flex align="center" gap={12} justify="space-between" wrap>
              <Typography.Text strong>已选 {selectedItems.length} 项</Typography.Text>
              <Space wrap>
                <Button type="primary" onClick={() => onPrint(selectedItems)}>
                  打印笼卡
                </Button>
                <Button onClick={() => onMarkPrinted(selectedItems)}>标记已打印</Button>
                <Button onClick={() => onReceive(selectedItems)}>确认接收</Button>
              </Space>
            </Flex>
          }
          showIcon
          type="info"
        />
      ) : null}
      <Flex className="intake-list-meta" justify="space-between" wrap>
        <Typography.Text type="secondary">{loading ? "正在加载" : `当前加载 ${items.length} 条`}</Typography.Text>
        <Typography.Text type="secondary">
          第 {page} / {totalPages} 页
        </Typography.Text>
      </Flex>
      <div aria-label="待接收批次列表" className="ant-table-region" role="region" tabIndex={0}>
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
      <Flex className="intake-list-pagination" justify="flex-end">
        <Pagination
          current={page}
          pageSize={pageSize}
          pageSizeOptions={[5, 10, 20, 50]}
          showQuickJumper
          showSizeChanger
          showTotal={(count) => `共 ${count} 条`}
          total={total}
          onChange={(nextPage, nextSize) => {
            if (nextSize !== pageSize) {
              onPageSize(nextSize);
              return;
            }
            onPage(nextPage);
          }}
        />
      </Flex>
    </Card>
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
      loading={options.isFetching}
      options={options.data?.items || []}
      values={values}
      onFilter={onFilter}
      onOpenChange={setOpen}
      onSort={onSort}
    />
  );
}

function intakeStatusColor(status: IntakeBatchStatus) {
  if (status === "received") return "green";
  if (status === "printed") return "blue";
  if (status === "pending_print") return "gold";
  return "default";
}
