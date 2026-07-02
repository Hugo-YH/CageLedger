import type { CageSlot, Occupancy } from "../contracts/infrastructure";

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

export function animalAgeText(birthDate: string | undefined, referenceDate: string) {
  if (!birthDate || !/^\d{4}-\d{2}-\d{2}$/.test(birthDate)) return "";
  const birth = parseDateParts(birthDate);
  const reference = parseDateParts(referenceDate);
  if (!birth || !reference || birthDate > referenceDate) return "";
  let years = reference.year - birth.year;
  let months = reference.month - birth.month;
  let days = reference.day - birth.day;
  if (days < 0) {
    months -= 1;
    days += new Date(reference.year, reference.month - 1, 0).getDate();
  }
  if (months < 0) {
    years -= 1;
    months += 12;
  }
  if (years > 0) return `${years}岁${months}月`;
  if (months > 0) return `${months}月${days}天`;
  return `${Math.max(days, 0)}天`;
}

export function animalSexLabel(value: string | undefined) {
  if (value === "male") return "雄";
  if (value === "female") return "雌";
  return "未填写";
}

function parseDateParts(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  if (!year || !month || !day) return null;
  const parsed = new Date(year, month - 1, day);
  if (parsed.getFullYear() !== year || parsed.getMonth() !== month - 1 || parsed.getDate() !== day) return null;
  return { year, month, day };
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
