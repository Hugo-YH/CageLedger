import { ActionIcon } from "../../components/ui/ActionIcon";
import { ExclamationCircleOutlined, PlusOutlined, ReloadOutlined } from "@ant-design/icons";
import { Alert, Button, Card, Space, Tag, Typography } from "antd";
import type { ColumnsType } from "antd/es/table";
import { useMemo, useState } from "react";

import type {
  FeedbackIntegration,
  FeedbackItem,
  FeedbackKind,
  FeedbackStatus,
  FeedbackSyncStatus,
} from "../../../contracts/feedback";
import { queryKeys } from "../../api/queryKeys";
import { useRetainedListData } from "../../hooks/useRetainedListData";
import { useFeedbackIntegration, useFeedbackList } from "../../api/feedback";
import type { FeedbackFilters, FeedbackListColumn } from "../../api/feedback";
import { useSystemInfo } from "../../api/administration";
import type { SessionUser } from "../../api/contracts";
import { DataTable, Feedback, HelpPopover, ModalPresence, StatusTag } from "../../components/ui";
import { CommandBar } from "../../components/ui/CommandBar";
import { formatDateTime, PageSkeleton, Pager } from "../../components/WorkspaceUi";
import { FeedbackImportDrawer } from "./FeedbackImportDrawer";
import { FeedbackColumnTitle } from "./FeedbackColumnTitle";
import { FeedbackCreateDrawer } from "./FeedbackCreateDrawer";
import { FeedbackDetailPanel } from "./FeedbackDetailDrawer";
import { KIND_LABEL, STATUS_LABEL, STATUS_TONE, SYNC_LABEL, SYNC_TONE } from "./feedbackPresentation";

export { FeedbackCreateDrawer } from "./FeedbackCreateDrawer";
export { FeedbackDetailDrawer } from "./FeedbackDetailDrawer";

export function FeedbackView({ user, page }: { user: SessionUser; page: string }) {
  const [columnFilters, setColumnFilters] = useState<FeedbackFilters["columnFilters"]>({});
  const [sort, setSort] = useState<{ key: FeedbackListColumn; dir: "asc" | "desc" }>({ key: "number", dir: "desc" });
  const [pageNumber, setPageNumber] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [drawer, setDrawer] = useState<"create" | "detail" | null>(null);
  const systemInfo = useSystemInfo(drawer === "create");
  const [importOpen, setImportOpen] = useState(false);
  const [createSession, setCreateSession] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const filters = useMemo(
    () => ({
      columnFilters,
      sortKey: sort.key,
      sortDir: sort.dir,
      limit: pageSize,
      offset: (pageNumber - 1) * pageSize,
    }),
    [columnFilters, sort, pageNumber, pageSize],
  );
  const activeFilters = Object.values(columnFilters).filter((values) => values?.length).length;
  const list = useFeedbackList(filters);
  const retained = useRetainedListData(list, queryKeys.feedback(filters), "feedback");
  const integration = useFeedbackIntegration(user.role === "admin");
  const total = retained.data?.total || 0;
  const shownSize = retained.data?.limit || pageSize;
  const shownPage = retained.data ? Math.floor(retained.data.offset / shownSize) + 1 : pageNumber;

  async function refreshFeedback() {
    await Promise.allSettled([list.refetch(), ...(user.role === "admin" ? [integration.refetch()] : [])]);
  }

  function openDetail(id: string) {
    if (retained.blocked) return;
    setSelectedId(id);
    setDrawer("detail");
  }
  function openCreate() {
    setSelectedId(null);
    setCreateSession((session) => session + 1);
    setDrawer("create");
  }

  function columnTitle(column: FeedbackListColumn, label: string) {
    return (
      <FeedbackColumnTitle
        column={column}
        label={label}
        filters={columnFilters}
        onSort={() => {
          setSort((current) => ({
            key: column,
            dir: current.key === column && current.dir === "asc" ? "desc" : "asc",
          }));
          setPageNumber(1);
        }}
        onFilter={(values) => {
          setColumnFilters((current) => ({ ...current, [column]: values }));
          setPageNumber(1);
        }}
      />
    );
  }

  const columns: ColumnsType<FeedbackItem> = [
    { title: columnTitle("number", "编号"), dataIndex: "number", width: 88, render: (number) => `#${number}` },
    {
      title: columnTitle("title", "反馈内容"),
      key: "content",
      width: 260,
      render: (_, item) => (
        <div className="feedback-title-cell">
          <Button
            aria-label={`查看反馈 #${item.number}：${item.title}`}
            type="link"
            disabled={retained.blocked}
            onClick={() => openDetail(item.id)}
          >
            {item.title}
          </Button>
        </div>
      ),
    },
    {
      title: columnTitle("kind", "类型"),
      dataIndex: "kind",
      width: 100,
      render: (value: FeedbackKind) => KIND_LABEL[value],
    },
    { title: columnTitle("module", "模块"), dataIndex: "module", width: 120 },
    {
      title: columnTitle("status", "状态"),
      dataIndex: "status",
      width: 118,
      render: (value: FeedbackStatus) => <StatusTag tone={STATUS_TONE[value]}>{STATUS_LABEL[value]}</StatusTag>,
    },
    {
      title: columnTitle("author", "提出人"),
      dataIndex: "createdBy",
      width: 120,
      render: (value: FeedbackItem["createdBy"]) => value.name,
    },
    {
      title: columnTitle("syncStatus", "同步"),
      dataIndex: "syncStatus",
      width: 120,
      render: (value: FeedbackSyncStatus) => <StatusTag tone={SYNC_TONE[value]}>{SYNC_LABEL[value]}</StatusTag>,
    },
    { title: columnTitle("encounterCount", "遇到人数"), dataIndex: "encounterCount", width: 110, align: "right" },
    {
      title: columnTitle("createdAt", "提出时间"),
      dataIndex: "createdAt",
      width: 180,
      render: (value: string) => <Typography.Text type="secondary">{formatDateTime(value)}</Typography.Text>,
    },
  ];

  return (
    <section className="workspace-view feedback-workspace" data-feature="feedback">
      <div className="workspace-body feedback-workspace-body">
        <CommandBar
          title="帮助与反馈"
          ariaLabel="反馈列表操作"
          context={
            <>
              <HelpPopover label="帮助与反馈说明" icon={<ExclamationCircleOutlined aria-hidden="true" />}>
                提交使用问题、功能建议或故障；处理状态和 Gitea 同步结果由系统返回。
              </HelpPopover>
              {user.role === "admin" && integration.data ? <IntegrationStatus {...integration.data} /> : null}
              {activeFilters ? (
                <Space size={8}>
                  <Tag>已筛选 {activeFilters} 列</Tag>
                  <Button
                    icon={<ActionIcon name="clear" />}
                    aria-label="清空筛选"
                    size="small"
                    onClick={() => {
                      setColumnFilters({});
                      setPageNumber(1);
                    }}
                  >
                    清空筛选
                  </Button>
                </Space>
              ) : null}
            </>
          }
          actions={
            <>
              {user.role === "admin" ? (
                <Button icon={<ActionIcon name="import" />} onClick={() => setImportOpen(true)}>
                  导入历史工单
                </Button>
              ) : null}
              <Button
                aria-label="刷新"
                icon={<ReloadOutlined aria-hidden="true" />}
                loading={list.isFetching}
                onClick={() => void refreshFeedback()}
              >
                刷新
              </Button>
            </>
          }
          primaryAction={
            <Button
              aria-label="提交反馈"
              type="primary"
              icon={<PlusOutlined aria-hidden="true" />}
              onClick={openCreate}
            >
              提交反馈
            </Button>
          }
        />
        <Card className="feedback-card">
          {user.role === "admin" &&
          integration.data?.configured &&
          ["recovering", "blocked", "stopped"].includes(integration.data.workerState) ? (
            <Alert
              showIcon
              type="warning"
              role="status"
              aria-live="polite"
              title={
                integration.data.workerState === "recovering"
                  ? "反馈同步服务正在恢复"
                  : integration.data.workerState === "stopped"
                    ? "反馈同步服务已停止"
                    : "反馈同步已暂停"
              }
              description={integration.data.workerError || "可在反馈详情点击“同步 Gitea”重试。"}
            />
          ) : null}
          {user.role === "admin" && integration.isError ? (
            <Alert showIcon type="warning" title="同步集成状态暂时不可用" description={integration.error.message} />
          ) : null}
          {retained.loading ? <PageSkeleton embedded label="反馈列表" variant="table" rows={5} /> : null}
          {list.isError ? (
            <Feedback
              kind="error"
              title={retained.data ? "反馈列表更新失败，暂显示上次结果" : "反馈列表加载失败"}
              detail={list.error.message}
              action={
                <Button icon={<ActionIcon name="refresh" />} onClick={() => void refreshFeedback()}>
                  重试
                </Button>
              }
            />
          ) : null}
          {retained.data ? (
            <>
              <DataTable
                className="feedback-table"
                columns={columns}
                dataSource={retained.data.items}
                locale={{ emptyText: "暂无反馈记录" }}
                pagination={false}
                refreshing={list.isFetching}
                resizeKey="feedback-list"
                rowKey="id"
                onRow={(item) => ({ onDoubleClick: () => openDetail(item.id) })}
              />
              <Pager
                page={shownPage}
                pageSize={shownSize}
                pages={Math.max(1, Math.ceil(total / shownSize))}
                total={total}
                onPage={setPageNumber}
                onPageSize={(size) => {
                  setPageSize(size);
                  setPageNumber(1);
                }}
                itemLabel="条反馈"
              />
            </>
          ) : null}
        </Card>
      </div>
      <ModalPresence>
        {drawer === "create" ? (
          <FeedbackCreateDrawer
            key={`create:${createSession}`}
            build={systemInfo.data?.build || ""}
            open
            page={page}
            onClose={() => setDrawer(null)}
            onCreated={(id) => {
              setSelectedId(id);
              setDrawer("detail");
            }}
          />
        ) : drawer === "detail" ? (
          <FeedbackDetailPanel
            key={`detail:${selectedId || "pending"}`}
            isAdmin={user.role === "admin"}
            open
            id={selectedId}
            onRemoved={() => void refreshFeedback()}
            onClose={() => {
              setDrawer(null);
              setSelectedId(null);
              void refreshFeedback();
            }}
          />
        ) : null}
      </ModalPresence>
      <ModalPresence>
        {importOpen && user.role === "admin" ? (
          <FeedbackImportDrawer
            key="feedback-import"
            onClose={() => {
              setImportOpen(false);
              void refreshFeedback();
            }}
          />
        ) : null}
      </ModalPresence>
    </section>
  );
}

function IntegrationStatus({ configured, pending, errors, workerState }: FeedbackIntegration) {
  return (
    <div className="feedback-integration">
      <StatusTag tone={configured ? "success" : "warning"}>{configured ? "Gitea 已配置" : "Gitea 未配置"}</StatusTag>
      {configured ? (
        <StatusTag tone={workerState === "running" ? "success" : "warning"}>
          {workerState === "running"
            ? "同步服务运行中"
            : workerState === "recovering"
              ? "同步服务恢复中"
              : workerState === "blocked"
                ? "同步服务已暂停"
                : "同步服务已停止"}
        </StatusTag>
      ) : null}
      {configured ? (
        <Typography.Text type="secondary">
          待同步 {pending} · 失败 {errors}
        </Typography.Text>
      ) : null}
    </div>
  );
}
