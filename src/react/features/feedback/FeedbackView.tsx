import { ActionIcon } from "../../components/ui/ActionIcon";
import {
  ExclamationCircleOutlined,
  LinkOutlined,
  PlusOutlined,
  ReloadOutlined,
  SendOutlined,
  UploadOutlined,
} from "@ant-design/icons";
import {
  Alert,
  Button,
  Card,
  Checkbox,
  Collapse,
  Drawer,
  Form,
  Input,
  Select,
  Skeleton,
  Space,
  Tag,
  Typography,
  Upload,
} from "antd";
import type { ColumnsType } from "antd/es/table";
import type { UploadFile } from "antd/es/upload/interface";
import { useEffect, useMemo, useRef, useState } from "react";

import type {
  FeedbackIntegration,
  FeedbackItem,
  FeedbackKind,
  FeedbackStatus,
  FeedbackSyncStatus,
  FeedbackSubmission,
} from "../../../contracts/feedback";
import {
  uploadFeedbackAttachment,
  useAddFeedbackComment,
  useCreateFeedback,
  useFeedbackDetail,
  useFeedbackIntegration,
  useFeedbackList,
  useQueueFeedbackSync,
  useSetFeedbackEncounter,
} from "../../api/feedback";
import type { FeedbackFilters, FeedbackListColumn } from "../../api/feedback";
import { useSystemInfo } from "../../api/administration";
import type { SessionUser } from "../../api/contracts";
import { ApiError } from "../../api/client";
import { DataTable, Feedback, HelpPopover, StatusTag } from "../../components/ui";
import { CommandBar } from "../../components/ui/CommandBar";
import { formatDateTime, Pager } from "../../components/WorkspaceUi";
import { APP_VERSION } from "../../version";
import { FeedbackImportDrawer } from "./FeedbackImportDrawer";
import { FeedbackColumnTitle } from "./FeedbackColumnTitle";
import { FeedbackMarkdown } from "./FeedbackMarkdown";
import { FeedbackDiagnosticsPreview } from "./FeedbackDiagnosticsPreview";
import { captureDiagnostics } from "../../diagnostics/collector";
import { KIND_LABEL, STATUS_LABEL, STATUS_TONE, SYNC_LABEL, SYNC_TONE } from "./feedbackPresentation";

type Draft = { title: string; kind: FeedbackKind; module: string; description: string };

export function FeedbackView({ user, page }: { user: SessionUser; page: string }) {
  const systemInfo = useSystemInfo();
  const [columnFilters, setColumnFilters] = useState<FeedbackFilters["columnFilters"]>({});
  const [sort, setSort] = useState<{ key: FeedbackListColumn; dir: "asc" | "desc" }>({ key: "number", dir: "desc" });
  const [pageNumber, setPageNumber] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [drawer, setDrawer] = useState<"create" | "detail" | null>(null);
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
  const integration = useFeedbackIntegration(user.role === "admin");
  const selected = useFeedbackDetail(selectedId, drawer === "detail");
  const total = list.data?.total || 0;

  async function refreshFeedback() {
    await Promise.allSettled([list.refetch(), ...(user.role === "admin" ? [integration.refetch()] : [])]);
  }

  function openDetail(id: string) {
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
          {list.isPending ? <Skeleton active paragraph={{ rows: 8 }} /> : null}
          {list.isError ? (
            <Feedback
              kind="error"
              title="反馈列表加载失败"
              detail={list.error.message}
              action={
                <Button icon={<ActionIcon name="refresh" />} onClick={() => void refreshFeedback()}>
                  重试
                </Button>
              }
            />
          ) : null}
          {list.data ? (
            <>
              <DataTable
                className="feedback-table"
                columns={columns}
                dataSource={list.data.items}
                locale={{ emptyText: "暂无反馈记录" }}
                pagination={false}
                refreshing={list.isFetching}
                resizeKey="feedback-list"
                rowKey="id"
                onRow={(item) => ({ onDoubleClick: () => openDetail(item.id) })}
              />
              <Pager
                page={pageNumber}
                pageSize={pageSize}
                pages={Math.max(1, Math.ceil(total / pageSize))}
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
      {drawer === "create" ? (
        <FeedbackCreateDrawer
          key={createSession}
          build={systemInfo.data?.build || ""}
          open={drawer === "create"}
          page={page}
          onClose={() => setDrawer(null)}
          onCreated={(id) => {
            setSelectedId(id);
            setDrawer("detail");
          }}
        />
      ) : null}
      {importOpen && user.role === "admin" ? (
        <FeedbackImportDrawer
          onClose={() => {
            setImportOpen(false);
            void refreshFeedback();
          }}
        />
      ) : null}
      <FeedbackDetailDrawer
        isAdmin={user.role === "admin"}
        open={drawer === "detail"}
        detail={selected}
        onRemoved={() => void refreshFeedback()}
        onClose={() => {
          setDrawer(null);
          setSelectedId(null);
          void refreshFeedback();
        }}
      />
    </section>
  );
}

export function FeedbackCreateDrawer({
  build,
  open,
  page,
  onClose,
  onCreated,
}: {
  build: string;
  open: boolean;
  page: string;
  onClose: () => void;
  onCreated: (id: string) => void;
}) {
  const [form] = Form.useForm<Draft>();
  const create = useCreateFeedback();
  const requestId = useRef(crypto.randomUUID());
  const attachmentRequestIds = useRef(new Map<string, string>());
  const saving = useRef(false);
  const [files, setFiles] = useState<UploadFile[]>([]);
  const [uploadError, setUploadError] = useState("");
  const [createdId, setCreatedId] = useState("");
  const [uploading, setUploading] = useState(false);
  const [includeDiagnostics, setIncludeDiagnostics] = useState(true);
  const [previewDiagnostics, setPreviewDiagnostics] = useState(false);
  const [diagnostics, setDiagnostics] = useState(captureDiagnostics);
  const submission = useRef<FeedbackSubmission | null>(null);
  const [submissionLocked, setSubmissionLocked] = useState(false);
  const environment = { appVersion: APP_VERSION, build, page, browser: navigator.userAgent };
  const pending = create.isPending || uploading;
  async function save() {
    if (saving.current) return;
    saving.current = true;
    try {
      const values = submission.current ? null : await form.validateFields();
      setUploadError("");
      if (!submission.current && values) {
        submission.current = {
          ...values,
          requestId: requestId.current,
          environment,
          ...(includeDiagnostics ? { diagnostics } : {}),
        };
        setSubmissionLocked(true);
      }
      const item = createdId ? { id: createdId } : (await create.mutateAsync(submission.current!)).item;
      if (!createdId) setCreatedId(item.id);
      setUploading(true);
      const failed: UploadFile[] = [];
      for (const uploadFile of files) {
        const file = uploadFile.originFileObj;
        if (!file) continue;
        try {
          let attachmentRequestId = attachmentRequestIds.current.get(uploadFile.uid);
          if (!attachmentRequestId) {
            attachmentRequestId = crypto.randomUUID();
            attachmentRequestIds.current.set(uploadFile.uid, attachmentRequestId);
          }
          await uploadFeedbackAttachment(item.id, attachmentRequestId, file);
        } catch {
          failed.push(uploadFile);
        }
      }
      setFiles(failed);
      if (failed.length) {
        setUploadError("反馈已提交，但部分截图上传失败。本地已保留，可重试。");
        return;
      }
      onCreated(item.id);
    } catch (error) {
      if (!createdId && error instanceof ApiError && error.status >= 400 && error.status < 500) {
        submission.current = null;
        setSubmissionLocked(false);
      }
      setUploadError(error instanceof Error ? error.message : "提交失败，请重试");
    } finally {
      setUploading(false);
      saving.current = false;
    }
  }
  return (
    <Drawer
      destroyOnHidden
      drawerRender={(node) => (
        <div className="feedback-drawer-render" data-feature="feedback">
          {node}
        </div>
      )}
      closable={pending ? { disabled: true } : true}
      keyboard={!pending}
      mask={{ closable: !pending }}
      open={open}
      size={560}
      title="提交反馈"
      onClose={() => {
        if (!pending) onClose();
      }}
      footer={
        <Space>
          <Button disabled={pending} onClick={onClose}>
            取消
          </Button>
          <Button
            aria-label={createdId && files.length ? "重试上传" : "提交"}
            type="primary"
            disabled={pending}
            loading={pending}
            onClick={() => void save()}
          >
            {createdId && files.length ? "重试上传" : "提交"}
          </Button>
        </Space>
      }
    >
      <Form
        disabled={Boolean(createdId) || pending || submissionLocked}
        form={form}
        layout="vertical"
        initialValues={{ kind: "bug", module: "", title: "", description: "" }}
      >
        <Form.Item name="title" label="标题" rules={[{ required: true, message: "请填写标题" }]}>
          <Input maxLength={200} />
        </Form.Item>
        <Form.Item name="kind" label="类型" rules={[{ required: true }]}>
          <Select options={Object.entries(KIND_LABEL).map(([value, label]) => ({ value, label }))} />
        </Form.Item>
        <Form.Item name="module" label="涉及模块" rules={[{ required: true, message: "请填写涉及模块" }]}>
          <Input maxLength={100} placeholder="例如：笼位管理" />
        </Form.Item>
        <Form.Item name="description" label="问题描述" rules={[{ required: true, message: "请描述遇到的情况" }]}>
          <Input.TextArea
            rows={7}
            maxLength={5000}
            placeholder="支持 Markdown 标题、列表、引用和代码；截图请通过附件上传"
          />
        </Form.Item>
        <ScreenshotPicker
          canAdd={!createdId && !pending}
          canRemove={!pending}
          files={files}
          onError={setUploadError}
          onFiles={setFiles}
        />
      </Form>
      <Alert
        showIcon
        type="info"
        title="将随反馈一并提交的环境信息"
        description={`版本 ${environment.appVersion}${environment.build ? ` · Build ${environment.build}` : ""}；当前页面 ${environment.page}；浏览器 ${environment.browser}`}
      />
      <section className="feedback-diagnostics" aria-label="反馈诊断选项">
        <Space wrap>
          <Checkbox
            checked={includeDiagnostics}
            disabled={pending || submissionLocked}
            onChange={(event) => setIncludeDiagnostics(event.target.checked)}
          >
            提交反馈时附带诊断信息
          </Checkbox>
          <Button
            aria-expanded={previewDiagnostics}
            aria-controls="feedback-diagnostics-preview"
            onClick={() => setPreviewDiagnostics((value) => !value)}
          >
            {previewDiagnostics ? "收起诊断信息" : "预览诊断信息"}
          </Button>
        </Space>
        <Typography.Paragraph type="secondary">
          仅附带近期错误、失败请求和简短操作轨迹，最多 50
          条。不会包含表单内容、业务明细或登录凭据；诊断摘要将随反馈同步到项目工单。取消勾选后不会提交该摘要。
        </Typography.Paragraph>
        {previewDiagnostics ? (
          <div id="feedback-diagnostics-preview">
            <FeedbackDiagnosticsPreview snapshot={diagnostics} />
            <Button disabled={pending || submissionLocked} onClick={() => setDiagnostics(captureDiagnostics())}>
              更新诊断信息
            </Button>
          </div>
        ) : null}
      </section>
      {uploadError ? <Alert className="feedback-submit-error" showIcon type="warning" title={uploadError} /> : null}
    </Drawer>
  );
}

function ScreenshotPicker({
  canAdd,
  canRemove,
  files,
  formItem = true,
  onError,
  onFiles,
}: {
  canAdd: boolean;
  canRemove: boolean;
  files: UploadFile[];
  formItem?: boolean;
  onError: (message: string) => void;
  onFiles: (files: UploadFile[]) => void;
}) {
  const upload = (
    <Upload
      accept="image/png,image/jpeg,image/webp"
      beforeUpload={(file) => {
        if (!canAdd) return Upload.LIST_IGNORE;
        if (!["image/png", "image/jpeg", "image/webp"].includes(file.type) || file.size > 10 * 1024 * 1024) {
          onError("截图仅支持 PNG、JPEG、WebP，单张不得超过 10 MiB。");
          return Upload.LIST_IGNORE;
        }
        return false;
      }}
      fileList={files}
      maxCount={5}
      multiple
      showUploadList={{ showRemoveIcon: canRemove }}
      onChange={({ fileList }) => onFiles(fileList.slice(0, 5))}
    >
      <Button aria-label="选择截图" disabled={!canAdd} icon={<UploadOutlined aria-hidden="true" />}>
        选择截图
      </Button>
    </Upload>
  );
  return formItem ? (
    <Form.Item label="截图（可选，最多 5 张）">{upload}</Form.Item>
  ) : (
    <div className="feedback-supplement-files">{upload}</div>
  );
}

export function FeedbackDetailDrawer({
  open,
  detail,
  isAdmin,
  onClose,
  onRemoved,
}: {
  open: boolean;
  detail: ReturnType<typeof useFeedbackDetail>;
  isAdmin: boolean;
  onClose: () => void;
  onRemoved?: () => void;
}) {
  const removed =
    detail.data?.item.status === "deleted" || (detail.error instanceof ApiError && detail.error.status === 404);
  const item = removed ? undefined : detail.data?.item;
  const removalNotified = useRef(false);
  useEffect(() => {
    if (!open || !removed) removalNotified.current = false;
    else if (!removalNotified.current) {
      removalNotified.current = true;
      onRemoved?.();
    }
  }, [open, removed, onRemoved]);
  const encounter = useSetFeedbackEncounter(item?.id || "");
  const sync = useQueueFeedbackSync(item?.id || "");
  const retry = useQueueFeedbackSync(item?.id || "", true);
  const comment = useAddFeedbackComment(item?.id || "");
  const [commentBody, setCommentBody] = useState("");
  const [commentFiles, setCommentFiles] = useState<UploadFile[]>([]);
  const [supplementId, setSupplementId] = useState("");
  const [operationError, setOperationError] = useState("");
  const [uploading, setUploading] = useState(false);
  const detailPending = uploading || comment.isPending;
  const requestId = useRef(crypto.randomUUID());
  const attachmentRequestIds = useRef(new Map<string, string>());
  const submitting = useRef(false);
  useEffect(() => {
    setCommentBody("");
    setCommentFiles([]);
    setSupplementId("");
    setOperationError("");
    setUploading(false);
    requestId.current = crypto.randomUUID();
    attachmentRequestIds.current.clear();
  }, [item?.id, open]);
  async function addComment() {
    if ((!commentBody.trim() && !supplementId) || !item || submitting.current) return;
    submitting.current = true;
    setOperationError("");
    try {
      const commentId =
        supplementId || (await comment.mutateAsync({ requestId: requestId.current, body: commentBody.trim() })).item.id;
      setSupplementId(commentId);
      setUploading(true);
      const failed: UploadFile[] = [];
      for (const uploadFile of commentFiles) {
        if (!uploadFile.originFileObj) continue;
        let attachmentRequestId = attachmentRequestIds.current.get(uploadFile.uid);
        if (!attachmentRequestId) {
          attachmentRequestId = crypto.randomUUID();
          attachmentRequestIds.current.set(uploadFile.uid, attachmentRequestId);
        }
        try {
          await uploadFeedbackAttachment(item.id, attachmentRequestId, uploadFile.originFileObj, commentId);
        } catch {
          failed.push(uploadFile);
        }
      }
      setCommentFiles(failed);
      if (failed.length) {
        setOperationError("补充说明已保存，但部分截图上传失败。本地已保留，可重试。");
        return;
      }
      requestId.current = crypto.randomUUID();
      attachmentRequestIds.current.clear();
      setSupplementId("");
      setCommentBody("");
      await detail.refetch();
    } catch (error) {
      setOperationError(error instanceof Error ? error.message : "追加说明失败，请重试");
    } finally {
      setUploading(false);
      submitting.current = false;
    }
  }
  async function setEncounter() {
    if (!item) return;
    setOperationError("");
    try {
      await encounter.mutateAsync(!item.encountered);
    } catch (error) {
      setOperationError(error instanceof Error ? error.message : "更新遇到状态失败，请重试");
    }
  }
  async function requestSync(retrySync: boolean) {
    setOperationError("");
    try {
      await (retrySync ? retry : sync).mutateAsync();
    } catch (error) {
      setOperationError(error instanceof Error ? error.message : "同步请求失败，请重试");
    }
  }
  return (
    <Drawer
      destroyOnHidden
      drawerRender={(node) => (
        <div className="feedback-drawer-render" data-feature="feedback">
          {node}
        </div>
      )}
      closable={detailPending ? { disabled: true } : true}
      keyboard={!detailPending}
      mask={{ closable: !detailPending }}
      open={open}
      size={680}
      title={item ? `#${item.number} ${item.title}` : "反馈详情"}
      loading={detail.isPending}
      onClose={() => {
        if (!detailPending) onClose();
      }}
      extra={
        item ? (
          <Button
            icon={<ActionIcon name="support" />}
            aria-label={`${item.encountered ? "取消遇到" : "我也遇到"}${item.encounterCount ? ` (${item.encounterCount})` : ""}`}
            loading={encounter.isPending}
            onClick={() => void setEncounter()}
          >
            {item.encountered ? "取消遇到" : "我也遇到"}
            {item.encounterCount ? ` (${item.encounterCount})` : ""}
          </Button>
        ) : null
      }
    >
      {removed ? (
        <Feedback
          kind="empty"
          title="反馈已删除"
          detail="此反馈已从系统移除。"
          action={
            <Button icon={<ActionIcon name="back" />} onClick={onClose}>
              返回列表
            </Button>
          }
        />
      ) : detail.isError ? (
        <Feedback
          kind="error"
          title="反馈详情加载失败"
          detail={detail.error.message}
          action={
            <Button icon={<ActionIcon name="refresh" />} aria-label="重试" onClick={() => void detail.refetch()}>
              重试
            </Button>
          }
        />
      ) : null}
      {operationError ? <Alert showIcon type="warning" title={operationError} /> : null}
      {item ? (
        <div className="feedback-detail">
          <Space wrap>
            {item.source === "gitea" ? <Tag color="blue">历史工单 #{item.issueNumber}</Tag> : null}
            <Tag>{KIND_LABEL[item.kind]}</Tag>
            <StatusTag tone={STATUS_TONE[item.status]}>{STATUS_LABEL[item.status]}</StatusTag>
            <Typography.Text type="secondary">{item.module || "未分类"}</Typography.Text>
          </Space>
          <FeedbackMarkdown>{item.description}</FeedbackMarkdown>
          <Typography.Text type="secondary">
            {item.createdBy.name} 提交于 {formatDateTime(item.createdAt)} · 更新于 {formatDateTime(item.updatedAt)}
          </Typography.Text>
          <div className="feedback-meta">
            {item.source === "gitea" && item.importMetadata ? (
              <span>
                历史导入 · {item.importMetadata.importedBy.name} · {formatDateTime(item.importMetadata.importedAt)}
                {item.importMetadata.reporterSource === "gitea" ? " · 提出人未注明，显示 Gitea 登记账号" : ""}
              </span>
            ) : null}
            <span>同步状态：{SYNC_LABEL[item.syncStatus]}</span>
            {item.lastSyncedAt ? <span>最近同步：{formatDateTime(item.lastSyncedAt)}</span> : null}
            {item.fixVersion ? <span>修复版本：{item.fixVersion}</span> : null}
            {item.assignees.length ? <span>处理人：{item.assignees.join("、")}</span> : null}
          </div>
          {isAdmin ? <AdminActions item={item} sync={sync} retry={retry} onSync={requestSync} /> : null}
          <Attachments attachments={detail.data?.attachments || []} />
          {detail.data?.diagnostics ? (
            <Collapse
              items={[
                {
                  key: "diagnostics",
                  label: "随反馈提交的诊断信息",
                  children: <FeedbackDiagnosticsPreview snapshot={detail.data.diagnostics} />,
                },
              ]}
            />
          ) : null}
          <section className="feedback-comments">
            <Typography.Title level={4}>讨论</Typography.Title>
            {detail.data?.comments.length ? (
              detail.data.comments.map((entry) => (
                <article className="feedback-comment" key={entry.id}>
                  <Typography.Text strong>{entry.author.name}</Typography.Text>
                  <Typography.Text type="secondary">
                    {entry.source === "gitea" ? "Gitea" : "系统内"} · {formatDateTime(entry.createdAt)}
                  </Typography.Text>
                  <FeedbackMarkdown>{entry.body}</FeedbackMarkdown>
                  <Attachments attachments={entry.attachments} />
                </article>
              ))
            ) : (
              <Typography.Text type="secondary">暂无讨论。</Typography.Text>
            )}
            <Input.TextArea
              aria-label="追加说明内容"
              disabled={Boolean(supplementId) || uploading || comment.isPending}
              value={commentBody}
              onChange={(event) => setCommentBody(event.target.value)}
              rows={3}
              maxLength={5000}
              placeholder="追加说明（支持 Markdown）"
            />
            <ScreenshotPicker
              canAdd={!supplementId && !detailPending}
              canRemove={!detailPending}
              files={commentFiles}
              formItem={false}
              onError={setOperationError}
              onFiles={setCommentFiles}
            />
            <Button
              type="primary"
              aria-label={supplementId && commentFiles.length ? "重试补充截图" : "追加说明"}
              icon={<SendOutlined aria-hidden="true" />}
              disabled={(!commentBody.trim() && !supplementId) || detailPending}
              loading={detailPending}
              onClick={() => void addComment()}
            >
              {supplementId && commentFiles.length ? "重试补充截图" : "追加说明"}
            </Button>
          </section>
        </div>
      ) : null}
    </Drawer>
  );
}

function AdminActions({
  item,
  sync,
  retry,
  onSync,
}: {
  item: FeedbackItem;
  sync: ReturnType<typeof useQueueFeedbackSync>;
  retry: ReturnType<typeof useQueueFeedbackSync>;
  onSync: (retry: boolean) => Promise<void>;
}) {
  return (
    <div className="feedback-admin-actions">
      <Typography.Title level={5}>管理员操作</Typography.Title>
      <Typography.Text type="secondary" copyable={{ text: item.id }}>
        核对标识：{item.id}
      </Typography.Text>
      <Space wrap>
        {item.issueUrl ? (
          <Button
            aria-label="打开工单"
            icon={<LinkOutlined aria-hidden="true" />}
            onClick={() => window.open(item.issueUrl, "_blank", "noopener,noreferrer")}
          >
            打开工单{item.issueNumber ? ` #${item.issueNumber}` : ""}
          </Button>
        ) : null}
        <Button
          aria-label="同步 Gitea"
          icon={<ActionIcon name="sync" />}
          loading={sync.isPending || retry.isPending}
          onClick={() => void onSync(true)}
        >
          同步 Gitea
        </Button>
        {item.syncStatus === "error" || item.syncStatus === "uncertain" ? (
          <Button
            icon={<ActionIcon name="refresh" />}
            aria-label={item.syncStatus === "uncertain" ? "重新核对远端" : "重试同步"}
            danger={item.syncStatus === "error"}
            loading={retry.isPending}
            onClick={() => void onSync(true)}
          >
            {item.syncStatus === "uncertain" ? "重新核对远端" : "重试同步"}
          </Button>
        ) : null}
      </Space>
      {item.syncError ? <Alert showIcon type="warning" title="同步错误" description={item.syncError} /> : null}
    </div>
  );
}

function Attachments({ attachments }: { attachments: Array<{ id: string; name: string; url: string; size: number }> }) {
  if (!attachments.length) return null;
  return (
    <div className="feedback-attachments">
      <Typography.Text strong>附件</Typography.Text>
      {attachments.map((file) => (
        <a href={file.url} key={file.id} target="_blank" rel="noreferrer">
          {file.name}（{Math.ceil(file.size / 1024)} KB）
        </a>
      ))}
    </div>
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
