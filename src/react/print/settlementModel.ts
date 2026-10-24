import type { BillingStatement, BillingStatementLine } from "../api/contracts";
import { money, normalizeIacuc, compareSettlementSpecies, speciesLabelFor } from "./settlementSupport";

type Breakdown = {
  iacuc?: string;
  species?: string;
  animalCount?: number;
  cageCount?: number;
  freeCages?: number;
  billingItem?: string;
  billingUnit?: string;
  customerType?: string;
  unitPrice?: number;
  overageUnitPrice?: number;
  tiered?: boolean;
  freeAllowance?: boolean;
  fullExemption?: boolean;
  statementUnitPrice?: number;
  statementOverageUnitPrice?: number;
  statementTiered?: boolean;
  statementFreeAllowance?: boolean;
  statementFullExemption?: boolean;
  supportAmount?: number;
  payableAmount?: number;
  amount?: number;
  tier2Cages?: number;
  tier1BillableCages?: number;
  tier2BillableCages?: number;
};

export type SettlementColumn = {
  key: string;
  iacuc: string;
  speciesLabel: string;
  billingUnit: string;
  unitPrice: number;
  overageUnitPrice: number;
  tiered: boolean;
  hasTieredCharge: boolean;
  freeAllowance: boolean;
  fullExemption: boolean;
  showFree: boolean;
  showTiered: boolean;
  span: number;
  label: string;
  needsWideAmount: boolean;
};

export type ColumnSummary = {
  count: number;
  free: number;
  support: number;
  amount: number;
  tier2Billable: number;
  hasRecord: boolean;
};

type SettlementRow = {
  date: string;
  perColumn: Map<string, ColumnSummary>;
};

export function collectColumns(statement: BillingStatement, lines: BillingStatementLine[]) {
  const iacucOrder = new Map(
    (statement.iacucs || []).map((iacuc, index) => [normalizeIacuc(iacuc), index] as const).filter((entry) => entry[0]),
  );
  const columns = new Map<
    string,
    Omit<SettlementColumn, "showFree" | "showTiered" | "span" | "label" | "needsWideAmount">
  >();
  lines.forEach((line) =>
    (line.iacucBreakdown || []).forEach((raw) => {
      const item = raw as Breakdown;
      const iacuc = normalizeIacuc(item.iacuc);
      const key = breakdownColumnKey(item);
      if (!iacuc || !key) return;
      const existing = columns.get(key);
      if (existing) {
        existing.hasTieredCharge ||= Number(item.tier2BillableCages || 0) > 0;
        return;
      }
      columns.set(key, {
        key,
        iacuc,
        speciesLabel: speciesLabelFor(item),
        billingUnit: String(item.billingUnit || ""),
        unitPrice: Number(item.statementUnitPrice ?? item.unitPrice ?? 0),
        overageUnitPrice: Number(item.statementOverageUnitPrice ?? item.overageUnitPrice ?? 0),
        // A statement snapshots the standard mouse rate, while a line can opt
        // out of tiered charging (for example, a custom billing segment).
        // Use the effective line rule when it exists so its headers and note
        // disclose the rate that was actually applied.
        tiered: typeof item.tiered === "boolean" ? item.tiered : Boolean(item.statementTiered),
        hasTieredCharge: Number(item.tier2BillableCages || 0) > 0,
        freeAllowance: Boolean(item.statementFreeAllowance ?? item.freeAllowance),
        fullExemption: Boolean(item.statementFullExemption ?? item.fullExemption),
      });
    }),
  );
  const sorted = [...columns.values()].sort((left, right) => {
    const speciesSort = compareSettlementSpecies(left.speciesLabel, right.speciesLabel);
    if (speciesSort) return speciesSort;
    const iacucSort =
      (iacucOrder.get(left.iacuc) ?? Number.MAX_SAFE_INTEGER) -
      (iacucOrder.get(right.iacuc) ?? Number.MAX_SAFE_INTEGER);
    if (iacucSort) return iacucSort;
    const iacucTextSort = left.iacuc.localeCompare(right.iacuc, "zh-CN");
    if (iacucTextSort) return iacucTextSort;
    const unitSort = left.billingUnit.localeCompare(right.billingUnit, "zh-CN");
    if (unitSort) return unitSort;
    if (left.unitPrice !== right.unitPrice) return left.unitPrice - right.unitPrice;
    return left.key.localeCompare(right.key, "zh-CN");
  });
  const duplicateCounts = new Map<string, number>();
  sorted.forEach((column) => {
    const baseLabel = column.iacuc;
    duplicateCounts.set(baseLabel, (duplicateCounts.get(baseLabel) || 0) + 1);
  });
  return sorted.map((column) => {
    const baseLabel = column.iacuc;
    const hasDuplicate = (duplicateCounts.get(baseLabel) || 0) > 1;
    const suffix = hasDuplicate ? ` / ¥${money(column.unitPrice)}` : "";
    return {
      ...column,
      showFree: false,
      showTiered: false,
      span: 2,
      label: `${baseLabel}${suffix}`,
      needsWideAmount: false,
    };
  });
}

export function summarizeColumns(columns: SettlementColumn[], rows: SettlementRow[]) {
  const totals = columns.map((column) => ({
    key: column.key,
    count: 0,
    free: 0,
    support: 0,
    amount: 0,
    tier2Billable: 0,
    hasRecord: false,
  }));
  const byKey = new Map(totals.map((item) => [item.key, item]));
  rows.forEach((row) =>
    columns.forEach((column) => {
      const current = byKey.get(column.key);
      const item = row.perColumn.get(column.key);
      if (!current || !item) return;
      current.count += item.count;
      current.free += item.free;
      current.support += item.support;
      current.amount += item.amount;
      current.tier2Billable += item.tier2Billable;
      current.hasRecord = current.hasRecord || item.hasRecord;
    }),
  );
  return totals.map((item) => ({
    ...item,
    showFree: item.free > 0,
  }));
}

export function modelLine(line: BillingStatementLine, columns: SettlementColumn[]) {
  const perColumn = new Map(columns.map((column) => [column.key, emptySummary()]));
  const explicitBreakdown = (line.iacucBreakdown || []).filter((raw) => {
    const item = raw as Breakdown;
    return (
      item.supportAmount !== undefined ||
      item.payableAmount !== undefined ||
      item.tier2Cages !== undefined ||
      item.tier1BillableCages !== undefined ||
      item.tier2BillableCages !== undefined
    );
  });
  if (explicitBreakdown.length) {
    for (const raw of explicitBreakdown) {
      const item = raw as Breakdown;
      const columnKey = breakdownColumnKey(item);
      if (!columnKey || !perColumn.has(columnKey)) continue;
      const current = perColumn.get(columnKey) || emptySummary();
      current.count += Number(item.billingUnit === "animal_day" ? item.animalCount || 0 : item.cageCount || 0);
      current.free += Number(item.freeCages || 0);
      current.support += Number(item.supportAmount || 0);
      current.amount += Number(item.payableAmount ?? item.amount ?? 0);
      current.tier2Billable += Number(item.tier2BillableCages || 0);
      current.hasRecord = true;
      perColumn.set(columnKey, current);
    }
    return {
      date: line.date,
      perColumn,
    };
  }
  const groups = new Map<
    string,
    {
      tiered: boolean;
      unitPrice: number;
      overageUnitPrice: number;
      values: Map<string, { count: number; free: number }>;
    }
  >();
  for (const raw of line.iacucBreakdown || []) {
    const item = raw as Breakdown;
    const columnKey = breakdownColumnKey(item);
    if (!columnKey || !perColumn.has(columnKey)) continue;
    const count = Number(item.billingUnit === "animal_day" ? item.animalCount || 0 : item.cageCount || 0);
    const currentGroup:
      | {
          tiered: boolean;
          unitPrice: number;
          overageUnitPrice: number;
          values: Map<string, { count: number; free: number }>;
        }
      | undefined = groups.get(columnGroupKey(item));
    const nextGroup = currentGroup || {
      tiered: Boolean(item.tiered),
      unitPrice: Number(item.unitPrice || 0),
      overageUnitPrice: Number(item.overageUnitPrice || 0),
      values: new Map<string, { count: number; free: number }>(),
    };
    const currentValue = nextGroup.values.get(columnKey) || { count: 0, free: 0 };
    currentValue.count += count;
    currentValue.free += Number(item.freeCages || 0);
    nextGroup.values.set(columnKey, currentValue);
    groups.set(columnGroupKey(item), nextGroup);
  }

  for (const group of groups.values()) {
    let remainingTier1Slots = group.tiered ? 160 : 0;
    for (const column of columns) {
      const slot = group.values.get(column.key);
      if (!slot?.count) continue;
      const count = slot.count;
      const free = Math.min(slot.free, count);
      const current = perColumn.get(column.key) || emptySummary();
      let support = 0;
      let amount = 0;
      let tier2Count = 0;
      let tier2Billable = 0;
      if (group.tiered) {
        const tier1Count = Math.min(remainingTier1Slots, count);
        tier2Count = Math.max(count - tier1Count, 0);
        const tier1Free = Math.min(free, tier1Count);
        const tier2Free = Math.min(Math.max(free - tier1Free, 0), tier2Count);
        const tier1Billable = Math.max(tier1Count - tier1Free, 0);
        tier2Billable = Math.max(tier2Count - tier2Free, 0);
        support = tier1Free * group.unitPrice + tier2Free * group.overageUnitPrice;
        amount = tier1Billable * group.unitPrice + tier2Billable * group.overageUnitPrice;
        remainingTier1Slots = Math.max(remainingTier1Slots - tier1Count, 0);
      } else {
        support = free * group.unitPrice;
        amount = Math.max(count - free, 0) * group.unitPrice;
      }
      current.count += count;
      current.free += free;
      current.support += support;
      current.amount += amount;
      current.tier2Billable += tier2Count;
      perColumn.set(column.key, current);
    }
  }

  return {
    date: line.date,
    perColumn,
  };
}

function breakdownColumnKey(item: Breakdown) {
  const iacuc = normalizeIacuc(item.iacuc);
  if (!iacuc) return "";
  return [
    iacuc,
    speciesLabelFor(item),
    String(item.billingItem || ""),
    String(item.billingUnit || ""),
    Number(item.statementUnitPrice ?? item.unitPrice ?? 0).toFixed(2),
    Number(item.statementOverageUnitPrice ?? item.overageUnitPrice ?? 0).toFixed(2),
    (item.statementTiered ?? item.tiered) ? "1" : "0",
    (item.statementFreeAllowance ?? item.freeAllowance) ? "1" : "0",
    (item.statementFullExemption ?? item.fullExemption) ? "1" : "0",
  ].join("|");
}

function columnGroupKey(item: Breakdown) {
  return [
    String(item.billingItem || ""),
    String(item.customerType || ""),
    String(item.billingUnit || ""),
    Number(item.unitPrice || 0).toFixed(2),
    Number(item.overageUnitPrice || 0).toFixed(2),
    item.tiered ? "1" : "0",
    item.freeAllowance ? "1" : "0",
  ].join("|");
}

export function resolveUnit(statement: BillingStatement, lines: BillingStatementLine[]) {
  if (statement.billingUnit && statement.billingUnit !== "mixed") return statement.billingUnit;
  const hasAnimal = lines.some((line) =>
    (line.iacucBreakdown || []).some((item) => (item as Breakdown).billingUnit === "animal_day"),
  );
  const hasCage = lines.some((line) =>
    (line.iacucBreakdown || []).some((item) => (item as Breakdown).billingUnit !== "animal_day"),
  );
  if (hasAnimal && hasCage) return "mixed";
  return hasAnimal ? "animal_day" : "cage_day";
}

export function emptySummary(): ColumnSummary {
  return { count: 0, free: 0, support: 0, amount: 0, tier2Billable: 0, hasRecord: false };
}
