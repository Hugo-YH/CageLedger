import type { IntakeBatch } from "../api/contracts";
import { abbreviateSupplier } from "../../domain/intake";
import { qrCodeSvg } from "./qrCode";

export const INTAKE_CARD_PRINT_PAGE_SIZE = 14;
export const TEMPORARY_INTAKE_CARD_PRINT_PAGE_SIZE = 15;

export type IntakeCardPrintKind = "standard" | "temporary";
export type IntakeCardPrintSelectionKind = IntakeCardPrintKind | "mixed" | "unresolved";

export interface IntakePrintRoom {
  name: string;
  facility?: string;
}

export interface IntakeCardPrintPlan {
  kind: IntakeCardPrintSelectionKind;
  cardCount: number;
  pageSize: number;
  missing: number;
  disabledReason: string;
}

interface IntakeCardPrintOptions {
  kind?: IntakeCardPrintKind;
  fillBlanks?: boolean;
  targetWindow?: Window | null;
}

interface IntakeCardPrintItem {
  batch: IntakeBatch;
  card: IntakeBatch["cards"][number] | null;
  blank?: boolean;
}

const MIXED_PRINT_REASON = "普通饲养间与临时饲养间笼卡不能混合打印，请分开选择。";
const UNRESOLVED_PRINT_REASON = "无法确认 8014 饲养间的设施归属，请先检查房间配置。";

export function planIntakeCardPrint(batches: IntakeBatch[], rooms: IntakePrintRoom[]): IntakeCardPrintPlan {
  const kinds = new Set<IntakeCardPrintKind>();
  let unresolved = false;
  let cardCount = 0;
  for (const batch of batches) {
    const kind = intakeCardPrintKind(batch, rooms);
    if (kind === "unresolved") unresolved = true;
    else kinds.add(kind);
    cardCount += Math.max(Number(batch.finalCardCount) || 0, 0);
  }
  if (unresolved) {
    return { kind: "unresolved", cardCount, pageSize: 0, missing: 0, disabledReason: UNRESOLVED_PRINT_REASON };
  }
  if (kinds.size > 1) {
    return { kind: "mixed", cardCount, pageSize: 0, missing: 0, disabledReason: MIXED_PRINT_REASON };
  }
  const kind = kinds.values().next().value || "standard";
  const pageSize = kind === "temporary" ? TEMPORARY_INTAKE_CARD_PRINT_PAGE_SIZE : INTAKE_CARD_PRINT_PAGE_SIZE;
  const missing = cardCount % pageSize ? pageSize - (cardCount % pageSize) : 0;
  return { kind, cardCount, pageSize, missing, disabledReason: "" };
}

export function intakeCardsPrintHtml(batches: IntakeBatch[], options: IntakeCardPrintOptions = {}) {
  const kind = options.kind || "standard";
  const pageSize = kind === "temporary" ? TEMPORARY_INTAKE_CARD_PRINT_PAGE_SIZE : INTAKE_CARD_PRINT_PAGE_SIZE;
  const items = printItems(batches);
  if (!items.length) return "";
  if (options.fillBlanks && items.length % pageSize) {
    const missing = pageSize - (items.length % pageSize);
    items.push(...Array.from({ length: missing }, () => blankPrintItem()));
  }
  const pages = Array.from({ length: Math.ceil(items.length / pageSize) }, (_, index) =>
    items.slice(index * pageSize, (index + 1) * pageSize),
  );
  const title = kind === "temporary" ? "临时饲养间笼卡打印" : "接收笼卡打印";
  const sheetClass = kind === "temporary" ? "sheet temporary-sheet" : "sheet standard-sheet";
  const render = kind === "temporary" ? renderTemporaryCard : renderStandardCard;
  return `<!doctype html><html lang="zh-CN"><head><meta charset="UTF-8"><title>${title}</title><style>${printStyles()}</style></head><body>${pages.map((page) => `<div class="${sheetClass}">${page.map(render).join("")}</div>`).join("")}<script>window.addEventListener("load",()=>{window.focus();window.print()},{once:true})</script></body></html>`;
}

export function openIntakeCardPrint(batches: IntakeBatch[], options: IntakeCardPrintOptions = {}) {
  const html = intakeCardsPrintHtml(batches, options);
  if (!html) return false;
  const popup = options.targetWindow ?? window.open("", "_blank");
  if (!popup) return false;
  popup.document.open();
  popup.document.write(html);
  popup.document.close();
  return true;
}

function intakeCardPrintKind(batch: IntakeBatch, rooms: IntakePrintRoom[]): IntakeCardPrintKind | "unresolved" {
  if (String(batch.roomName || "").trim() !== "8014") return "standard";
  const matches = rooms.filter((room) => String(room.name || "").trim() === "8014");
  if (matches.length !== 1) return "unresolved";
  return String(matches[0].facility || "").trim() === "zhujiang" ? "temporary" : "standard";
}

function printItems(batches: IntakeBatch[]): IntakeCardPrintItem[] {
  return batches.flatMap((batch) => batch.cards.slice(0, batch.finalCardCount).map((card) => ({ batch, card })));
}

function blankPrintItem(): IntakeCardPrintItem {
  return { batch: {} as IntakeBatch, card: null, blank: true };
}

function renderStandardCard({ batch, card, blank }: IntakeCardPrintItem) {
  const qrId = blank
    ? ""
    : String(card?.qrId || "")
        .trim()
        .toUpperCase();
  return `<section class="standard-card"><table><colgroup><col style="width:16mm"><col style="width:11mm"><col style="width:23mm"><col style="width:16mm"><col style="width:8mm"><col style="width:7mm"><col style="width:9.5mm"><col style="width:9.5mm"></colgroup>
<tr style="height:4.86mm"><td class="label">批次号：</td><td class="value value-compact" colspan="2">${blank ? "" : highlightBatchIacuc(batch.batchNo, batch.iacuc)}</td><td class="label" colspan="2">购买单位：</td><td class="value" colspan="3">${blank ? "" : escapeHtml(abbreviateSupplier(batch.supplier))}</td></tr>
<tr style="height:4.86mm"><td class="label">动物品系：</td><td class="value" colspan="2">${blank ? "" : escapeHtml(batch.strainStandard || batch.strainRaw)}</td><td class="label" colspan="2">项目负责人：</td><td class="value" colspan="3">${blank ? "" : escapeHtml(batch.pi)}</td></tr>
<tr style="height:4.86mm"><td class="label">接收日期：</td><td class="value" colspan="2">${blank ? "" : escapeHtml(formatDate(batch.intakeDate))}</td><td class="label label-long" colspan="2">实验责任人/助手：</td><td class="value" colspan="3">${blank ? "" : escapeHtml(batch.owner)}</td></tr>
<tr style="height:4.86mm"><td class="label">接收人员：</td><td class="value" colspan="2">${blank ? "" : escapeHtml(batch.receiverName)}</td><td class="label" colspan="2">联系电话：</td><td class="value" colspan="3">${blank ? "" : escapeHtml(batch.vetPhone)}</td></tr>
<tr style="height:3.91mm"><td class="row-head">日期</td><td class="row-head">数目变化</td><td class="row-head">饲养周期</td><td class="row-head" colspan="3">房间</td><td class="qr-cell" colspan="2" rowspan="4">${qrId ? qrCodeSvg(qrId, "笼卡二维码", 1) : ""}</td></tr>
<tr style="height:5.26mm"><td class="value">${blank ? "" : escapeHtml(formatDate(batch.intakeDate))}</td><td class="value quantity-ratio">${blank ? "" : escapeHtml(cardQuantityRatio(batch, card))}</td><td class="cycle">${blank ? "" : escapeHtml(formatRange(batch.intakeDate, batch.endDate))}</td><td class="room" colspan="3" rowspan="3">${blank ? "" : escapeHtml(batch.roomName)}</td></tr>
<tr style="height:5.26mm"><td></td><td></td><td></td></tr><tr style="height:5.26mm"><td></td><td></td><td></td></tr></table></section>`;
}

function renderTemporaryCard({ batch, card, blank }: IntakeCardPrintItem) {
  const owner = String(batch.owner || "").trim();
  const strain = String(batch.strainStandard || batch.strainRaw || "").trim();
  const qrId = blank
    ? ""
    : String(card?.qrId || "")
        .trim()
        .toUpperCase();
  return `<section class="temporary-card"><table class="temporary-card-grid"><colgroup><col style="width:19mm"><col style="width:28mm"><col style="width:18mm"></colgroup>
<tr class="temporary-owner-row"><th>实验负责人</th><td class="${temporaryTextClass("temporary-owner", owner, 20)}">${blank ? "" : escapeHtml(owner)}</td><td class="temporary-qr-cell" rowspan="2">${qrId ? qrCodeSvg(qrId, "笼卡二维码", 1) : ""}</td></tr>
<tr class="temporary-pi-row"><th>项目负责人</th><td>${blank ? "" : escapeHtml(batch.pi)}</td></tr>
<tr><th>批次编号</th><td class="temporary-batch" colspan="2">${blank ? "" : highlightBatchIacuc(batch.batchNo, batch.iacuc)}</td></tr>
<tr><th>购买单位</th><td colspan="2">${blank ? "" : escapeHtml(abbreviateSupplier(batch.supplier))}</td></tr>
<tr><th>品系</th><td class="${temporaryTextClass("temporary-strain", strain, 35)}" colspan="2">${blank ? "" : escapeHtml(strain)}</td></tr>
<tr><th>数量</th><td colspan="2">${blank ? "" : escapeHtml(cardQuantityRatio(batch, card))}</td></tr>
<tr><th>饲养周期</th><td class="temporary-period" colspan="2">${blank ? "" : temporaryPeriodMarkup(batch.intakeDate, batch.endDate)}</td></tr>
</table></section>`;
}

function cardQuantityRatio(batch: IntakeBatch, card: IntakeBatch["cards"][number] | null) {
  const total = Math.max(Number(batch.quantity) || 0, 0);
  if (!total) return "";
  const cageQuantity = String(card?.suggestedQuantity || "").trim();
  return `${cageQuantity || " "}/${total}`;
}

function highlightBatchIacuc(batchNo: string, iacuc: string) {
  const full = String(batchNo || "").trim();
  const target = String(iacuc || "").trim();
  const directIndex = target ? full.toUpperCase().indexOf(target.toUpperCase()) : -1;
  if (directIndex >= 0) return highlightRange(full, directIndex, target.length);

  // A historical intake record can carry a revised IACUC value while the
  // printable batch number still retains its original parenthesized code.
  // The visible code in that batch number is still the operator's IACUC cue.
  const bracketedCode = /[（(]\s*([A-Z]{1,6}\d{4,})/i.exec(full);
  if (!bracketedCode?.[1] || bracketedCode.index == null) return escapeHtml(full);
  const index = bracketedCode.index + bracketedCode[0].indexOf(bracketedCode[1]);
  return highlightRange(full, index, bracketedCode[1].length);
}

function highlightRange(full: string, index: number, length: number) {
  return `${escapeHtml(full.slice(0, index))}<span class="batch-iacuc-highlight">${escapeHtml(full.slice(index, index + length))}</span>${escapeHtml(full.slice(index + length))}`;
}
function formatDate(value: string) {
  const parts = String(value || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return parts ? `${parts[1]}.${Number(parts[2])}.${Number(parts[3])}` : value;
}
function formatRange(start: string, end: string) {
  return [formatDate(start), formatDate(end)].filter(Boolean).join("-");
}
function temporaryPeriodMarkup(start: string, end: string) {
  return escapeHtml([formatDate(start), formatDate(end)].filter(Boolean).join(" 至 "));
}
function temporaryTextClass(base: string, value: string, compactAt: number) {
  const units = Array.from(value).reduce(
    (total, character) => total + ((character.codePointAt(0) || 0) > 0xff ? 2 : 1),
    0,
  );
  return units > compactAt ? `${base} temporary-compact` : base;
}
function escapeHtml(value: unknown) {
  return String(value || "").replace(
    /[&<>"']/g,
    (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character] || character,
  );
}
function printStyles() {
  return `:root{color-scheme:light}
*{box-sizing:border-box}
body{margin:0;background:#fff;font-family:"Source Han Sans SC","Noto Sans CJK SC","PingFang SC","Microsoft YaHei",sans-serif;color:#0f172a}
.sheet{width:210mm;height:297mm;display:grid;align-content:start;justify-content:center;break-after:page;page-break-after:always}
.sheet:last-child{break-after:auto;page-break-after:auto}
.standard-sheet{padding:2.5mm 4mm;grid-template-columns:repeat(2,100mm);grid-auto-rows:40mm;gap:2mm}
.standard-card{position:relative;width:100mm;height:40mm;border:0;overflow:hidden;background:#fff}
.standard-card table{width:100%;height:100%;border-collapse:separate;border-spacing:0;border-top:.32mm solid #111827;border-left:.32mm solid #111827;table-layout:fixed}
.standard-card td{border:0;border-right:.32mm solid #111827;border-bottom:.32mm solid #111827;padding:.12mm .55mm;vertical-align:middle;font-size:2.45mm;line-height:1;word-break:break-word;overflow:hidden}
.standard-card .label{font-size:2.35mm;font-weight:800;color:#111827;white-space:nowrap}
.standard-card .label-long{font-size:2.35mm}
.standard-card .value{font-size:2.32mm;font-weight:500;text-align:center}
.standard-card .value-compact{font-size:1.98mm;line-height:.98}
.batch-iacuc-highlight{font-size:2.7mm;color:#b91c1c;font-weight:800}
.standard-card .row-head{text-align:center;font-weight:800;font-size:2.35mm;white-space:nowrap}
.standard-card .room{text-align:center;color:#7f0000;font-size:9.25mm;font-weight:900}
.standard-card .cycle{font-size:1.86mm;font-weight:800;text-align:center;letter-spacing:-.06mm;white-space:nowrap}
.standard-card .quantity-ratio{font-size:2.18mm;font-weight:700;white-space:nowrap}
.standard-card .qr-cell{padding:0}
.standard-card .qr-cell svg{display:block;width:19mm;height:19mm;margin:0 auto}
.temporary-sheet{padding:7mm 5.5mm;grid-template-columns:repeat(3,65mm);grid-auto-rows:55mm;gap:2mm}
.temporary-card{width:65mm;height:55mm;overflow:visible;background:#fff}
.temporary-card .temporary-card-grid{width:100%;height:54.6mm;border-collapse:collapse;table-layout:fixed;border:.3mm solid #111}
.temporary-card th,.temporary-card td{height:7.32mm;border:.25mm solid #111;padding:.35mm .6mm;text-align:center;vertical-align:middle;overflow:hidden;word-break:break-word;font-size:2.5mm;line-height:1.08}
.temporary-card th{font-size:2.55mm;font-weight:800;white-space:nowrap}
.temporary-card .temporary-owner-row>*,.temporary-card .temporary-pi-row>*{height:9mm}
.temporary-card .temporary-owner,.temporary-card .temporary-strain{font-size:2.55mm;white-space:nowrap}
.temporary-card .temporary-compact{font-size:2.08mm!important;line-height:1.02;white-space:normal}
.temporary-card .temporary-batch{font-size:2.18mm;line-height:1}
.temporary-card .temporary-batch .batch-iacuc-highlight{font-size:2.6mm;color:#b91c1c;font-weight:800}
.temporary-card .temporary-period{font-size:2.35mm;font-weight:400;letter-spacing:-.03mm;white-space:nowrap}
.temporary-card .temporary-qr-cell{height:18mm;padding:0}
.temporary-card .temporary-qr-cell svg{display:block;width:100%;height:100%;margin:0}
@media print{@page{size:A4 portrait;margin:0}body{print-color-adjust:exact;-webkit-print-color-adjust:exact}.sheet,.standard-card,.temporary-card{break-inside:avoid;page-break-inside:avoid}}`;
}
