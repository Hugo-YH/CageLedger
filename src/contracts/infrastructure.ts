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
