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
  return `<section class="temporary-card"><table>
<tr class="temporary-head"><th colspan="2">实验动物信息卡</th><th class="cage-label">笼号</th><td></td></tr>
<tr><th>实验负责人/助手</th><td colspan="3">${blank ? "" : escapeHtml(batch.owner)}</td></tr>
<tr><th>项目负责人</th><td colspan="3">${blank ? "" : escapeHtml(batch.pi)}</td></tr>
<tr><th>批次号</th><td class="temporary-batch" colspan="3">${blank ? "" : highlightBatchIacuc(batch.batchNo, batch.iacuc)}</td></tr>
<tr><th>品系</th><td colspan="3">${blank ? "" : escapeHtml(batch.strainStandard || batch.strainRaw)}</td></tr>
<tr><th>数量</th><td colspan="3">${blank ? "" : escapeHtml(cardQuantityRatio(batch, card))}</td></tr>
<tr><th>饲养周期</th><td class="temporary-period" colspan="3">${blank ? "" : escapeHtml(formatRange(batch.intakeDate, batch.endDate))}</td></tr>
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
function escapeHtml(value: unknown) {
  return String(value || "").replace(
    /[&<>"']/g,
    (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character] || character,
  );
}
function printStyles() {
  return `:root{color-scheme:light}*{box-sizing:border-box}body{margin:0;background:#fff;font-family:"Source Han Sans SC","Noto Sans CJK SC","PingFang SC","Microsoft YaHei",sans-serif;color:#0f172a}.sheet{width:210mm;height:297mm;display:grid;align-content:start;justify-content:center;break-after:page;page-break-after:always}.sheet:last-child{break-after:auto;page-break-after:auto}.standard-sheet{padding:3.86mm 4mm 2.7mm;grid-template-columns:repeat(2,100mm);grid-auto-rows:40.09mm;gap:1.87mm 1.86mm}.standard-card{position:relative;width:100mm;height:40.09mm;border:0;overflow:hidden;background:#fff}.standard-card table{width:100%;height:100%;border-collapse:separate;border-spacing:0;border-top:.32mm solid #111827;border-left:.32mm solid #111827;table-layout:fixed}.standard-card td{border:0;border-right:.32mm solid #111827;border-bottom:.32mm solid #111827;padding:.12mm .55mm;vertical-align:middle;font-size:2.45mm;line-height:1;word-break:break-word;overflow:hidden}.standard-card .label{font-size:2.35mm;font-weight:800;color:#111827;white-space:nowrap}.standard-card .label-long{font-size:2.35mm}.standard-card .value{font-size:2.32mm;font-weight:500;text-align:center}.standard-card .value-compact{font-size:1.98mm;line-height:.98}.batch-iacuc-highlight{font-size:2.7mm;color:#b91c1c;font-weight:800}.standard-card .row-head{text-align:center;font-weight:800;font-size:2.35mm;white-space:nowrap}.standard-card .room{text-align:center;color:#7f0000;font-size:9.25mm;font-weight:900}.standard-card .cycle{font-size:1.86mm;font-weight:800;text-align:center;letter-spacing:-.06mm;white-space:nowrap}.standard-card .quantity-ratio{font-size:2.18mm;font-weight:700;white-space:nowrap}.standard-card .qr-cell{padding:0}.standard-card .qr-cell svg{display:block;width:19mm;height:19mm;margin:0 auto}.temporary-sheet{padding:7mm 5.5mm;grid-template-columns:repeat(3,65mm);grid-auto-rows:55mm;gap:2mm}.temporary-card{width:65mm;height:55mm;overflow:hidden;background:#fff}.temporary-card table{width:100%;height:54.6mm;border-collapse:collapse;table-layout:fixed;border:.3mm solid #111}.temporary-card th,.temporary-card td{height:7.8mm;border:.25mm solid #111;padding:.4mm .7mm;text-align:center;vertical-align:middle;overflow:hidden;word-break:break-word;font-size:2.3mm;line-height:1.1}.temporary-card th{width:21mm;font-weight:800;white-space:nowrap}.temporary-card .temporary-head th,.temporary-card .temporary-head td{height:7.2mm}.temporary-card .temporary-head th:first-child{width:auto;font-size:3.1mm;text-align:left;padding-left:2.4mm}.temporary-card .temporary-head .cage-label{width:9mm;font-size:2.3mm;text-align:center;padding:0}.temporary-card .temporary-head td{width:17mm}.temporary-card .temporary-batch{font-size:2mm;line-height:1}.temporary-card .temporary-batch .batch-iacuc-highlight{color:#b91c1c;font-weight:800}.temporary-card .temporary-period{font-size:2mm;font-weight:700;white-space:nowrap;letter-spacing:-.04mm}@media print{@page{size:A4 portrait;margin:0}body{print-color-adjust:exact;-webkit-print-color-adjust:exact}.sheet,.standard-card,.temporary-card{break-inside:avoid;page-break-inside:avoid}}`;
}
