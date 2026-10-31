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
  sex: string;
  roomName: string;
  supplier: string;
  updatedAt: string;
  quantity: number | null;
  receiptDates: string[];
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
  strain: string;
  specification: string;
  sex: string;
  quantity: number | null;
  quantitySource: "reservation_prefill";
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
