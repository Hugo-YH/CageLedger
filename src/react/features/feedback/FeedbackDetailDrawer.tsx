import { LinkOutlined, SendOutlined } from "@ant-design/icons";
import { Alert, Button, Collapse, Input, Space, Tag, Typography } from "antd";
import type { UploadFile } from "antd/es/upload/interface";
import { useEffect, useRef, useState } from "react";

import type { FeedbackItem } from "../../../contracts/feedback";
import {
  uploadFeedbackAttachment,
  useAddFeedbackComment,
  useFeedbackDetail,
  useQueueFeedbackSync,
  useSetFeedbackEncounter,
} from "../../api/feedback";
import { ApiError } from "../../api/client";
import { ActionIcon } from "../../components/ui/ActionIcon";
import { Feedback, StatusTag } from "../../components/ui";
import { Drawer } from "../../components/ui/Drawer";
import { formatDateTime } from "../../components/WorkspaceUi";
import { FeedbackMarkdown } from "./FeedbackMarkdown";
import { FeedbackDiagnosticsPreview } from "./FeedbackDiagnosticsPreview";
import { ScreenshotPicker } from "./ScreenshotPicker";
import { KIND_LABEL, STATUS_LABEL, STATUS_TONE, SYNC_LABEL } from "./feedbackPresentation";

export function FeedbackDetailPanel({
  id,
  ...props
}: {
  id: string | null;
  open: boolean;
  isAdmin: boolean;
  onClose: () => void;
  onRemoved?: () => void;
}) {
  const detail = useFeedbackDetail(id, props.open);
  return <FeedbackDetailDrawer detail={detail} {...props} />;
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
