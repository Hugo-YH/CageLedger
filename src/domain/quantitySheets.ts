import type { CageRoom } from "../contracts/infrastructure";
import type { BillingUnit, CustomBillingSegment, QuantitySheet, QuantitySheetRow } from "../contracts/quantity";
import { createClientId } from "./id";

const animalDayItems = new Set(["guinea_pig", "rabbit", "monkey", "pig", "dog"]);

function numberOrNull(value: unknown) {
  if (value === "" || value == null) return null;
  const result = Number(value);
  return Number.isFinite(result) ? Math.max(result, 0) : null;
}

export function roomBillingUnit(room?: CageRoom): BillingUnit {
  return animalDayItems.has(String(room?.defaultBillingItem || "")) ? "animal_day" : "cage_day";
}

const billingProfiles: Record<
  string,
  { item: string; species: string; unit: BillingUnit; internal: number; external: number }
> = {
  mouse_standard: { item: "小鼠饲养费", species: "小鼠", unit: "cage_day", internal: 4.5, external: 13.5 },
  mouse_diabetic: { item: "糖尿病小鼠饲养费", species: "小鼠", unit: "cage_day", internal: 7.2, external: 21.6 },
  rat_standard: { item: "大鼠饲养费", species: "大鼠", unit: "cage_day", internal: 8.5, external: 25.5 },
  rat_diabetic: { item: "糖尿病大鼠饲养费", species: "大鼠", unit: "cage_day", internal: 14, external: 42 },
  guinea_pig: { item: "豚鼠饲养费", species: "豚鼠", unit: "animal_day", internal: 3, external: 9 },
  rabbit: { item: "兔饲养费", species: "兔", unit: "animal_day", internal: 5, external: 15 },
  monkey: { item: "猴饲养费", species: "猴", unit: "animal_day", internal: 35, external: 65 },
  pig: { item: "猪饲养费", species: "猪", unit: "animal_day", internal: 15, external: 45 },
  dog: { item: "犬饲养费", species: "犬", unit: "animal_day", internal: 15, external: 45 },
};

export function roomBillingProfile(room?: CageRoom) {
  const key = String(room?.defaultBillingItem || "mouse_standard");
  const profile = billingProfiles[key] || billingProfiles.mouse_standard;
  const customerType = room?.defaultCustomerType === "external" ? "external" : "internal";
  const tiered = key === "mouse_standard" && customerType === "internal";
  const freeAllowance = tiered;
  return {
    ...profile,
    customerType,
    customerLabel: customerType === "external" ? "院外" : "院内",
    facilityLabel: room?.facility === "bioisland" ? "生物岛设施" : "珠江新城设施",
    price: customerType === "external" ? profile.external : profile.internal,
    tiered,
    freeAllowance,
  };
}

export function createQuantityRow(month: string, first = false): QuantitySheetRow {
  return {
    id: createClientId(),
    date: first ? `${month}-01` : "",
    rawDateInput: first ? `${month}-01` : "",
    addedCount: null,
    addedType: "",
    transferInFromIacuc: "",
    removedCount: null,
    removedType: "",
    transferOutToIacuc: "",
    animalCount: null,
    cageCount: null,
    handler: "",
    balanceSource: "auto",
    notes: "",
  };
}

export function createCustomBillingSegment(month: string, unitPrice: number | null = null): CustomBillingSegment {
  return {
    id: createClientId(),
    startDate: `${month}-01`,
    endDate: `${month}-${String(daysInMonth(month)).padStart(2, "0")}`,
    quantity: null,
    unitPrice,
    note: "",
  };
}

function normalizeCustomBillingSegment(segment: Partial<CustomBillingSegment>, month: string): CustomBillingSegment {
  return {
    id: String(segment.id || createClientId()),
    startDate: String(segment.startDate || `${month}-01`),
    endDate: String(segment.endDate || `${month}-${String(daysInMonth(month)).padStart(2, "0")}`),
    quantity: numberOrNull(segment.quantity),
    unitPrice: numberOrNull(segment.unitPrice),
    note: String(segment.note || "").trim(),
  };
}

function legacyCustomBillingSegment(sheet: Partial<QuantitySheet>, month: string): CustomBillingSegment[] {
  if (!sheet.customBillingEnabled || !numberOrNull(sheet.customUnitPrice)) return [];
  return [
    {
      id: `legacy-custom-${String(sheet.id || "sheet")}`,
      startDate: `${month}-01`,
      endDate: `${month}-${String(daysInMonth(month)).padStart(2, "0")}`,
      quantity: null,
      unitPrice: numberOrNull(sheet.customUnitPrice),
      note: "历史整月自定义收费",
    },
  ];
}

export function normalizeQuantityRow(row: Partial<QuantitySheetRow>, month: string): QuantitySheetRow {
  return {
    ...createQuantityRow(month),
    ...row,
    id: row.id || createClientId(),
    date: String(row.date || ""),
    rawDateInput: String(row.rawDateInput ?? row.date ?? ""),
    addedCount: numberOrNull(row.addedCount),
    removedCount: numberOrNull(row.removedCount),
    animalCount: numberOrNull(row.animalCount),
    cageCount: numberOrNull(row.cageCount),
    addedType: String(row.addedType || ""),
    removedType: String(row.removedType || ""),
    transferInFromIacuc: String(row.transferInFromIacuc || "")
      .trim()
      .toUpperCase(),
    transferOutToIacuc: String(row.transferOutToIacuc || "")
      .trim()
      .toUpperCase(),
    balanceSource: row.balanceSource === "manual" ? "manual" : "auto",
  };
}

export function createQuantitySheet(month: string, manager = ""): QuantitySheet {
  return normalizeQuantitySheet({ id: createClientId(), month, manager, rows: [createQuantityRow(month, true)] });
}

export function normalizeQuantitySheet(sheet: Partial<QuantitySheet>): QuantitySheet {
  const month = sheet.month || new Date().toISOString().slice(0, 7);
  const customBillingSegments = Array.isArray(sheet.customBillingSegments)
    ? sheet.customBillingSegments.map((segment) => normalizeCustomBillingSegment(segment, month))
    : legacyCustomBillingSegment(sheet, month);
  return {
    id: sheet.id || createClientId(),
    month,
    roomId: sheet.roomId || "",
    roomName: sheet.roomName || "",
    manager: sheet.manager || "",
    roomManager: sheet.roomManager || "",
    iacuc: String(sheet.iacuc || "")
      .trim()
      .toUpperCase(),
    project: sheet.project || "",
    pi: sheet.pi || "",
    owner: sheet.owner || "",
    contact: sheet.contact || "",
    funding: sheet.funding || "",
    preferredFreeCages: numberOrNull(sheet.preferredFreeCages),
    freeCagePriority: numberOrNull(sheet.freeCagePriority),
    tierCagePriority: numberOrNull(sheet.tierCagePriority),
    fullExemption: Boolean(sheet.fullExemption),
    customBillingSegments,
    customBillingEnabled: customBillingSegments.length > 0,
    customUnitPrice: customBillingSegments.length ? numberOrNull(sheet.customUnitPrice) : null,
    billingUnit: sheet.billingUnit === "animal_day" ? "animal_day" : "cage_day",
    animalDetailEnabled: Boolean(sheet.animalDetailEnabled),
    initialAnimalCount: Number(sheet.initialAnimalCount || 0),
    initialCageCount: Number(sheet.initialCageCount || 0),
    pageCount: Math.max(Number(sheet.pageCount || 1), 1),
    rows: (sheet.rows || []).map((row) => normalizeQuantityRow(row, month)),
    updatedAt: sheet.updatedAt || "",
  };
}

export function calculateQuantityBalances(rows: QuantitySheetRow[], animalDetails: boolean) {
  let animals = 0;
  let cages = 0;
  return rows.map((row) => {
    const autoAnimals = Math.max(animals + Number(row.addedCount || 0) - Number(row.removedCount || 0), 0);
    animals = row.animalCount == null ? autoAnimals : row.animalCount;
    cages = row.cageCount == null ? (animalDetails ? animals : cages) : row.cageCount;
    return { ...row, calculatedAnimalCount: animals, calculatedCageCount: cages };
  });
}

export function validateQuantitySheet(sheet: QuantitySheet) {
  const issues: string[] = [];
  if (!sheet.month) issues.push("请选择月份");
  if (!sheet.roomId) issues.push("请选择房间");
  if (!sheet.iacuc) issues.push("请填写 IACUC 编号");
  for (const segment of sheet.customBillingSegments) {
    if (!isDateInMonth(segment.startDate, sheet.month) || !isDateInMonth(segment.endDate, sheet.month))
      issues.push("自定义收费区间必须位于统计表月份内");
    if (segment.startDate > segment.endDate) issues.push("自定义收费区间的结束日期应晚于开始日期");
    if (segment.quantity == null || segment.quantity <= 0) issues.push("请填写自定义收费区间的每日适用数量");
    if (segment.unitPrice == null || segment.unitPrice <= 0) issues.push("请填写大于 0 的自定义收费单价");
  }
  for (const row of sheet.rows) {
    if (Number(row.addedCount || 0) > 0 && !row.addedType) issues.push(`${row.date || "未填日期"} 新增请选择类型`);
    if (Number(row.removedCount || 0) > 0 && !row.removedType) issues.push(`${row.date || "未填日期"} 减少请选择类型`);
    if (row.addedType === "转入" && !row.transferInFromIacuc) issues.push(`${row.date || "未填日期"} 转入请填写伦理号`);
    if (row.removedType === "转出" && !row.transferOutToIacuc)
      issues.push(`${row.date || "未填日期"} 转出请填写伦理号`);
  }
  if (sheet.billingUnit === "animal_day" && !sheet.rows.some((row) => Number(row.animalCount || 0) > 0))
    issues.push("按只/天计费房间必须填写动物结余总数");
  return issues;
}

function isDateInMonth(value: string, month: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && value.slice(0, 7) === month;
}

function daysInMonth(month: string) {
  const [year, value] = month.split("-").map(Number);
  return year && value ? new Date(year, value, 0).getDate() : 31;
}
