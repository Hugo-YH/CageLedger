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
  quarantineStatus?: "待接收" | "待检疫" | "检疫中" | "已检疫";
  quarantineBatches?: { id: string; name: string; completedAt: string }[];
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

/** Read-only public projection; never expose the complete intake batch or account data. */
export interface CageCardDetails {
  qrId: string;
  batchNo: string | null;
  cageCode: string | null;
  roomName: string | null;
  rackName: string | null;
  slotCode: string | null;
  iacuc: string | null;
  project: string | null;
  pi: string | null;
  owner: string | null;
  species: string | null;
  speciesLabel: string | null;
  strainStandard: string | null;
  animalCount: string | number | null;
  sex: string | null;
  birthDate: string | null;
  age: string | null;
  startDate: string | null;
  actualMoveInDate: string | null;
  endDate: string | null;
  statusLabel: string | null;
}

export interface PublicCageCardResponse {
  item: CageCardDetails;
}
