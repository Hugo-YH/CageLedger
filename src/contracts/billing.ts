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
  hasWorkflow?: boolean;
  workflowId?: string;
  workflowStatus?: string;
}

export interface SettlementCandidateListParams {
  limit: number;
  offset: number;
  sortKey?: "month" | "pi" | "iacuc" | "amount" | "workflow";
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

export type ReimbursementClaimStatus = "pending_submission" | "reimbursing" | "completed" | "void";
export type ReimbursementAllocationStatus = "draft" | "confirmed" | "reversed";

export interface SettlementObligation {
  id: string;
  workflowId: string;
  statementVersionId: string;
  statementVersionNo: number;
  month: string;
  sourcePi: string;
  iacuc: string;
  payableAmount: number;
  allocatedAmount: number;
  outstandingAmount: number;
  claimCount: number;
  obligationKind: "statement" | "adjustment";
  status: "open" | "settled";
  createdAt: string;
  updatedAt: string;
}

export interface ReimbursementAllocation {
  id: string;
  fundingLineId: string;
  obligationId: string;
  amount: number;
  status: ReimbursementAllocationStatus;
  confirmedBy: string;
  confirmedAt: string;
  reversedBy: string;
  reversedAt: string;
  reversalReason: string;
  createdBy: string;
  createdByName: string;
  createdAt: string;
  updatedAt: string;
  sourcePi: string;
  fundingOwner: string;
  iacuc: string;
  month: string;
  fundBookNo: string;
  documentNumber: string;
}

export interface ReimbursementFundingLine {
  id: string;
  claimId: string;
  fundBookNo: string;
  fundingOwner: string;
  reimbursementAmount: number;
  allocatedAmount: number;
  unallocatedAmount: number;
  sortOrder: number;
  allocations?: ReimbursementAllocation[];
}

export interface ReimbursementAttachment {
  id: string;
  claimId: string;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  sha256: string;
  ocrStatus: "disabled" | "queued" | "running" | "completed" | "failed";
  ocrResult: string;
  ocrProvider: string;
  ocrModelVersion: string;
  ocrRequestedAt: string;
  ocrCompletedAt: string;
  ocrError: string;
  createdBy: string;
  createdAt: string;
}

export interface ReimbursementClaim {
  id: string;
  documentNumber: string;
  fundingOwner: string;
  status: ReimbursementClaimStatus;
  totalAmount: number;
  allocatedAmount: number;
  unallocatedAmount: number;
  attachmentCount: number;
  fundingLineCount?: number;
  createdBy: string;
  createdByName: string;
  createdAt: string;
  updatedAt: string;
  fundingLines?: ReimbursementFundingLine[];
  attachments?: ReimbursementAttachment[];
}
