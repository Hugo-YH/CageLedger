export type UserRole = "admin" | "room_admin";

export interface SessionUser {
  id: string;
  username: string;
  displayName: string;
  role: UserRole;
  roomIds: string[];
  active: boolean;
}

export interface SessionResponse {
  user: SessionUser | null;
}

export interface RoomSummary {
  roomId: string;
  roomName: string;
  slotCount: number;
  activeCount: number;
  reservedCount: number;
  emptyCount: number;
}

export interface BootstrapResponse {
  rooms: Record<string, unknown>[];
  racks: Record<string, unknown>[];
  slots: Record<string, unknown>[];
  occupancies: Record<string, unknown>[];
  roomSummaries: RoomSummary[];
  rackSummaries: Record<string, unknown>[];
  dashboardSummary: Record<string, number> | null;
  facilitySummaries: Record<string, unknown>[];
}

export interface PageMeta {
  limit: number;
  offset: number;
  total: number;
  hasMore: boolean;
}

export interface PagedResponse<T> {
  items: T[];
  page: PageMeta;
}

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

export interface CageRoom {
  id: string;
  name: string;
  area?: string;
  facility?: string;
  defaultSpecies?: string;
  defaultBillingItem?: string;
  defaultCustomerType?: string;
  defaultAnimalCount?: number;
}

export interface CageRack {
  id: string;
  roomId: string;
  name: string;
  index: number;
  rows: number;
  cols: number;
}

export type CageSlotStatus = "empty" | "reserved" | "active";

export interface CageSlot {
  id: string;
  rackId: string;
  row: number;
  col: number;
  status: CageSlotStatus;
}

export interface Occupancy {
  id: string;
  slotId: string;
  cageCode: string;
  status: CageSlotStatus | "ended";
  iacuc: string;
  project: string;
  pi: string;
  owner: string;
  startDate: string;
  feedingDays?: number | null;
  endDate: string;
  animalCount?: number | null;
  animalSex?: string;
  birthDate?: string;
  notes: string;
  updatedAt: string;
}

export interface PlacementTask {
  id: string;
  sourceBatchId: string;
  sourceReceiptId: string;
  targetRoomId: string;
  targetRoomName: string;
  plannedMoveInDate: string;
  status: "pending" | "reserved" | "active" | "cancelled";
  batchNo: string;
  pi: string;
  owner: string;
  strainStandard?: string;
  species?: string;
  reservedOccupancyId?: string;
}

export interface RoomBootstrapResponse extends Omit<BootstrapResponse, "rooms" | "racks" | "slots" | "occupancies"> {
  rooms: CageRoom[];
  racks: CageRack[];
  slots: CageSlot[];
  occupancies: Occupancy[];
  placementTasks?: PlacementTask[];
}

export interface OccupancyWriteResponse {
  item: Occupancy;
  affectedSlots?: CageSlot[];
}

export interface PlacementWriteResponse {
  task: PlacementTask;
  occupancy?: Occupancy;
  affectedSlots?: CageSlot[];
}

export type BillingUnit = "cage_day" | "animal_day";

export interface QuantitySheetRow {
  id: string;
  date: string;
  rawDateInput: string;
  addedCount: number | null;
  addedType: string;
  transferInFromIacuc: string;
  removedCount: number | null;
  removedType: string;
  transferOutToIacuc: string;
  animalCount: number | null;
  cageCount: number | null;
  handler: string;
  balanceSource: "auto" | "manual";
  notes: string;
  transferSourceSheetId?: string;
  transferSourceIacuc?: string;
  transferMirrorContrib?: Record<string, unknown> | null;
}

export interface QuantitySheet {
  id: string;
  month: string;
  roomId: string;
  roomName: string;
  manager: string;
  iacuc: string;
  project: string;
  pi: string;
  owner: string;
  contact: string;
  funding: string;
  preferredFreeCages: number | null;
  freeCagePriority: number | null;
  billingUnit: BillingUnit;
  animalDetailEnabled: boolean;
  initialAnimalCount: number;
  initialCageCount: number;
  pageCount: number;
  rows: QuantitySheetRow[];
  updatedAt: string;
}

export interface QuantitySheetListParams {
  limit: number;
  offset: number;
  sortKey?: string;
  sortDir?: "asc" | "desc";
  columnFilters?: Record<string, string[]>;
}

export interface QuantitySheetWriteResponse {
  item: QuantitySheet;
  affectedItems?: QuantitySheet[];
}

export interface BillingStatementLine {
  date: string;
  animalCount: number;
  cageCount: number;
  freeCages: number;
  billableCages: number;
  amount: number;
  cumulative: number;
  tier2BillableCages?: number;
  iacucBreakdown?: Record<string, unknown>[];
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
}

export interface BillingStatementResponse {
  statement: BillingStatement;
  lines: BillingStatementLine[];
  workflow?: Record<string, unknown>;
}

export interface IacucIndexItem {
  iacuc: string;
  project: string;
  pi: string;
  owner: string;
  funding: string;
  projectStartDate?: string;
  projectEndDate?: string;
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

export interface ReimbursementDetailResponse {
  item: ReimbursementRecord;
  workflow: BillingWorkflow | null;
  workflowVersions: Array<Record<string, unknown>>;
  workflowEvents: Array<Record<string, unknown>>;
  history: ReimbursementRecord[];
}

export type ManagedUser = SessionUser;

export interface PrincipalIdentity {
  pi: string;
  principalType: "pi" | "independent";
  freeCageAllowance: number;
  updatedAt: string;
}

export interface IacucIndexStatus {
  count: number;
  updatedAt: string;
  source: string;
}

export interface AuditEvent {
  id: string;
  message: string;
  actorDisplayName: string;
  action: string;
  entityType: string;
  at: string;
}

export interface SystemInfo {
  name: string;
  title: string;
  version: string;
  organization: string;
  department: string;
  developer: string;
  contactEmail: string;
  license: string;
  copyright: string;
  repositoryUrl: string;
  revisionShort: string;
}

export interface SystemUpdateStatus {
  currentVersion?: string | null;
  latestVersion?: string | null;
  latestUrl?: string | null;
  latestMessage?: string | null;
  updateAvailable?: boolean | null;
  checkedAt?: string;
  disabled?: boolean;
}
