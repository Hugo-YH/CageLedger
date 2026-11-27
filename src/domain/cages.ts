import type { CageSlot, Occupancy } from "../contracts/infrastructure";
import { createClientId } from "./id";
import { inferSpecies, speciesLabel } from "./intake";
import { formatPersonNames } from "./personNames";

export function currentOccupancy(slotId: string, occupancies: Occupancy[]) {
  return (
    occupancies.find((item) => item.slotId === slotId && (item.status === "active" || item.status === "reserved")) ||
    null
  );
}

/** Match currentOccupancy's first active/reserved record in source order. */
export function currentOccupancyIndex(occupancies: Occupancy[]) {
  const index = new Map<string, Occupancy>();
  for (const item of occupancies) {
    if ((item.status === "active" || item.status === "reserved") && !index.has(item.slotId))
      index.set(item.slotId, item);
  }
  return index;
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

export const cageStatusLabels = {
  empty: "空位",
  active: "在用",
  reserved: "已预留",
  open: "未填结束日期",
  overdue: "超期",
} as const;

export function cageDisplayStatus(slot: CageSlot, occupancy: Occupancy | null, today: string) {
  const period = occupancyPeriodTone(occupancy, today);
  return period === "open" || period === "overdue" ? period : slot.status;
}

export function cageSpecies(occupancySpecies: string | undefined, roomSpecies: string) {
  // Legacy occupancies may store the ethics application's animal description.
  const species = occupancySpecies?.trim() || roomSpecies.trim();
  return species ? inferSpecies(species) : "";
}

export function cageOccupancyPeople(occupancy: Occupancy) {
  const pi = formatPersonNames(occupancy.pi);
  const owner = formatPersonNames(occupancy.owner);
  return {
    names: [pi, owner].filter(Boolean).join(" "),
    description: [pi && `项目负责人 ${pi}`, owner && `实验负责人 ${owner}`].filter(Boolean).join("，"),
  };
}

export function cageOccupancyDetails(occupancy: Occupancy | null, roomSpecies: string, today: string, strain?: string) {
  if (!occupancy) return null;
  const species = cageSpecies(occupancy.species, roomSpecies);
  const animal = speciesLabel(species);
  const count = occupancy.animalCount == null ? "" : `${occupancy.animalCount} 只`;
  return {
    iacuc: occupancy.iacuc || "未填写 IACUC",
    people: cageOccupancyPeople(occupancy),
    animal,
    count,
    animalSummary: [animal, count].filter(Boolean).join(" · "),
    strain: typeof strain === "string" && strain !== animal ? strain : undefined,
    monkeySummary:
      species === "monkey"
        ? `${animalSexLabel(occupancy.animalSex)} · ${animalAgeText(occupancy.birthDate, today) || "年龄未填写"}`
        : "",
  };
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
  if (value === "mixed") return "雌雄混合";
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
    id: createClientId(),
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
