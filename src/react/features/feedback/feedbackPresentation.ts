import type { FeedbackKind, FeedbackStatus, FeedbackSyncStatus } from "../../../contracts/feedback";

export const KIND_LABEL: Record<FeedbackKind, string> = { bug: "故障", suggestion: "功能建议", question: "使用疑问" };
export const STATUS_LABEL: Record<FeedbackStatus, string> = {
  pending: "待处理",
  in_progress: "处理中",
  verification: "待验证",
  resolved: "已解决",
  closed: "已关闭",
  conflict: "状态待确认",
  deleted: "工单已删除",
};
export const SYNC_LABEL: Record<FeedbackSyncStatus, string> = {
  pending: "等待同步",
  synced: "已同步",
  error: "同步失败",
  uncertain: "状态待核对",
  unconfigured: "未配置同步",
  removed: "已停止同步",
};
export const SYNC_TONE: Record<FeedbackSyncStatus, "default" | "processing" | "success" | "warning" | "error"> = {
  pending: "processing",
  synced: "success",
  error: "error",
  uncertain: "warning",
  unconfigured: "default",
  removed: "default",
};
export const STATUS_TONE: Record<FeedbackStatus, "default" | "processing" | "success" | "warning" | "error"> = {
  pending: "warning",
  in_progress: "processing",
  verification: "processing",
  resolved: "success",
  closed: "default",
  conflict: "error",
  deleted: "default",
};
