import type { IntakeBatch } from "../api/contracts";
import { qrCodeSvg } from "./qrCode";

export const INTAKE_CARD_PRINT_PAGE_SIZE = 14;

export function intakeCardsPrintHtml(batches: IntakeBatch[]) {
  const items = batches.flatMap((batch) => batch.cards.slice(0, batch.finalCardCount).map((card) => ({ batch, card })));
  if (!items.length) return "";
  const pages = Array.from({ length: Math.ceil(items.length / INTAKE_CARD_PRINT_PAGE_SIZE) }, (_, index) =>
    items.slice(index * INTAKE_CARD_PRINT_PAGE_SIZE, (index + 1) * INTAKE_CARD_PRINT_PAGE_SIZE),
  );
  return `<!doctype html><html lang="zh-CN"><head><meta charset="UTF-8"><title>接收笼卡打印</title><style>${printStyles()}</style></head><body>${pages.map((page) => `<div class="sheet">${page.map(({ batch, card }) => renderCard(batch, card)).join("")}</div>`).join("")}<script>window.addEventListener("load",()=>{window.focus();window.print()},{once:true})</script></body></html>`;
}

export function openIntakeCardPrint(batches: IntakeBatch[], targetWindow?: Window | null) {
  const html = intakeCardsPrintHtml(batches);
  if (!html) return false;
  const popup = targetWindow ?? window.open("", "_blank");
  if (!popup) return false;
  popup.document.open();
  popup.document.write(html);
  popup.document.close();
  return true;
}

function renderCard(batch: IntakeBatch, card: IntakeBatch["cards"][number]) {
  const qrId = String(card.qrId || "")
    .trim()
    .toUpperCase();
  return `<section class="card"><table><colgroup><col style="width:16mm"><col style="width:11mm"><col style="width:23mm"><col style="width:16mm"><col style="width:8mm"><col style="width:7mm"><col style="width:9.5mm"><col style="width:9.5mm"></colgroup>
<tr style="height:4.86mm"><td class="label">批次号：</td><td class="value value-compact" colspan="2">${highlightBatchIacuc(batch.batchNo, batch.iacuc)}</td><td class="label" colspan="2">购买单位：</td><td class="value" colspan="3">${escapeHtml(abbreviateSupplier(batch.supplier))}</td></tr>
<tr style="height:4.86mm"><td class="label">动物品系：</td><td class="value" colspan="2">${escapeHtml(batch.strainStandard || batch.strainRaw)}</td><td class="label" colspan="2">项目负责人：</td><td class="value" colspan="3">${escapeHtml(batch.pi)}</td></tr>
<tr style="height:4.86mm"><td class="label">接收日期：</td><td class="value" colspan="2">${escapeHtml(formatDate(batch.intakeDate))}</td><td class="label label-long" colspan="2">实验责任人/助手：</td><td class="value" colspan="3">${escapeHtml(batch.owner)}</td></tr>
<tr style="height:4.86mm"><td class="label">接收人员：</td><td class="value" colspan="2">${escapeHtml(batch.receiverName)}</td><td class="label" colspan="2">兽医电话：</td><td class="value" colspan="3">${escapeHtml(batch.vetPhone)}</td></tr>
<tr style="height:3.91mm"><td class="row-head">日期</td><td class="row-head">数目变化</td><td class="row-head">饲养周期</td><td class="row-head" colspan="3">房间</td><td class="qr-cell" colspan="2" rowspan="4">${qrCodeSvg(qrId, "笼卡二维码", 1)}</td></tr>
<tr style="height:5.26mm"><td class="value">${escapeHtml(formatDate(batch.intakeDate))}</td><td class="value quantity-ratio">${escapeHtml(cardQuantityRatio(batch, card))}</td><td class="cycle">${escapeHtml(formatRange(batch.intakeDate, batch.endDate))}</td><td class="room" colspan="3" rowspan="3">${escapeHtml(batch.roomName)}</td></tr>
<tr style="height:5.26mm"><td></td><td></td><td></td></tr><tr style="height:5.26mm"><td></td><td></td><td></td></tr></table></section>`;
}

function cardQuantityRatio(batch: IntakeBatch, card: IntakeBatch["cards"][number]) {
  const total = Math.max(Number(batch.quantity) || 0, 0);
  if (!total) return "";
  const cageQuantity = String(card.suggestedQuantity || "").trim();
  return `${cageQuantity || " "}/${total}`;
}

function highlightBatchIacuc(batchNo: string, iacuc: string) {
  const full = String(batchNo || "").trim();
  const target = String(iacuc || "").trim();
  if (!target) return escapeHtml(full);
  const index = full.toUpperCase().indexOf(target.toUpperCase());
  if (index < 0) return escapeHtml(full);
  return `${escapeHtml(full.slice(0, index))}<span class="batch-iacuc-highlight">${escapeHtml(full.slice(index, index + target.length))}</span>${escapeHtml(full.slice(index + target.length))}`;
}
function abbreviateSupplier(value: string) {
  const text = String(value || "");
  const rules: Array<[RegExp, string]> = [
    [/江苏集萃药康|江苏集萃/, "江苏集萃"],
    [/广东药康/, "广东药康"],
    [/上海(?:南方模式|南模)/, "上海南模"],
    [/广东南模/, "广东南模"],
    [/珠海百试通/, "珠海百试通"],
    [/丹阳昌益/, "丹阳昌益"],
    [/北京维通利华/, "北京维通利华"],
    [/浙江维通利华/, "浙江维通利华"],
    [/上海斯莱克|斯莱克/, "上海斯莱克"],
    [/北京华阜康|华阜康/, "北京华阜康"],
    [/北京百奥赛图|百奥赛图/, "北京百奥赛图"],
  ];
  return rules.find(([pattern]) => pattern.test(text))?.[1] || text;
}
function formatDate(value: string) {
  const parts = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
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
  return `:root{color-scheme:light}*{box-sizing:border-box}body{margin:0;background:#fff;font-family:"Source Han Sans SC","Noto Sans CJK SC","PingFang SC","Microsoft YaHei",sans-serif;color:#0f172a}.sheet{width:210mm;height:297mm;padding:3.86mm 4mm 2.7mm;display:grid;grid-template-columns:repeat(2,100mm);grid-auto-rows:40.09mm;gap:1.87mm 1.86mm;align-content:start;justify-content:center;break-after:page;page-break-after:always}.sheet:last-child{break-after:auto;page-break-after:auto}.card{position:relative;width:100mm;height:40.09mm;border:0;overflow:hidden;background:#fff}.card table{width:100%;height:100%;border-collapse:separate;border-spacing:0;border-top:.32mm solid #111827;border-left:.32mm solid #111827;table-layout:fixed}.card td{border:0;border-right:.32mm solid #111827;border-bottom:.32mm solid #111827;padding:.12mm .55mm;vertical-align:middle;font-size:2.45mm;line-height:1;word-break:break-word;overflow:hidden}.card .label{font-size:2.35mm;font-weight:800;color:#111827;white-space:nowrap}.card .label-long{font-size:2.35mm}.card .value{font-size:2.32mm;font-weight:500;text-align:center}.card .value-compact{font-size:1.98mm;line-height:.98}.card .batch-iacuc-highlight{font-size:2.7mm;color:#b91c1c;font-weight:800}.card .row-head{text-align:center;font-weight:800;font-size:2.35mm;white-space:nowrap}.card .room{text-align:center;color:#7f0000;font-size:9.25mm;font-weight:900}.card .cycle{font-size:1.86mm;font-weight:800;text-align:center;letter-spacing:-.06mm;white-space:nowrap}.card .quantity-ratio{font-size:2.18mm;font-weight:700;white-space:nowrap}.card .qr-cell{padding:0}.card .qr-cell svg{display:block;width:19mm;height:19mm;margin:0 auto}@media print{@page{size:A4 portrait;margin:0}body{print-color-adjust:exact;-webkit-print-color-adjust:exact}.sheet,.card{break-inside:avoid;page-break-inside:avoid}}`;
}
