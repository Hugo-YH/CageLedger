import type { PagedResponse } from "./common";

export type DataQualityStatus = "needs_review" | "retained_history";
export type DataQualityColumn = "code" | "reviewStatus";
export interface DataQualityOption {
  value: string;
  label: string;
  count: number;
}
export interface DataQualityScan {
  id: string;
  scannedAt: string;
  detectorVersion: string;
  latestBusinessAt: string;
  scope: string;
  trigger: string;
  actorName: string;
  sourceSha256: string;
  sourceSnapshot: { format: string; tables: Record<string, number> } | null;
  findingCount: number;
  needsReview: number;
  retainedHistory: number;
  categories: DataQualityOption[];
}
export interface DataQualityFinding {
  id: string;
  code: string;
  codeLabel: string;
  summary: string;
  reviewStatus: DataQualityStatus;
  reviewStatusLabel: string;
  entityType: string;
  entityTypeLabel: string;
  entityId: string;
  referenceId: string;
}
export interface DataQualityParams {
  limit: number;
  offset: number;
  columnFilters: Partial<Record<DataQualityColumn, string[]>>;
  sortKey?: DataQualityColumn;
  sortDir?: "asc" | "desc";
}
export interface DataQualityIssues extends PagedResponse<DataQualityFinding> {
  scan: DataQualityScan;
  filterOptions: Record<DataQualityColumn, DataQualityOption[]>;
}
export interface DataQualityLatestIssues extends Omit<DataQualityIssues, "scan"> {
  scan: DataQualityScan | null;
}
export interface DataQualityDetail {
  scan: DataQualityScan;
  item: DataQualityFinding;
  evidence: unknown;
  evidenceSha256: string;
}
