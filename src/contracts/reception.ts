import type { PageMeta } from "./common";

export interface ReceptionRecord {
  id: string;
  batchId: string;
  batchNo: string;
  purchaseOrderNo: string;
  iacuc: string;
  pi: string;
  owner: string;
  project: string;
  funding: string;
  fundCode: string;
  projectEndDate: string;
  strain: string;
  specification: string;
  grade?: string;
  sex: string;
  roomName: string;
  supplier: string;
  updatedAt: string;
  quantity: number | null;
  receiptDates: string[];
  receiptDateSource?: "actual" | "original" | "missing";
  receipts?: Array<{ id: string; actualReceiptDate: string }>;
  registrationUpdatedAt?: string | null;
  registeredQuantity?: number | null;
  certificateCount?: number;
  registrationStatus?: "unconfirmed" | "confirmed" | "stale";
  projectMatched: boolean;
  warnings: string[];
  source: {
    batchUpdatedAt: string;
    applicationUpdatedAt: string | null;
    applicationSource: string | null;
  };
}

export type ReceptionFilterColumn =
  | "batchNo"
  | "purchaseOrderNo"
  | "iacuc"
  | "pi"
  | "owner"
  | "roomName"
  | "supplier"
  | "sex"
  | "receiptDate"
  | "projectMatched";
export type ReceptionSortKey = ReceptionFilterColumn | "quantity";

export interface ReceptionListParams {
  limit: number;
  offset: number;
  sortKey: ReceptionSortKey;
  sortDir: "asc" | "desc";
  columnFilters: Record<string, string[]>;
}

export interface ReceptionListResponse {
  items: ReceptionRecord[];
  page: PageMeta;
  applicationVersion: string;
}

export interface ReceptionExportRequest {
  ids: string[];
  expectedVersions: Record<string, string>;
  expectedApplicationVersion: string;
  expectedRegistrationVersions?: Record<string, string | null>;
}

export interface ReceptionCertificateAttachment {
  id: string;
  batchId: string;
  name: string;
  size: number;
  sha256: string;
  pageCount: number;
  createdAt: string;
  createdBy: string;
  fileUrl: string;
  previewUrl: string;
}

export interface ReceptionCertificateLine {
  id: string;
  attachmentId: string;
  runId: string | null;
  certificateIndex: number;
  certificateLineIndex: number;
  certificateNo: string;
  certificateStrain: string;
  grade: string;
  supplier: string;
  sex: string;
  quantity: number | null;
  weightRaw: string;
  ageRaw: string;
  specification: string;
  receiptId: string | null;
  experimentCertificateNo: string;
  notes: string;
}

export interface ReceptionRecognitionRun {
  id: string;
  attachmentId: string;
  batchId: string;
  status: "running" | "completed" | "failed";
  sourceBatchUpdatedAt: string;
  createdAt: string;
  updatedAt: string;
  error: string;
  result: { lines: ReceptionCertificateLine[]; warnings: string[] } | null;
  model: string;
}

export interface ReceptionRegistration {
  id: string;
  batchId: string;
  updatedAt: string;
  sourceBatchUpdatedAt: string;
  applicationVersion: string;
  confirmedAt: string;
  confirmedBy: string;
  lines: ReceptionCertificateLine[];
  warnings: string[];
}

export interface ReceptionRegistrationResponse {
  batch: ReceptionRecord;
  applicationVersion: string;
  registration: ReceptionRegistration | null;
  attachments: ReceptionCertificateAttachment[];
  runs: ReceptionRecognitionRun[];
  canWrite: boolean;
}

export interface ReceptionRecognitionRequest {
  requestId: string;
  expectedBatchUpdatedAt: string;
}

export interface ReceptionRegistrationSaveRequest {
  requestId: string;
  expectedBatchUpdatedAt: string;
  expectedRegistrationUpdatedAt: string | null;
  expectedApplicationVersion: string;
  acknowledged: true;
  lines: ReceptionCertificateLine[];
}

export interface ReceptionRegistrationLine {
  batchId: string;
  receiptId: string | null;
  registrationId: string | null;
  project: Pick<ReceptionRecord, "iacuc" | "pi" | "owner" | "project" | "funding" | "fundCode" | "projectEndDate">;
  source: ReceptionRecord["source"];
  purchaseOrderNo: string;
  batchNo: string;
  actualReceiptDate: string;
  originalReceiptDate?: string;
  strain: string;
  specification: string;
  sex: string;
  quantity: number | null;
  quantitySource: "reservation_prefill" | "certificate_confirmed";
  supplier: string;
  roomName: string;
  certificateStrain: string;
  grade: string;
  qualityCertificateNo: string;
  experimentCertificateNo: string;
  notes: string;
  warnings: string[];
}

export interface ReceptionPreviewResponse {
  items: ReceptionRecord[];
  rows: ReceptionRegistrationLine[];
  rowCount: number;
  applicationVersion: string;
  warnings: string[];
}
