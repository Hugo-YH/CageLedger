import type { CageRack, CageRoom, CageSlot } from "../../api/contracts";

export type RoomDraft = CageRoom & {
  billingProfileConfigured?: boolean;
  billingProfileConfirmed?: boolean;
  rackCount?: number;
};

export function newRoomDraft(): RoomDraft {
  return {
    id: `room-${crypto.randomUUID()}`,
    name: "",
    area: "",
    roomManager: "",
    facility: "zhujiang",
    defaultSpecies: "mouse",
    defaultBillingItem: "mouse_standard",
    defaultCustomerType: "internal",
    defaultAnimalCount: 1,
    billingProfileConfigured: false,
    billingProfileConfirmed: false,
    rackCount: 0,
  };
}

export function newRackDraft(room: CageRoom, racks: CageRack[]): CageRack {
  const indexes = racks.filter((rack) => rack.roomId === room.id).map((rack) => rack.index);
  return {
    id: `rack-${crypto.randomUUID()}`,
    roomId: room.id,
    name: "",
    index: indexes.length ? Math.max(...indexes) + 1 : 1,
    rows: 6,
    cols: 10,
  };
}

export function generateSlots(rack: CageRack): CageSlot[] {
  const slots: CageSlot[] = [];
  for (let row = 1; row <= rack.rows; row += 1)
    for (let col = 1; col <= rack.cols; col += 1)
      slots.push({ id: `slot-${rack.id}-${row}-${col}`, rackId: rack.id, row, col, status: "empty" });
  return slots;
}

export function slotKey(slot: CageSlot) {
  return `${slot.row}:${slot.col}`;
}

export function facilityLabel(value?: string) {
  return value === "bioisland" ? "生物岛设施" : "珠江新城设施";
}
