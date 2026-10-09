export type FeedbackKind = "bug" | "suggestion" | "question";
export type FeedbackStatus =
  "pending" | "in_progress" | "verification" | "resolved" | "closed" | "conflict" | "deleted";
export type FeedbackSyncStatus = "pending" | "synced" | "error" | "uncertain" | "unconfigured" | "removed";

export interface FeedbackAttachment {
  id: string;
  name: string;
  mime: string;
  size: number;
  url: string;
}

export interface FeedbackComment {
  id: string;
  body: string;
  author: { id?: string; name: string };
  source: "local" | "gitea";
  createdAt: string;
  updatedAt: string;
  attachments: FeedbackAttachment[];
  syncStatus?: FeedbackSyncStatus;
}

export interface FeedbackItem {
  id: string;
  number: number;
  title: string;
  kind: FeedbackKind;
  module: string;
  description: string;
  status: FeedbackStatus;
  syncStatus: FeedbackSyncStatus;
  createdBy: { id: string; name: string };
  createdAt: string;
  updatedAt: string;
  encounterCount: number;
  encountered: boolean;
  assignees: string[];
  fixVersion: string;
  lastSyncedAt: string;
  environment: { appVersion: string; build: string; page: string; browser: string };
  issueNumber: number | null;
  issueUrl?: string;
  syncError?: string;
  version: number;
  source?: "local" | "gitea";
  importMetadata?: {
    importedBy: { id: string; name: string };
    importedAt: string;
    reporterSource: "record" | "gitea";
    giteaAuthor: string;
  };
}

export interface FeedbackImportCandidate {
  number: number;
  title: string;
  kind: FeedbackKind;
  module: string;
  reporter: string;
  reporterSource: "record" | "gitea";
  state: "open" | "closed";
  status: FeedbackStatus;
  createdAt: string;
  importable: boolean;
  reason: string;
}

export interface FeedbackImportPreview {
  repository: string;
  items: FeedbackImportCandidate[];
  page: number;
  hasMore: boolean;
}

export interface FeedbackImportResult {
  items: Array<{
    number: number;
    outcome: "imported" | "skipped" | "failed";
    feedbackId?: string;
    message: string;
  }>;
}

export interface FeedbackDetail {
  item: FeedbackItem;
  attachments: FeedbackAttachment[];
  comments: FeedbackComment[];
}

export interface FeedbackListResponse {
  items: FeedbackItem[];
  total: number;
  limit: number;
  offset: number;
}

export interface FeedbackIntegration {
  configured: boolean;
  repository: string;
  pending: number;
  errors: number;
  lastError: string;
  workerState: "running" | "recovering" | "blocked" | "stopped" | "unconfigured";
  workerError: string;
}
