export type IntakeBatchStatus = "draft" | "pending_print" | "printed" | "received";

export interface IntakeCard {
  id: string;
  index: number;
  label: string;
  suggestedQuantity: string;
  qrId: string;
}

export interface IntakeReceipt {
  id?: string;
  actualReceiptDate: string;
  cardCount: number;
  createdAt?: string;
}

export interface IntakeBatch {
  id: string;
  rawMessage: string;
  purchaseOrderNo: string;
  batchNo: string;
  iacuc: string;
  supplier: string;
  species: string;
  strainRaw: string;
  strainStandard: string;
  sex: string;
  quantity: number | null;
  roomName: string;
  roomMatched: boolean;
  intakeDate: string;
  husbandryDays: number | null;
  endDate: string;
  project: string;
  pi: string;
  owner: string;
  receiverName: string;
  vetPhone: string;
  notes: string;
  status: IntakeBatchStatus;
  suggestedAnimalsPerCage: number;
  suggestedCardCount: number;
  finalCardCount: number;
  confirmedCardCount: number;
  remainingCardCount: number;
  receipts: IntakeReceipt[];
  cards: IntakeCard[];
  updatedAt: string;
}

export interface IntakeListParams {
  limit: number;
  offset: number;
  sortKey?: string;
  sortDir?: "asc" | "desc";
  columnFilters?: Record<string, string[]>;
}

export interface IntakeWriteResponse {
  item: IntakeBatch;
  placementTasks?: Record<string, unknown>[];
  auditLogs?: Record<string, unknown>[];
}

export interface PublicCageCardResponse {
  batch: IntakeBatch;
  card: IntakeCard;
}
