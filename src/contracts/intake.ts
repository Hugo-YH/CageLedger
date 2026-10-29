export type IntakeBatchStatus = "draft" | "pending_print" | "pending_receipt" | "printed" | "received";
export type IntakePurpose = "housing" | "direct_sampling";

/** Temporary request bytes; never stored in a batch payload or audit record. */
export interface IntakeRecognitionImageInput {
  name: string;
  dataUrl: string;
}

export interface IntakeRecognitionImage {
  id: string;
  name: string;
  mime: string;
  size: number;
  sha256: string;
  url: string;
  createdAt: string;
}

export interface IntakeRecognitionSource {
  /** One-based position in the submitted image list. */
  imageIndex: number;
  kind: "husbandry" | "purchase" | "unknown";
  iacuc?: string;
  batchNo?: string;
  project?: string;
  approvedQuantity?: number | null;
  remainingQuantity?: number | null;
  quantity?: number | null;
  quantityFacts?: {
    lineQuantity?: number | null;
    lineQuantityEvidence?: string;
    giftQuantity?: number | null;
    giftEvidence?: string;
    giftInclusion?: "extra" | "included" | "unknown" | "none";
    giftScope?: "current_item" | "other" | "unknown";
    currentDeliveryQuantity?: number | null;
    currentDeliveryEvidence?: string;
    deferredQuantity?: number | null;
    deferredEvidence?: string;
    purchaseNotes?: string;
  };
  maleQuantity?: number | null;
  femaleQuantity?: number | null;
  reviewNotes?: string;
  husbandryDays?: number | null;
  husbandryMonths?: number | null;
  husbandryPeriodRaw?: string;
  roomName?: string;
  intakePurpose?: IntakePurpose | "";
  finalCardCount?: number | null;
  purchaseOrderNo?: string;
  productName?: string;
  specification?: string;
  supplier?: string;
  strainRaw?: string;
  sex?: string;
  intakeDate?: string;
  endDate?: string;
}

export interface IntakeRecognitionEvidence {
  extractedText: string;
  warnings: string[];
  fieldSources: Record<string, string>;
  sources?: IntakeRecognitionSource[];
  quantityCalculation?: {
    baseQuantity: number | null;
    giftQuantity: number | null;
    addedGiftQuantity: number;
    actualQuantity: number | null;
    formula: string;
    status: "calculated" | "review_required";
    reason: string;
  };
  model?: string;
  images?: IntakeRecognitionImage[];
  /** IDs in this recognition's input order; images also contains older originals. */
  imageIds?: string[];
  inputImages?: Array<{ name: string; sha256: string }>;
}

export interface IntakeAiParseResponse {
  item: Partial<IntakeBatch>;
  usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
  recognition?: IntakeRecognitionEvidence;
}

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
  intakePurpose?: IntakePurpose;
  quarantineStatus?: "待接收" | "待检疫" | "检疫中" | "已检疫";
  quarantineBatches?: { id: string; name: string; completedAt: string }[];
  id: string;
  rawMessage: string;
  recognition?: IntakeRecognitionEvidence;
  purchaseOrderNo: string;
  batchNo: string;
  iacuc: string;
  supplier: string;
  species: string;
  strainRaw: string;
  strainStandard: string;
  specification?: string;
  sex: string;
  quantity: number | null;
  roomName: string;
  roomMatched: boolean;
  intakeDate: string;
  husbandryDays: number | null;
  /** Calendar-month intent; null means the user has manually selected days/end date. */
  husbandryMonths?: number | null;
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

/** Display/action summary; never submit this object as a complete editable batch. */
export type IntakeBatchListItem = Pick<
  IntakeBatch,
  | "id"
  | "intakePurpose"
  | "quarantineStatus"
  | "quarantineBatches"
  | "purchaseOrderNo"
  | "batchNo"
  | "iacuc"
  | "supplier"
  | "species"
  | "strainRaw"
  | "strainStandard"
  | "sex"
  | "quantity"
  | "roomName"
  | "intakeDate"
  | "pi"
  | "owner"
  | "status"
  | "notes"
  | "finalCardCount"
  | "confirmedCardCount"
  | "remainingCardCount"
  | "updatedAt"
>;

export interface IntakeSummaryExportParams {
  startDate: string;
  endDate: string;
}

export interface IntakeStatisticsPrincipal {
  pi: string;
  issue?: string;
}

export interface IntakeWriteResponse {
  item: IntakeBatch;
  placementTasks?: Record<string, unknown>[];
  auditLogs?: Record<string, unknown>[];
}

export type IntakeDuplicateMatchedField = "purchaseOrderNo" | "batchNo";

export interface IntakeDuplicateItem {
  id: string;
  purchaseOrderNo: string;
  batchNo: string;
  intakeDate: string;
  pi: string;
  owner: string;
  status: IntakeBatchStatus;
  matchedFields: IntakeDuplicateMatchedField[];
}

export interface IntakeDuplicateDetails {
  items: IntakeDuplicateItem[];
  total: number;
  confirmationToken: string;
}

export interface IntakeSaveRequest {
  item: IntakeBatch;
  exists: boolean;
  /** New interactive saves always request the server-side duplicate check. */
  checkDuplicates?: boolean;
  /** Server token bound to this draft and the complete duplicate match set. */
  duplicateConfirmation?: string;
  /** New local images, persisted alongside the successful batch transaction only. */
  recognitionImages?: IntakeRecognitionImageInput[];
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
