import { useState } from "react";
import { Card, Col, Empty, Flex, Row, Select, Statistic, Tag, Typography } from "antd";
import type { ColumnsType } from "antd/es/table";
import type { DataQualityColumn, DataQualityFinding, DataQualityParams } from "../../../contracts/dataQuality";
import { useDataQualityIssues, useDataQualityScans } from "../../api/dataQuality";
import { FilterableColumnTitle } from "../../components/FilterableTableHeader";
import { formatDateTime, PageSkeleton, PageState, Pager } from "../../components/WorkspaceUi";
import { ActionButton, CommandBar, DataTable, ModalPresence } from "../../components/ui";
import { ActionIcon } from "../../components/ui/ActionIcon";
import { useMediaQuery } from "../../hooks/useMediaQuery";
import { DataQualityDetail } from "./components/DataQualityDetail";

export function DataQualityView() {
  const landscapeControl = useMediaQuery("(min-width: 768px) and (max-height: 500px)");
  const scans = useDataQualityScans();
  const archives = scans.data?.pages.flatMap((page) => page.items) || [];
  const [selectedScan, setSelectedScan] = useState("");
  const scanId = selectedScan || archives[0]?.id || "";
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [filters, setFilters] = useState<DataQualityParams["columnFilters"]>({});
  const [sort, setSort] = useState<Pick<DataQualityParams, "sortKey" | "sortDir">>({});
  const [detail, setDetail] = useState<{ scanId: string; issueId: string } | null>(null);
  const list = useDataQualityIssues(scanId, {
    limit: pageSize,
    offset: (page - 1) * pageSize,
    columnFilters: filters,
    ...sort,
  });
  const scan = list.data?.scan || archives.find((item) => item.id === scanId);
  const total = list.data?.page.total || 0;
  function title(column: DataQualityColumn, label: string) {
    return (
      <FilterableColumnTitle
        label={label}
        values={filters[column] || []}
        options={list.data?.filterOptions[column] || []}
        onFilter={(values) => {
          setFilters((current) => ({ ...current, [column]: values }));
          setPage(1);
        }}
        onSort={() => {
          setSort((current) => ({
            sortKey: column,
            sortDir: current.sortKey === column && current.sortDir === "asc" ? "desc" : "asc",
          }));
          setPage(1);
        }}
      />
    );
  }
  const columns: ColumnsType<DataQualityFinding> = [
    { key: "code", title: title("code", "问题分类"), width: 204, render: (_, item) => item.codeLabel },
    {
      key: "reviewStatus",
      title: title("reviewStatus", "留档分类"),
      width: 132,
      render: (_, item) => (
        <Tag color={item.reviewStatus === "needs_review" ? "warning" : "default"}>{item.reviewStatusLabel}</Tag>
      ),
    },
    {
      key: "summary",
      title: "问题与关联记录",
      width: 420,
      render: (_, item) => (
        <Flex vertical gap={4}>
          <Typography.Text>{item.summary}</Typography.Text>
          <Typography.Text type="secondary" className="data-quality-record">
            {item.entityTypeLabel} · {item.entityId}
          </Typography.Text>
          {item.referenceId ? (
            <Typography.Text type="secondary" className="data-quality-record">
              引用记录 · {item.referenceId}
            </Typography.Text>
          ) : null}
        </Flex>
      ),
    },
    {
      key: "actions",
      title: "操作",
      width: 88,
      fixed: "right",
      render: (_, item) => (
        <ActionButton size="small" onClick={() => setDetail({ scanId, issueId: item.id })}>
          查看
        </ActionButton>
      ),
    },
  ];
  return (
    <section className="workspace-view settings-workspace data-quality-page" data-feature="administration">
      <div className="workspace-body settings-workspace-body">
        <CommandBar
          title="数据核查"
          ariaLabel="数据核查"
          description="展示核查当时的历史关联留档，不代表持续监控或完整业务核查。刷新只重新读取留档。"
          actions={
            <ActionButton
              icon={<ActionIcon name="refresh" />}
              loading={scans.isFetching || list.isFetching}
              onClick={() => {
                void scans.refetch();
                if (scanId) void list.refetch();
              }}
            >
              刷新
            </ActionButton>
          }
        />
        {scans.isPending ? (
          <PageSkeleton label="核查留档" variant="table" />
        ) : scans.isError ? (
          <PageState title="核查留档加载失败" detail={scans.error.message} retry={() => scans.refetch()} />
        ) : !archives.length ? (
          <Card>
            <Empty description="暂无核查留档" />
          </Card>
        ) : (
          <>
            <Card>
              <Flex wrap gap="middle" align="center">
                <label htmlFor="data-quality-scan">核查留档</label>
                <Select
                  id="data-quality-scan"
                  aria-label="核查留档"
                  className="data-quality-scan-select"
                  size={landscapeControl ? "large" : undefined}
                  value={scanId}
                  options={archives.map((item) => ({
                    value: item.id,
                    label: `${formatDateTime(item.scannedAt)} · ${item.trigger === "upgrade" ? "升级核查" : "离线核查"} · ${item.findingCount} 项`,
                  }))}
                  onChange={(value) => {
                    setSelectedScan(value);
                    setPage(1);
                    setFilters({});
                    setSort({});
                    setDetail(null);
                  }}
                />
                {scans.hasNextPage ? (
                  <ActionButton
                    icon={<ActionIcon name="history" />}
                    loading={scans.isFetchingNextPage}
                    onClick={() => void scans.fetchNextPage()}
                  >
                    加载更早留档
                  </ActionButton>
                ) : null}
              </Flex>
              {scan ? (
                <Typography.Paragraph type="secondary" className="data-quality-scope">
                  核查时间：{formatDateTime(scan.scannedAt)} · 核查人员：{scan.actorName}
                  <br />
                  {scan.scope}
                </Typography.Paragraph>
              ) : null}
            </Card>
            <Row gutter={[16, 16]}>
              {[
                { title: "留档问题", value: scan?.findingCount || 0 },
                { title: "待核对", value: scan?.needsReview || 0 },
                { title: "保留历史", value: scan?.retainedHistory || 0 },
              ].map((item) => (
                <Col xs={24} sm={8} key={item.title}>
                  <Card>
                    <Statistic title={item.title} value={item.value} suffix="项" />
                  </Card>
                </Col>
              ))}
            </Row>
            <Card>
              {list.isPending ? (
                <PageSkeleton label="核查问题" variant="table" />
              ) : list.isError ? (
                <PageState title="核查问题加载失败" detail={list.error.message} retry={() => list.refetch()} />
              ) : (
                <>
                  <DataTable
                    aria-label="数据核查问题"
                    className="app-data-table"
                    refreshing={list.isFetching}
                    rowKey="id"
                    columns={columns}
                    dataSource={list.data?.items || []}
                    pagination={false}
                    scroll={{ x: 844 }}
                    resizeKey="data-quality"
                    locale={{
                      emptyText: Object.values(filters).some((values) => values?.length)
                        ? "当前筛选无匹配问题"
                        : "本次留档未发现该核查范围内的关联问题",
                    }}
                  />
                  <Pager
                    page={page}
                    pageSize={pageSize}
                    pages={Math.max(Math.ceil(total / pageSize), 1)}
                    total={total}
                    onPage={setPage}
                    onPageSize={(value) => {
                      setPageSize(value);
                      setPage(1);
                    }}
                  />
                </>
              )}
            </Card>
          </>
        )}
      </div>
      <ModalPresence>
        {detail ? (
          <DataQualityDetail
            key={`${detail.scanId}:${detail.issueId}`}
            selection={detail}
            onClose={() => setDetail(null)}
          />
        ) : null}
      </ModalPresence>
    </section>
  );
}
