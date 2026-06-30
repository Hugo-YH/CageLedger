import type { CageSlot, Occupancy } from "../react/api/contracts";

export function currentOccupancy(slotId: string, occupancies: Occupancy[]) {
  return (
    occupancies.find((item) => item.slotId === slotId && (item.status === "active" || item.status === "reserved")) ||
    null
  );
}

export function slotPosition(slot: CageSlot) {
  return `${columnLabel(slot.col)}${slot.row}`;
}

export function cageCode(slot: CageSlot, rackIndex = 1, roomName = "") {
  return [roomName, String(rackIndex).padStart(2, "0"), slotPosition(slot)].filter(Boolean).join("-");
}

function columnLabel(index: number) {
  let value = Math.max(Math.floor(index), 1);
  let label = "";
  while (value > 0) {
    value -= 1;
    label = String.fromCharCode(65 + (value % 26)) + label;
    value = Math.floor(value / 26);
  }
  return label;
}

export function occupancyPeriodTone(occupancy: Occupancy | null, today: string) {
  if (!occupancy || occupancy.status !== "active") return "";
  if (!occupancy.endDate) return "open";
  return today > occupancy.endDate ? "overdue" : "normal";
}

export function emptyOccupancy(slotId: string, code: string, today: string): Occupancy {
  return {
    id: crypto.randomUUID(),
    slotId,
    cageCode: code,
    status: "active",
    iacuc: "",
    project: "",
    pi: "",
    owner: "",
    startDate: today,
    endDate: "",
    notes: "",
    updatedAt: today,
  };
}
