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
