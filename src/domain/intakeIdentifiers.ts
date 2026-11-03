import type { IntakeIdentifiers } from "../contracts/intake";

type IdentifierInput = {
  purchaseOrderNo?: unknown;
  orderNo?: unknown;
  batchNo?: unknown;
  identifiers?: Partial<IntakeIdentifiers>;
};

const separators = /[、,，;；\r\n]+/;
const purchasePattern = /^C\d{13}$/i;
const orderPattern = /^DC(\d{13})(\d{2})$/i;

function distinct(values: string[]) {
  const result = new Map<string, string>();
  for (const value of values) {
    if (value && !result.has(value.toUpperCase())) result.set(value.toUpperCase(), value);
  }
  return [...result.values()];
}

function split(value: unknown): string[] {
  return String(value ?? "")
    .split(separators)
    .map((part) => part.trim())
    .filter(Boolean);
}

function inputs(
  input: IdentifierInput,
  key: "purchaseOrderNo" | "orderNo" | "batchNo",
  array: keyof IntakeIdentifiers,
) {
  return key in input ? split(input[key]) : (input.identifiers?.[array] ?? []).flatMap(split);
}

function batchNumber(value: string) {
  const text = value.replace(/[（(]\s*([^()（）]+?)\s*[)）]/g, "（$1）");
  const standard = text.match(/^（([A-Z]{1,6}\d{4,})）\s*(\d{6,})$/i);
  return standard ? `（${standard[1].toUpperCase()}）${standard[2]}` : text;
}

export function normalizeIntakeBatchNo(value: unknown): string {
  return distinct(split(value).map(batchNumber)).join("、");
}

export function normalizeIntakeIdentifiers(input: IdentifierInput) {
  const purchases: string[] = [];
  const orders: string[] = [];
  for (const value of inputs(input, "purchaseOrderNo", "purchaseOrderNos")) {
    const normalized = value.toUpperCase();
    if (orderPattern.test(normalized)) orders.push(normalized);
    else purchases.push(purchasePattern.test(normalized) ? normalized : value);
  }
  for (const value of inputs(input, "orderNo", "orderNos")) {
    const normalized = value.toUpperCase();
    if (purchasePattern.test(normalized)) purchases.push(normalized);
    else orders.push(orderPattern.test(normalized) ? normalized : value);
  }
  const explicit = distinct(purchases);
  const orderNos = distinct(orders);
  const derived = distinct(orderNos.flatMap((value) => (orderPattern.test(value) ? [value.slice(1, -2)] : [])));
  const hasConflict =
    explicit.length === 1 &&
    purchasePattern.test(explicit[0]) &&
    orderNos.length === 1 &&
    derived.length === 1 &&
    explicit[0] !== derived[0];
  const purchaseOrderNos = distinct(hasConflict ? explicit : [...explicit, ...derived]);
  const batchNos = distinct(inputs(input, "batchNo", "batchNos").map(batchNumber));
  const identifiers = { purchaseOrderNos, orderNos, batchNos };
  return {
    purchaseOrderNo: purchaseOrderNos.join("、"),
    orderNo: orderNos.join("、"),
    batchNo: batchNos.join("、"),
    ...(Object.values(identifiers).some((values) => values.length > 1) ? { identifiers } : {}),
    hasConflict,
  };
}

export function normalizeIntakeOrderIdentifiers(input: IdentifierInput) {
  const { purchaseOrderNo, orderNo, identifiers } = normalizeIntakeIdentifiers(input);
  return {
    purchaseOrderNo,
    ...(orderNo || "orderNo" in input ? { orderNo } : {}),
    ...(identifiers ? { identifiers } : {}),
  };
}

export function parseIntakeOrderIdentifiers(raw: string) {
  const source = raw.normalize("NFKC").toUpperCase();
  const numbers = [...source.matchAll(/(?<![A-Z0-9])(?:DC\d{15}|C\d{13})(?![A-Z0-9])/g)].map((match) => match[0]);
  let purchases = numbers.filter((number) => number.startsWith("C"));
  let orders = numbers.filter((number) => number.startsWith("DC"));
  if (!numbers.length) {
    // Preserve labelled unknown formats without inferring a relationship or
    // accepting a whitespace-split fragment as a complete identifier.
    const labelled = raw.replace(/[：]/g, ":");
    const purchaseNumbers = [
      ...labelled.matchAll(
        /(?:锐[竞竟](?:采购)?(?:单号|订单编号|采购订单编号)?|采购(?:申请)?单号|采购订单(?:编号|号))\s*(?:为)?\s*:?\s*([A-Z]{0,3}\d{8,})(?![A-Z0-9]|\s+\d)/gi,
      ),
    ].map((match) => match[1]);
    purchases = purchaseNumbers.filter((number) => !/^DC/i.test(number));
    orders = [
      ...[
        ...labelled.matchAll(/(?<!采购)(?:订单编号|订单号)\s*(?:为)?\s*:?\s*([A-Z]{0,3}\d{8,})(?![A-Z0-9]|\s+\d)/gi),
      ].map((match) => match[1]),
      ...purchaseNumbers.filter((number) => /^DC/i.test(number)),
    ];
  }
  const { purchaseOrderNo, orderNo, identifiers, hasConflict } = normalizeIntakeIdentifiers({
    purchaseOrderNo: distinct(purchases).join("、"),
    orderNo: distinct(orders).join("、"),
  });
  return { purchaseOrderNo, orderNo, ...(identifiers ? { identifiers } : {}), hasConflict };
}

export function parseIntakeBatchNumbers(raw: string) {
  return distinct(
    [...raw.normalize("NFKC").matchAll(/\(\s*([A-Z]{1,6}\d{4,})\s*\)\s*(\d{6,})(?![A-Z0-9])/gi)].map(
      (match) => `（${match[1].toUpperCase()}）${match[2]}`,
    ),
  );
}

export function intakeBatchIacucs(batchNo: string) {
  return distinct(
    split(batchNo).flatMap((value) => {
      const match = batchNumber(value).match(/^（([A-Z]{1,6}\d{4,})）\d{6,}$/i);
      return match ? [match[1].toUpperCase()] : [];
    }),
  );
}

export function intakeIdentifierLimitMessage(input: IdentifierInput) {
  const normalized = normalizeIntakeIdentifiers(input);
  const lists = normalized.identifiers ?? {
    purchaseOrderNos: split(normalized.purchaseOrderNo),
    orderNos: split(normalized.orderNo),
    batchNos: split(normalized.batchNo),
  };
  return Object.values(lists).some((values) => values.length > 50 || values.some((value) => value.length > 200))
    ? "同一预约每类编号最多50个，每个编号最多200个字符，请核对后重试。"
    : "";
}
