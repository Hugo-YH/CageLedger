import type { BillingStatementLine } from "../api/contracts";
import { escapeHtml, money, normalizeIacuc, numberText, speciesLabelFor } from "./settlementSupport";

type SettlementNoteColumn = {
  speciesLabel: string;
  billingUnit: string;
  unitPrice: number;
  overageUnitPrice: number;
  tiered: boolean;
  hasTieredCharge: boolean;
};

type CustomBillingBreakdown = {
  iacuc?: string;
  species?: string;
  billingItem?: string;
  animalCount?: number;
  cageCount?: number;
  billingUnit?: string;
  unitPrice?: number;
  amount?: number;
  payableAmount?: number;
  customBilling?: boolean;
  customBillingSegmentId?: string;
  customBillingStartDate?: string;
  customBillingEndDate?: string;
  customBillingNote?: string;
};

export function settlementNotesMarkup(
  columns: SettlementNoteColumn[],
  notes: string | undefined,
  lines: BillingStatementLine[] = [],
) {
  const ratesBySpecies = new Map<string, SettlementNoteColumn[]>();
  columns.forEach((column) => {
    const entries = ratesBySpecies.get(column.speciesLabel) || [];
    entries.push(column);
    ratesBySpecies.set(column.speciesLabel, entries);
  });
  const rateEntries = [...ratesBySpecies.entries()].map(([species, entries], index, groups) => {
    const descriptors = [...new Set(entries.map(rateDescriptor))];
    const prefix = groups.length > 1 ? `${index + 1}）` : "";
    return `${prefix}${species} ${descriptors.join("；")}`;
  });
  const rateMarkup = rateEntries.length ? noteEntryMarkup("收费标准：", rateEntries.join("、")) : "";
  const customMarkup = customBillingNoteMarkup(lines);
  const expiryNote = String(notes || "").trim();
  const expiryMarkup = expiryNote ? noteEntryMarkup("伦理到期提示：", expiryNote) : "";
  return `<div class="note-line">${rateMarkup}${customMarkup}${expiryMarkup}</div>`;
}

function customBillingNoteMarkup(lines: BillingStatementLine[]) {
  const details = new Map<
    string,
    {
      iacuc: string;
      startDate: string;
      endDate: string;
      quantity: number;
      unitPrice: number;
      billingUnit: string;
      species: string;
      note: string;
      amount: number;
    }
  >();
  lines.forEach((line) =>
    (line.iacucBreakdown || []).forEach((raw) => {
      const item = raw as CustomBillingBreakdown;
      if (!item.customBilling) return;
      const iacuc = normalizeIacuc(item.iacuc);
      const startDate = String(item.customBillingStartDate || "");
      const endDate = String(item.customBillingEndDate || "");
      const unitPrice = Number(item.unitPrice || 0);
      const billingUnit = String(item.billingUnit || "cage_day");
      const species = speciesLabelFor(item);
      const note = String(item.customBillingNote || "");
      const key = [iacuc, item.customBillingSegmentId || "", startDate, endDate, unitPrice, billingUnit, note].join(
        "|",
      );
      const current = details.get(key) || {
        iacuc,
        startDate,
        endDate,
        quantity: Number(billingUnit === "animal_day" ? item.animalCount || 0 : item.cageCount || 0),
        unitPrice,
        billingUnit,
        species,
        note,
        amount: 0,
      };
      current.amount += Number(item.payableAmount ?? item.amount ?? 0);
      details.set(key, current);
    }),
  );
  if (!details.size) return "";
  const linesMarkup = [...details.values()]
    .sort((left, right) =>
      `${left.iacuc}|${left.startDate}|${left.endDate}`.localeCompare(
        `${right.iacuc}|${right.startDate}|${right.endDate}`,
        "zh-CN",
      ),
    )
    .map((item, index) => {
      const unit = item.billingUnit === "animal_day" ? "只" : "笼";
      const note = item.note ? `。${item.note}` : "";
      return noteEntryMarkup(
        index === 0 ? "自定义收费：" : "",
        `${item.iacuc}：${item.startDate || "-"} 至 ${item.endDate || "-"}，每日${numberText(item.quantity)}${unit}${item.species}，${numberText(item.unitPrice)}元/${unit}/日，本月共计${money(item.amount)}元${note}`,
      );
    })
    .join("");
  return linesMarkup;
}

function noteEntryMarkup(title: string, detail: string) {
  return `<div class="note-entry">${title ? `<strong>${escapeHtml(title)}</strong>` : ""}<span class="note-detail">${escapeHtml(detail)}</span></div>`;
}

function rateDescriptor(column: SettlementNoteColumn) {
  const unit = column.billingUnit === "animal_day" ? "只" : "笼";
  if (
    column.speciesLabel === "小鼠" &&
    column.tiered &&
    column.hasTieredCharge &&
    column.overageUnitPrice > 0 &&
    column.overageUnitPrice !== column.unitPrice
  ) {
    return `笼位数≤160，${formatNumber(column.unitPrice)}元/笼/日；笼位数＞160，${formatNumber(column.overageUnitPrice)}元/笼/日`;
  }
  return `${formatNumber(column.unitPrice)}元/${unit}/日`;
}

function formatNumber(value: number) {
  return Number.isInteger(value) ? String(value) : String(Number(value.toFixed(2)));
}
