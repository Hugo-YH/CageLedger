import {
  Alert,
  App,
  Button,
  Card,
  Checkbox,
  Collapse,
  Flex,
  Pagination,
  Space,
  Tag,
  Typography,
  type TableProps,
} from "antd";
import { useCallback, useEffect, useRef, useState } from "react";

import type {
  ReceptionExportRequest,
  ReceptionFilterColumn,
  ReceptionListParams,
  ReceptionPreviewResponse,
  ReceptionRecord,
  ReceptionSortKey,
} from "../../../contracts/reception";
import { formatPersonNames } from "../../../domain/personNames";
import { abbreviateSupplier } from "../../../domain/intake";
import { queryKeys } from "../../api/queryKeys";
import {
  useExportReceptions,
  usePreviewReceptions,
  useReceptionFilterOptions,
  useReceptions,
} from "../../api/reception";
import { FilterableColumnTitle } from "../../components/FilterableTableHeader";
import { PageSkeleton, PageState } from "../../components/WorkspaceUi";
import { ActionIcon, CommandBar, DataTable, Modal, ModalPresence } from "../../components/ui";
import { useLatestRequest } from "../../hooks/useLatestRequest";
import { useRetainedListData } from "../../hooks/useRetainedListData";
import { useSelectionScope } from "../../hooks/useSelectionScope";

const selectionLimit = 200;
const columnDefinitions: Array<{ key: ReceptionSortKey; label: string; width: number }> = [
  { key: "receiptDate", label: "接收日期", width: 150 },
  { key: "purchaseOrderNo", label: "采购订单编号", width: 160 },
  { key: "batchNo", label: "批次编号", width: 160 },
  { key: "iacuc", label: "IACUC编号", width: 160 },
  { key: "pi", label: "项目负责人", width: 120 },
  { key: "owner", label: "实验负责人", width: 120 },
  { key: "quantity", label: "数量", width: 80 },
  { key: "sex", label: "性别", width: 90 },
  { key: "roomName", label: "房间", width: 100 },
  { key: "supplier", label: "购买单位", width: 160 },
  { key: "projectMatched", label: "项目匹配", width: 120 },
];

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error && error.message ? error.message : fallback;
}

export function ReceptionView() {
  const { message } = App.useApp();
  const [offset, setOffset] = useState(0);
  const [limit, setLimit] = useState(20);
  const [sortKey, setSortKey] = useState<ReceptionSortKey>("receiptDate");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [columnFilters, setColumnFilters] = useState<Record<string, string[]>>({});
  const [selected, setSelected] = useState<ReceptionRecord[]>([]);
  const [selectionVersion, setSelectionVersion] = useState("");
  const [exportRequest, setExportRequest] = useState<ReceptionExportRequest | null>(null);
  const params: ReceptionListParams = { limit, offset, sortKey, sortDir, columnFilters };
  const query = useReceptions(params);
  const retained = useRetainedListData(query, queryKeys.receptions(params), "receptions");
  const data = retained.data;
  const items = data?.items ?? [];
  const page = data?.page ?? { limit, offset: 0, total: 0 };
  const applicationVersion = data?.applicationVersion ?? "";
  const clearSelection = useCallback(() => {
    setSelected([]);
    setExportRequest(null);
  }, []);
  useSelectionScope(JSON.stringify([columnFilters, applicationVersion]), clearSelection, selected.length > 0);
  const selectionBlocked = retained.blocked || (selected.length > 0 && selectionVersion !== applicationVersion);
  const selectedIds = new Set(selected.map((item) => item.id));
  const allPageSelected = items.length > 0 && items.every((item) => selectedIds.has(item.id));
  const pageSelected = items.some((item) => selectedIds.has(item.id));

  function updateSelection(next: ReceptionRecord[]) {
    if (selectionBlocked) return;
    if (next.length > selectionLimit) {
      void message.info(`每次最多导出 ${selectionLimit} 个批次，请减少选择。`);
      return;
    }
    setSelectionVersion(applicationVersion);
    setSelected(next);
  }

  function applyFilter(key: ReceptionFilterColumn, values: string[]) {
    clearSelection();
    setColumnFilters((current) => {
      const next = { ...current };
      if (values.length) next[key] = values;
      else delete next[key];
      return next;
    });
    setOffset(0);
  }

  const columns: TableProps<ReceptionRecord>["columns"] = [
    {
      key: "selection",
      fixed: "left",
      width: 48,
      title: (
        <Checkbox
          aria-label="全选当前页"
          checked={allPageSelected}
          indeterminate={pageSelected && !allPageSelected}
          disabled={selectionBlocked || !items.length}
          onChange={() =>
            updateSelection(
              allPageSelected
                ? selected.filter((item) => !items.some((row) => row.id === item.id))
                : [...selected, ...items.filter((item) => !selectedIds.has(item.id))],
            )
          }
        />
      ),
      render: (_, item) => (
        <Checkbox
          aria-label={`选择 ${item.batchNo}`}
          checked={selectedIds.has(item.id)}
          disabled={selectionBlocked || (!selectedIds.has(item.id) && selected.length >= selectionLimit)}
          onChange={(event) =>
            updateSelection(event.target.checked ? [...selected, item] : selected.filter((row) => row.id !== item.id))
          }
        />
      ),
    },
    ...columnDefinitions.map(({ key, label, width }) => ({
      key,
      width,
      align: key === "quantity" ? ("right" as const) : undefined,
      title: (
        <ReceptionColumnTitle
          column={key}
          label={label}
          params={params}
          onFilter={(values) => {
            if (key !== "quantity") applyFilter(key, values);
          }}
          onSort={() => {
            setSortKey(key);
            setSortDir(sortKey === key && sortDir === "asc" ? "desc" : "asc");
            setOffset(0);
          }}
        />
      ),
      render: (_: unknown, item: ReceptionRecord) => {
        if (key === "projectMatched")
          return <Tag color={item.projectMatched ? "green" : "gold"}>{item.projectMatched ? "已匹配" : "未匹配"}</Tag>;
        if (key === "receiptDate") return item.receiptDates.join("、") || "—";
        const value = item[key];
        const text =
          key === "supplier"
            ? abbreviateSupplier(String(value || ""))
            : key === "pi" || key === "owner"
              ? formatPersonNames(String(value || ""))
              : value;
        return (
          <span className="table-cell-text" title={String((key === "supplier" ? value : text) ?? "")}>
            {text === "" || text == null ? "—" : text}
          </span>
        );
      },
    })),
    { key: "strain", title: "品系", dataIndex: "strain", width: 160, render: (value: string) => value || "—" },
    {
      key: "specification",
      title: "规格",
      dataIndex: "specification",
      width: 130,
      render: (value: string) => value || "—",
    },
  ];

  return (
    <section className="workspace-view reception-workspace" data-feature="reception">
      <CommandBar
        ariaLabel="接收列表操作"
        title="接收列表"
        description="仅展示已接收批次。项目和负责人按 IACUC 匹配动物实验申请汇总表；导出预填内容需要人工核对。"
        context={
          <Typography.Text type="secondary">
            共 {page.total} 个批次 · 每次最多选择 {selectionLimit} 个
          </Typography.Text>
        }
        selection={{ count: selected.length, onClear: clearSelection }}
        actions={
          <Space wrap>
            {Object.keys(columnFilters).length ? (
              <Button
                icon={<ActionIcon name="clear" />}
                onClick={() => {
                  clearSelection();
                  setColumnFilters({});
                  setOffset(0);
                }}
              >
                清空筛选
              </Button>
            ) : null}
            <Button
              icon={<ActionIcon name="refresh" />}
              loading={query.isFetching}
              onClick={() => void query.refetch()}
            >
              刷新
            </Button>
          </Space>
        }
        primaryAction={
          <Button
            icon={<ActionIcon name="download" />}
            type="primary"
            disabled={selectionBlocked || !selected.length}
            onClick={() =>
              setExportRequest({
                ids: selected.map((item) => item.id),
                expectedVersions: Object.fromEntries(selected.map((item) => [item.id, item.updatedAt])),
                expectedApplicationVersion: applicationVersion,
              })
            }
          >
            导出Excel
          </Button>
        }
      />
      <div className="workspace-body">
        <Flex className="reception-stack" gap={16} vertical>
          {query.isError && data ? (
            <Alert
              showIcon
              type="error"
              title="接收列表更新失败，暂显示上次成功结果；选择和导出已暂停"
              description={errorMessage(query.error, "请检查服务连接后重试。")}
              action={
                <Button
                  icon={<ActionIcon name="refresh" />}
                  loading={query.isFetching}
                  onClick={() => void query.refetch()}
                >
                  重试
                </Button>
              }
            />
          ) : null}
          {!data ? (
            retained.loading ? (
              <PageSkeleton label="接收列表" variant="table" />
            ) : (
              <PageState
                title="接收列表加载失败"
                detail={errorMessage(query.error, "请检查服务连接后重试。")}
                retry={() => void query.refetch()}
              />
            )
          ) : (
            <Card className="reception-list-card">
              <Flex gap={16} vertical>
                <div
                  aria-label="接收批次列表"
                  aria-busy={query.isFetching}
                  className="ant-table-region"
                  role="region"
                  tabIndex={0}
                >
                  <DataTable<ReceptionRecord>
                    columns={columns}
                    dataSource={items}
                    rowKey="id"
                    resizeKey="reception-list"
                    pagination={false}
                    refreshing={query.isFetching}
                    locale={{ emptyText: "暂无已接收批次" }}
                  />
                </div>
                <Flex align="center" gap={12} justify="space-between" wrap>
                  <Typography.Text type="secondary">
                    共 {page.total} 个批次，已选择 {selected.length} 个
                  </Typography.Text>
                  <Pagination
                    current={Math.floor(page.offset / page.limit) + 1}
                    pageSize={page.limit}
                    total={page.total}
                    responsive
                    showSizeChanger={{ "aria-label": "每页显示条数" }}
                    pageSizeOptions={[10, 20, 50, 100]}
                    onChange={(next, nextLimit) => {
                      setLimit(nextLimit);
                      setOffset(nextLimit !== limit ? 0 : (next - 1) * nextLimit);
                    }}
                  />
                </Flex>
              </Flex>
            </Card>
          )}
        </Flex>
      </div>
      <ModalPresence>
        {exportRequest ? (
          <ReceptionExportDialog
            key={JSON.stringify(exportRequest)}
            request={exportRequest}
            blocked={selectionBlocked}
            onClose={() => setExportRequest(null)}
          />
        ) : null}
      </ModalPresence>
    </section>
  );
}

function ReceptionColumnTitle({
  column,
  label,
  params,
  onSort,
  onFilter,
}: {
  column: ReceptionSortKey;
  label: string;
  params: ReceptionListParams;
  onSort: () => void;
  onFilter: (values: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const filterable = column !== "quantity";
  const options = useReceptionFilterOptions(filterable ? column : "batchNo", params.columnFilters, open && filterable);
  return (
    <FilterableColumnTitle
      label={label}
      values={params.columnFilters[column] ?? []}
      options={options.data?.items ?? []}
      dateHierarchy={column === "receiptDate" ? "day" : undefined}
      filterable={filterable}
      loading={options.isFetching}
      error={options.isError ? "无法读取筛选选项，请重试" : undefined}
      onRetry={() => void options.refetch()}
      onOpenChange={setOpen}
      onSort={onSort}
      onFilter={onFilter}
    />
  );
}

function ReceptionExportDialog({
  request,
  blocked,
  onClose,
}: {
  request: ReceptionExportRequest;
  blocked: boolean;
  onClose: () => void;
}) {
  const { message } = App.useApp();
  const { mutateAsync: preview } = usePreviewReceptions();
  const download = useExportReceptions();
  const [result, setResult] = useState<ReceptionPreviewResponse | null>(null);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const busy = useRef(false);
  const { begin } = useLatestRequest();
  useEffect(() => {
    const isCurrent = begin();
    setResult(null);
    setError("");
    void preview(request).then(
      (response) => {
        if (isCurrent()) setResult(response);
      },
      (reason: unknown) => {
        if (isCurrent()) setError(errorMessage(reason, "导出预览加载失败，请重试。"));
      },
    );
  }, [attempt, begin, preview, request]);

  async function exportExcel() {
    if (busy.current || !result || blocked) return;
    busy.current = true;
    const isCurrent = begin();
    try {
      await download.mutateAsync({ ...request, expectedApplicationVersion: result.applicationVersion });
      if (!isCurrent()) return;
      void message.success("接收记录 Excel 已导出");
      onClose();
    } catch (reason) {
      if (isCurrent()) void message.error(errorMessage(reason, "Excel 导出失败，请重试。"));
    } finally {
      busy.current = false;
    }
  }
  const warnings = result
    ? [
        ...new Set([
          ...result.warnings,
          ...result.items.flatMap((item) => item.warnings.map((warning) => `${item.batchNo}：${warning}`)),
        ]),
      ]
    : [];
  return (
    <Modal
      open
      title="导出接收记录 Excel"
      aria-label="导出接收记录 Excel"
      width={720}
      mask={{ closable: !download.isPending }}
      keyboard={!download.isPending}
      closable={!download.isPending}
      onCancel={onClose}
      footer={
        <Space>
          <Button disabled={download.isPending} onClick={onClose}>
            取消
          </Button>
          <Button
            icon={<ActionIcon name="download" />}
            type="primary"
            loading={download.isPending}
            disabled={!result || blocked}
            onClick={() => void exportExcel()}
          >
            确认导出
          </Button>
        </Space>
      }
    >
      {!result ? (
        error ? (
          <Alert
            showIcon
            type="error"
            title="导出预览加载失败"
            description={error}
            action={
              <Button icon={<ActionIcon name="refresh" />} onClick={() => setAttempt((value) => value + 1)}>
                重试
              </Button>
            }
          />
        ) : (
          <PageSkeleton embedded label="接收导出预览" variant="detail" />
        )
      ) : (
        <Flex gap={16} vertical>
          <Typography.Text strong>
            已选择 {result.items.length} 个批次，Excel 共 {result.rowCount} 行
          </Typography.Text>
          <Alert
            showIcon
            type="warning"
            title="导出内容为来源预填，需人工核对"
            description="批次资料来自已接收记录，项目及负责人按 IACUC 匹配动物实验申请汇总表。预填字段和识别明细尚未构成人工确认的接收凭证，缺失项需补充核对。"
          />
          {blocked ? <Alert type="error" showIcon title="列表数据暂不可用，请关闭预览并刷新列表后重试" /> : null}
          <Collapse
            items={[
              ...(warnings.length
                ? [
                    {
                      key: "warnings",
                      label: `缺失与核对提示（${warnings.length}）`,
                      children: (
                        <ul>
                          {warnings.map((warning) => (
                            <li key={warning}>{warning}</li>
                          ))}
                        </ul>
                      ),
                    },
                  ]
                : []),
              {
                key: "sources",
                label: "查看字段来源",
                children: (
                  <Flex gap={12} vertical>
                    {result.items.map((item) => (
                      <div key={item.id}>
                        <Typography.Text strong>{item.batchNo}</Typography.Text>
                        <Typography.Paragraph type="secondary">
                          IACUC：{item.iacuc || "未填写"}；项目：{item.projectMatched ? "已匹配" : "未匹配"}
                          ；汇总表来源：{item.source.applicationSource || "无匹配来源"}；来源更新时间：
                          {item.source.applicationUpdatedAt || "未知"}；批次更新时间：{item.source.batchUpdatedAt}
                        </Typography.Paragraph>
                      </div>
                    ))}
                  </Flex>
                ),
              },
            ]}
          />
        </Flex>
      )}
    </Modal>
  );
}
