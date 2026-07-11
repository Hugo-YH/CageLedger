import type { BillingUnit } from "./quantity";
import type { PagedResponse } from "./common";

export interface BillingStatementLine {
  date: string;
  animalCount: number;
  cageCount: number;
  freeCages: number;
  billableCages: number;
  amount: number;
  cumulative: number;
  tier2Cages?: number;
  tier2BillableCages?: number;
  iacucBreakdown?: Record<string, unknown>[];
  quantitySheetRowIds?: string[];
}

export interface BillingStatement {
  id?: string;
  month: string;
  iacuc: string;
  iacucs?: string[];
  project: string;
  pi: string;
  owner: string;
  funding: string;
  roomName?: string;
  sourceType: "quantity_sheet" | "cage_map" | "pi_merged_quantity_sheet" | "pi_merged_cage_map";
  sourceIds?: string[];
  billingUnit?: BillingUnit | "mixed";
  freeCageAllowance?: number;
  totalTier2CageDays?: number;
  documentNumber?: string;
  generatedAt?: string;
  totalCageDays: number;
  totalAnimalDays: number;
  totalFreeCageDays: number;
  totalBillableCageDays: number;
  totalAmount: number;
  notes?: string;
}

export interface BillingStatementResponse {
  statement: BillingStatement;
  lines: BillingStatementLine[];
  workflow?: Record<string, unknown>;
}

export interface SettlementCandidate {
  id: string;
  month: string;
  pi: string;
  iacucs: string[];
  totalAmount: number | null;
  error?: string;
}

export interface SettlementCandidateListParams {
  limit: number;
  offset: number;
  sortKey?: "month" | "pi" | "iacuc" | "amount";
  sortDir?: "asc" | "desc";
  columnFilters?: Record<string, string[]>;
}

export interface SettlementCandidateListResponse extends PagedResponse<SettlementCandidate> {
  filterOptions: Record<string, Array<{ value: string; label: string; count: number }>>;
}

export interface BillingWorkflow {
  id: string;
  month: string;
  pi: string;
  iacuc: string;
  iacucs: string[];
  workflowStatus: string;
  currentVersionId: string;
  currentVersionNo: number;
  latestEventAt: string;
  totalAmount: number;
  sourceType: string;
}

export type ReimbursementStatus = "pending_submission" | "reimbursing" | "completed";

export interface ReimbursementRecord {
  id: string;
  businessKey: string;
  month: string;
  pi: string;
  workflowId: string;
  workflowStatus: string;
  reimbursementStatus: ReimbursementStatus;
  currentMonthAmount: number;
  supportAmount: number;
  payableAmount: number;
  paidAmount: number;
  unpaidAmount: number;
  accumulatedPayable: number;
  accumulatedPaid: number;
  accumulatedUnpaid: number;
  fundBookNo: string;
  reimbursementFormNo: string;
  approvedBudget: number | string;
  notes?: string;
  source: string;
  latestEventAt: string;
  updatedAt: string;
  iacucs: string[];
  details?: Array<Record<string, unknown>>;
}

export interface ReimbursementDetailResponse {
  item: ReimbursementRecord;
  workflow: BillingWorkflow | null;
  workflowVersions: Array<Record<string, unknown>>;
  workflowEvents: Array<Record<string, unknown>>;
  history: ReimbursementRecord[];
}
