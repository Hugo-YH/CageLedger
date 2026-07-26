export type BillingUnit = "cage_day" | "animal_day";

export interface CustomBillingSegment {
  id: string;
  startDate: string;
  endDate: string;
  /** `null` represents the legacy whole-sheet custom price and covers each day's full balance. */
  quantity: number | null;
  unitPrice: number | null;
  note: string;
}

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
  /** 最后保存统计表的登录用户显示姓名。 */
  manager: string;
  /** 保存时对应房间配置的房间管理员快照。 */
  roomManager: string;
  iacuc: string;
  project: string;
  pi: string;
  owner: string;
  contact: string;
  funding: string;
  preferredFreeCages: number | null;
  freeCagePriority: number | null;
  tierCagePriority: number | null;
  fullExemption: boolean;
  customBillingSegments: CustomBillingSegment[];
  /** Legacy whole-sheet custom-price fields retained for existing payloads. */
  customBillingEnabled: boolean;
  customUnitPrice: number | null;
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
