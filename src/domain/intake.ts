import type { IntakeBatch, IntakeBatchStatus, IntakePurpose } from "../contracts/intake";
import { createClientId } from "./id";
// Single source of truth shared with the Python backend: the curated MGI
// strain alias table lives in server_app/resources/intake and both runtimes
// read the same file so local and AI recognition resolve identical names.
import mgiStrainAliases from "../../server_app/resources/intake/mgi-strain-aliases.json";
import supplierAliases from "../../server_app/resources/intake/supplier-aliases.json";
const validStatuses = new Set<IntakeBatchStatus>(["draft", "pending_print", "pending_receipt", "printed", "received"]);
const strainSeparatorPattern = /[\s\-_/\\.,;:·（）()【】[\]<>]+/g;
const strainTrailingMousePattern = /(小鼠|小白鼠|mouse|mice)$/;
const strainNoteSeparatorPattern = /[，,、；;]/;

export function normalizeStrainKey(raw: string) {
  return String(raw || "")
    .normalize("NFKC")
    .trim()
    .toLowerCase()
    .replace(strainSeparatorPattern, "");
}

let strainAliasMap: Record<string, string> | null = null;

function strainAliases() {
  if (!strainAliasMap) {
    strainAliasMap = {};
    for (const entry of mgiStrainAliases.entries) {
      for (const alias of entry.aliases) {
        strainAliasMap[normalizeStrainKey(alias)] = entry.standard;
      }
    }
  }
  return strainAliasMap;
}

/** Resolve common facility aliases locally; full MGI lookup runs through the authenticated API. */
export function standardizeStrain(raw: string): string {
  const text = String(raw || "").trim();
  if (!text) return "";
  const aliases = strainAliases();
  const firstSegment = text.split(strainNoteSeparatorPattern, 1)[0]?.trim();
  const candidates = firstSegment && firstSegment !== text ? [firstSegment, text] : [text];
  for (const candidate of candidates) {
    const key = normalizeStrainKey(candidate);
    if (!key) continue;
    if (aliases[key]) return aliases[key];
    const stripped = key.replace(strainTrailingMousePattern, "");
    if (aliases[stripped]) return aliases[stripped];
  }
  return "";
}

function supplierKey(raw: string) {
  return raw
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\s()（）·\-—_]/g, "");
}

const supplierRules = supplierAliases.entries
  .flatMap((entry) =>
    [...new Set([...entry.companyNames, ...entry.aliases].map(supplierKey))].map((key) => ({
      key,
      shortName: entry.shortName,
    })),
  )
  .sort((left, right) => right.key.length - left.key.length);
const exactSupplierAliases = new Map(
  supplierAliases.entries.flatMap((entry) =>
    [entry.shortName, ...entry.exactAliases].map((alias) => [supplierKey(alias), entry.shortName] as const),
  ),
);
const supplierBranchPattern = /分公司|分厂|分部|办事处/;

export function abbreviateSupplier(raw: string) {
  const text = String(raw || "").trim();
  const key = supplierKey(text);
  const exact = exactSupplierAliases.get(key);
  if (exact) return exact;
  const rule = supplierRules.find((candidate) => key.includes(candidate.key));
  if (!rule) return text;
  // Only a verified branch-specific alias may shorten a branch name.
  if (supplierBranchPattern.test(key) && !supplierBranchPattern.test(rule.key)) return text;
  return rule.shortName;
}

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
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    const date = new Date(`${raw}T00:00:00Z`);
    return Number(raw.slice(0, 4)) > 0 && Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === raw
      ? raw
      : "";
  }
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

export function speciesLabel(value: string) {
  const labels: Record<string, string> = {
    mouse: "小鼠",
    rat: "大鼠",
    guinea_pig: "豚鼠",
    rabbit: "兔",
    monkey: "猴",
    pig: "猪",
    dog: "犬",
  };
  return labels[value] ?? value;
}

export function defaultAnimalsPerCage(species: string) {
  if (["guinea_pig", "rabbit", "monkey", "pig", "dog"].includes(species)) return 1;
  return species === "rat" ? 4 : 5;
}

export function createIntakeDraft(receiverName = "", phone = ""): IntakeBatch {
  return normalizeIntakeBatch({ id: createClientId(), receiverName, vetPhone: phone, status: "pending_print" });
}

export function isDirectSampling(batch: Pick<IntakeBatch, "intakePurpose">) {
  return batch.intakePurpose === "direct_sampling";
}

export function intakePurposeLabel(value: string | undefined) {
  return value === "direct_sampling" ? "直接取材" : "入驻饲养";
}

export function normalizeIntakeSex(value: unknown): "雌性" | "雄性" | "雌性/雄性" {
  const text = typeof value === "string" ? value.trim().toLowerCase() : "";
  const female = /雌|母|♀|\bfemale\b|^f$/.test(text);
  const male = /雄|公|♂|\bmale\b|^m$/.test(text);
  if (female === male) return "雌性/雄性";
  return female ? "雌性" : "雄性";
}

export function canConfirmIntakeReceipt(batch: Pick<IntakeBatch, "intakePurpose" | "status">) {
  return isDirectSampling(batch) ? batch.status === "pending_receipt" : batch.status === "printed";
}

export function inferIntakePurpose(value: string): IntakePurpose {
  if (
    /(?:不(?:是|需要|要)?|非|并非|无需)\s*(?:到货(?:后)?\s*)?直接取材|(?:饲养|入驻)[^，。；\n]{0,20}(?:后|再)[^，。；\n]{0,8}取材/.test(
      value,
    )
  ) {
    return "housing";
  }
  return /直接取材|(?:到货|到达|接收)(?:后|当天)?(?:立即|即|就)取材|无需饲养|不(?:需要|用)饲养/.test(value)
    ? "direct_sampling"
    : "housing";
}

export function missingIntakeRequiredFields(item: IntakeBatch) {
  const fields: Array<[keyof IntakeBatch, string]> = [
    ["supplier", "购买单位"],
    ["iacuc", "IACUC 编号"],
    ["pi", "项目负责人"],
    ["owner", "实验负责人"],
    ["roomName", "房间"],
    ["intakeDate", "接收日期"],
  ];
  const missing = fields
    .filter(([key]) => !(key === "roomName" && isDirectSampling(item)) && !String(item[key] ?? "").trim())
    .map(([, label]) => label);
  if (isDirectSampling(item) && (!Number.isInteger(item.quantity) || (item.quantity ?? 0) <= 0)) {
    missing.push("数量（只）");
  }
  return missing;
}

export function normalizeIntakeBatch(item: Partial<IntakeBatch>, roomNames: string[] = []): IntakeBatch {
  const directSampling = isDirectSampling(item);
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
  const intakeDate = normalizedDate(String(item.intakeDate || ""));
  const months = numberOrNull(item.husbandryMonths);
  const husbandryMonths = months !== null && Number.isInteger(months) && months > 0 && months <= 1200 ? months : null;
  let husbandryDays = numberOrNull(item.husbandryDays) ?? daysBetween(intakeDate, item.endDate || "");
  let endDate = normalizedDate(String(item.endDate || "")) || addDays(intakeDate, husbandryDays);
  if (husbandryMonths !== null) {
    endDate = calendarMonthEnd(intakeDate, husbandryMonths);
    husbandryDays = daysBetween(intakeDate, endDate);
  }
  return {
    intakePurpose: directSampling ? "direct_sampling" : "housing",
    id: String(item.id || createClientId()),
    rawMessage: String(item.rawMessage || ""),
    ...(item.recognition ? { recognition: item.recognition } : {}),
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
    ...(item.specification !== undefined ? { specification: String(item.specification).trim() } : {}),
    sex: normalizeIntakeSex(item.sex),
    quantity,
    roomName: directSampling ? "" : roomName,
    roomMatched: !directSampling && (roomNames.length ? roomNames.includes(roomName) : Boolean(item.roomMatched)),
    intakeDate,
    husbandryDays: directSampling ? null : husbandryDays,
    ...("husbandryMonths" in item ? { husbandryMonths: directSampling ? null : husbandryMonths } : {}),
    endDate: directSampling ? "" : endDate,
    project: String(item.project || "").trim(),
    pi: String(item.pi || "").trim(),
    owner: String(item.owner || "").trim(),
    receiverName: String(item.receiverName || "").trim(),
    vetPhone: String(item.vetPhone || "").trim(),
    notes: String(item.notes || "").trim(),
    status: directSampling
      ? status === "draft" || status === "received"
        ? status
        : "pending_receipt"
      : status === "pending_receipt"
        ? "pending_print"
        : status,
    suggestedAnimalsPerCage: perCage,
    suggestedCardCount: directSampling ? 0 : suggestedCardCount,
    finalCardCount: directSampling ? 0 : finalCardCount,
    confirmedCardCount: directSampling ? 0 : confirmedCardCount,
    remainingCardCount: directSampling
      ? 0
      : Math.max(numberOrNull(item.remainingCardCount) ?? finalCardCount - confirmedCardCount, 0),
    receipts: Array.isArray(item.receipts) ? item.receipts : [],
    cards: !directSampling && Array.isArray(item.cards) ? item.cards : [],
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
  const periodText = matchField(raw, ["饲养周期（天）", "饲养周期(天)", "饲养周期", "周期"]);
  const monthMatch = periodText.match(/^(\d+|一|两|二|三|四|五|六|七|八|九|十)\s*个?\s*(?:自然月|月)(?!龄)/);
  const numerals: Record<string, number> = {
    一: 1,
    两: 2,
    二: 2,
    三: 3,
    四: 4,
    五: 5,
    六: 6,
    七: 7,
    八: 8,
    九: 9,
    十: 10,
  };
  const husbandryMonths = monthMatch ? numerals[monthMatch[1]] || Number(monthMatch[1]) : null;
  const husbandryDays = husbandryMonths ? null : numberOrNull(periodText);
  return normalizeIntakeBatch(
    {
      rawMessage: raw,
      intakePurpose: inferIntakePurpose(raw),
      purchaseOrderNo,
      batchNo,
      iacuc,
      supplier: abbreviateSupplier(supplier),
      strainRaw,
      strainStandard: standardizeStrain(strainRaw) || strainRaw,
      species: inferSpecies(`${raw} ${strainRaw}`),
      sex: matchField(raw, ["性别"]).split(
        /(?:数量|供应商|购买单位|饲养房间|房间|接收日期|进驻日期|品系|批次号|项目负责人|实验负责人)\s*[:：]/,
      )[0],
      quantity,
      roomName,
      intakeDate: normalizedDate(dateText, referenceYear),
      husbandryDays,
      ...(husbandryMonths ? { husbandryMonths } : {}),
      receiverName,
      status: "pending_print",
    },
    roomNames,
  );
}

export function updateIntakeDraft<K extends keyof IntakeBatch>(
  current: IntakeBatch,
  key: K,
  value: IntakeBatch[K],
  roomNames: string[] = [],
): IntakeBatch {
  const next = { ...current, [key]: value };
  if (key === "intakePurpose" && value !== current.intakePurpose) {
    if (current.status === "printed" || current.status === "received" || current.receipts.length) return current;
    if (value === "housing") {
      const count = Math.ceil(Math.max(current.quantity ?? 0, 0) / Math.max(current.suggestedAnimalsPerCage, 1));
      next.suggestedCardCount = count;
      next.finalCardCount = count;
    }
  } else if (key === "endDate") {
    if ("husbandryMonths" in current) next.husbandryMonths = null;
    next.husbandryDays = daysBetween(next.intakeDate, next.endDate);
  } else if (key === "husbandryDays") {
    if ("husbandryMonths" in current) next.husbandryMonths = null;
    next.endDate = addDays(next.intakeDate, next.husbandryDays);
  } else if (key === "intakeDate") {
    if (next.husbandryDays !== null) next.endDate = addDays(next.intakeDate, next.husbandryDays);
    else next.husbandryDays = daysBetween(next.intakeDate, next.endDate);
  }
  return normalizeIntakeBatch(next, roomNames);
}

/** Calendar addition clamps the target day at month end rather than rolling into another month. */
function calendarMonthEnd(value: string, months: number) {
  const start = normalizedDate(value);
  if (!start) return "";
  const day = Number(start.slice(-2));
  const end = new Date(`${start}T00:00:00Z`);
  end.setUTCDate(1);
  end.setUTCMonth(end.getUTCMonth() + months + 1);
  end.setUTCDate(0);
  end.setUTCDate(Math.min(day, end.getUTCDate()));
  return Number.isFinite(end.getTime()) ? normalizedDate(end.toISOString().slice(0, 10)) : "";
}

function daysBetween(start: string, end: string): number | null {
  const startDate = normalizedDate(start);
  const endDate = normalizedDate(end);
  if (!startDate || !endDate) return null;
  const days = (Date.parse(`${endDate}T00:00:00Z`) - Date.parse(`${startDate}T00:00:00Z`)) / 86_400_000;
  return Number.isInteger(days) && days >= 0 ? days : null;
}

function addDays(value: string, days: number | null) {
  const start = normalizedDate(value);
  if (!start || days === null || !Number.isInteger(days) || days < 0) return "";
  const date = new Date(`${start}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return Number.isFinite(date.getTime()) ? normalizedDate(date.toISOString().slice(0, 10)) : "";
}

export function intakeStatusLabel(status: IntakeBatchStatus) {
  return { draft: "草稿", pending_print: "未打印", pending_receipt: "待接收", printed: "已打印", received: "已接收" }[
    status
  ];
}
