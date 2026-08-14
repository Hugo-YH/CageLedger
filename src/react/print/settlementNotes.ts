import { escapeHtml } from "./settlementSupport";

type SettlementNoteColumn = {
  speciesLabel: string;
  billingUnit: string;
  unitPrice: number;
  overageUnitPrice: number;
  tiered: boolean;
  hasTieredCharge: boolean;
};

export function settlementNotesMarkup(columns: SettlementNoteColumn[], notes: string | undefined) {
  const ratesBySpecies = new Map<string, SettlementNoteColumn[]>();
  columns.forEach((column) => {
    const entries = ratesBySpecies.get(column.speciesLabel) || [];
    entries.push(column);
    ratesBySpecies.set(column.speciesLabel, entries);
  });
  const rateLines = [...ratesBySpecies.entries()].map(([species, entries], index, groups) => {
    const descriptors = [...new Set(entries.map(rateDescriptor))];
    const prefix = groups.length > 1 ? `${index + 1}）` : "";
    return `<div>&nbsp;&nbsp;${prefix}${escapeHtml(species)} ${descriptors
      .map((descriptor) => escapeHtml(descriptor))
      .join("；")}</div>`;
  });
  const expiryNote = String(notes || "").trim();
  const expiryMarkup = expiryNote
    ? `<div><strong>伦理到期提示：</strong></div><div>${escapeHtml(expiryNote)}</div>`
    : "";
  return `<div class="note-line"><div><strong>收费标准：</strong></div>${rateLines.join("")}${expiryMarkup}</div>`;
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
