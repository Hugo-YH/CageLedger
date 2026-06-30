import type { IntakeBatch, IntakeBatchStatus } from "../react/api/contracts";

const validStatuses = new Set<IntakeBatchStatus>(["draft", "pending_print", "printed", "received"]);

function numberOrNull(value: unknown) {
  if (value === "" || value == null) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function cleanField(value: string) {
  return value
    .replace(/^[:：，,\s]+/, "")
    .split(/@|谢谢|请审核|请审批|老师/)[0]
    .trim()
    .replace(/[，,。；;]+$/, "")
    .trim();
}

function matchField(text: string, labels: string[]) {
  const source = text.replace(/[：]/g, ":").replace(/[（]/g, "(").replace(/[）]/g, ")");
  for (const label of labels) {
    const match = source.match(new RegExp(`${label}\\s*(?:为|是)?\\s*:?\\s*([^\\n\\r]+)`, "i"));
    if (match?.[1]) return cleanField(match[1]);
  }
  return "";
}

function normalizedDate(value: string, fallbackYear = new Date().getFullYear()) {
  const raw = String(value || "").trim();
  const full = raw.match(/(20\d{2})[-/.年]\s*(\d{1,2})[-/.月]\s*(\d{1,2})/);
  const short = raw.match(/(\d{1,2})\s*月\s*(\d{1,2})\s*[日号]/);
  const parts = full
    ? [Number(full[1]), Number(full[2]), Number(full[3])]
    : short
      ? [fallbackYear, Number(short[1]), Number(short[2])]
      : null;
  if (!parts) return /^20\d{2}-\d{2}-\d{2}$/.test(raw) ? raw : "";
  const [year, month, day] = parts;
  const date = new Date(year, month - 1, day);
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) return "";
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function inferSpecies(value: string) {
  if (/猴|monkey|macaque/i.test(value)) return "monkey";
  if (/兔|rabbit/i.test(value)) return "rabbit";
  if (/猪|pig|swine/i.test(value)) return "pig";
  if (/犬|狗|dog|canine/i.test(value)) return "dog";
  if (/豚鼠|guinea/i.test(value)) return "guinea_pig";
  if (/大鼠|rat|sprague|wistar|lewis|\bsd\b/i.test(value)) return "rat";
  return "mouse";
}

export function defaultAnimalsPerCage(species: string) {
  if (["guinea_pig", "rabbit", "monkey", "pig", "dog"].includes(species)) return 1;
  return species === "rat" ? 4 : 5;
}

export function createIntakeDraft(receiverName = ""): IntakeBatch {
  return normalizeIntakeBatch({ id: crypto.randomUUID(), receiverName, status: "pending_print" });
}

export function normalizeIntakeBatch(item: Partial<IntakeBatch>, roomNames: string[] = []): IntakeBatch {
  const species =
    item.species || inferSpecies(`${item.strainStandard || ""} ${item.strainRaw || ""} ${item.rawMessage || ""}`);
  const quantity = numberOrNull(item.quantity);
  const perCage = Math.max(numberOrNull(item.suggestedAnimalsPerCage) || defaultAnimalsPerCage(species), 1);
  const suggestedCardCount = Math.max(
    numberOrNull(item.suggestedCardCount) || (quantity ? Math.ceil(quantity / perCage) : 0),
    0,
  );
  const finalCardCount = Math.max(numberOrNull(item.finalCardCount) ?? suggestedCardCount, 0);
  const confirmedCardCount = Math.max(numberOrNull(item.confirmedCardCount) || 0, 0);
  const status = validStatuses.has(item.status as IntakeBatchStatus)
    ? (item.status as IntakeBatchStatus)
    : "pending_print";
  const roomName = String(item.roomName || "").trim();
  const husbandryDays = numberOrNull(item.husbandryDays);
  const intakeDate = normalizedDate(String(item.intakeDate || ""));
  const endDate = normalizedDate(String(item.endDate || "")) || addDays(intakeDate, husbandryDays);
  return {
    id: String(item.id || crypto.randomUUID()),
    rawMessage: String(item.rawMessage || ""),
    purchaseOrderNo: String(item.purchaseOrderNo || "").trim(),
    batchNo: String(item.batchNo || "")
      .trim()
      .replace(/[（(]\s*([^()（）]+?)\s*[)）]/g, "（$1）"),
    iacuc: String(item.iacuc || "")
      .trim()
      .toUpperCase(),
    supplier: String(item.supplier || "").trim(),
    species,
    strainRaw: String(item.strainRaw || "").trim(),
    strainStandard: String(item.strainStandard || item.strainRaw || "").trim(),
    sex: String(item.sex || "").trim(),
    quantity,
    roomName,
    roomMatched: roomNames.length ? roomNames.includes(roomName) : Boolean(item.roomMatched),
    intakeDate,
    husbandryDays,
    endDate,
    project: String(item.project || "").trim(),
    pi: String(item.pi || "").trim(),
    owner: String(item.owner || "").trim(),
    receiverName: String(item.receiverName || "").trim(),
    vetPhone: String(item.vetPhone || "").trim(),
    notes: String(item.notes || "").trim(),
    status,
    suggestedAnimalsPerCage: perCage,
    suggestedCardCount,
    finalCardCount,
    confirmedCardCount,
    remainingCardCount: Math.max(numberOrNull(item.remainingCardCount) ?? finalCardCount - confirmedCardCount, 0),
    receipts: Array.isArray(item.receipts) ? item.receipts : [],
    cards: Array.isArray(item.cards) ? item.cards : [],
    updatedAt: String(item.updatedAt || ""),
  };
}

export function parseIntakeMessage(rawMessage: string, receiverName = "", roomNames: string[] = []) {
  const raw = rawMessage.trim();
  const source = raw.replace(/[：]/g, ":").replace(/[（]/g, "(").replace(/[）]/g, ")");
  const batchMatch = source.match(/饲养需求批次号\s*(?:为)?\s*:?\s*\(\s*([A-Z]{1,6}\d{4,})\s*\)\s*(\d{6,})/i);
  const batchNo = batchMatch
    ? `（${batchMatch[1].toUpperCase()}）${batchMatch[2]}`
    : matchField(raw, ["饲养需求批次号", "批次号"]);
  const iacuc = batchMatch?.[1]?.toUpperCase() || "";
  const purchaseOrderNo =
    source.match(/锐[竞竟](?:采购)?(?:单号|订单编号|采购订单编号)?\s*(?:为)?\s*:?\s*([A-Z]{0,3}\d{8,})/i)?.[1] || "";
  const referenceYear = Number(
    batchMatch?.[2]?.slice(0, 4) || purchaseOrderNo.match(/20\d{2}/)?.[0] || new Date().getFullYear(),
  );
  const supplier = matchField(raw, ["供应商", "购买单位"]).split(/\s+(?:品系|数量|饲养房间)/)[0];
  const strainRaw =
    source
      .match(/品系\s*:?\s*([\s\S]*?)(?=\s*(?:数量|饲养房间|进驻日期|拟进驻日期|预计进驻日期)\s*:|[\n\r]|$)/i)?.[1]
      ?.trim() || "";
  const quantity = numberOrNull(source.match(/数量\s*:?\s*(\d+)/)?.[1]);
  const roomName = matchField(raw, ["饲养房间", "房间"]).match(/\d{3,4}/)?.[0] || "";
  const dateText = matchField(raw, ["进驻日期", "拟进驻日期", "预计进驻日期", "接收日期", "到货日期"]);
  const husbandryDays = numberOrNull(matchField(raw, ["饲养周期（天）", "饲养周期(天)", "饲养周期", "周期"]));
  return normalizeIntakeBatch(
    {
      rawMessage: raw,
      purchaseOrderNo,
      batchNo,
      iacuc,
      supplier,
      strainRaw,
      strainStandard: strainRaw,
      species: inferSpecies(`${raw} ${strainRaw}`),
      sex: matchField(raw, ["性别"]),
      quantity,
      roomName,
      intakeDate: normalizedDate(dateText, referenceYear),
      husbandryDays,
      receiverName,
      status: "pending_print",
    },
    roomNames,
  );
}

function addDays(value: string, days: number | null) {
  if (!value || !days) return "";
  const date = new Date(`${value}T00:00:00`);
  date.setDate(date.getDate() + days);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export function intakeStatusLabel(status: IntakeBatchStatus) {
  return { draft: "草稿", pending_print: "未打印", printed: "已打印", received: "已接收" }[status];
}
