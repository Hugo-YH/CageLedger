import type { BillingStatementLine } from "../api/contracts";
import { escapeHtml, money, normalizeIacuc, numberText } from "./settlementSupport";

type CustomBillingBreakdown = {
  iacuc?: string;
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

export function customBillingDetailsMarkup(lines: BillingStatementLine[]) {
  const details = new Map<
    string,
    {
      iacuc: string;
      startDate: string;
      endDate: string;
      quantity: number;
      unitPrice: number;
      billingUnit: string;
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
        note,
        amount: 0,
      };
      current.amount += Number(item.payableAmount ?? item.amount ?? 0);
      details.set(key, current);
    }),
  );
  if (!details.size) return "";
  const rows = [...details.values()]
    .sort((left, right) =>
      `${left.iacuc}|${left.startDate}|${left.endDate}`.localeCompare(
        `${right.iacuc}|${right.startDate}|${right.endDate}`,
        "zh-CN",
      ),
    )
    .map(
      (item) =>
        `<tr><td>${escapeHtml(item.iacuc)}</td><td>${escapeHtml(item.startDate)}</td><td>${escapeHtml(item.endDate)}</td><td class="num">${numberText(item.quantity)}</td><td class="money">${money(item.unitPrice)} / ${item.billingUnit === "animal_day" ? "只/天" : "笼/天"}</td><td class="money">${money(item.amount)}</td><td>${escapeHtml(item.note || "-")}</td></tr>`,
    )
    .join("");
  return `<main class="document custom-billing-details"><h1>自定义收费明细</h1><table class="custom-billing-table"><thead><tr><th>IACUC</th><th>开始日期</th><th>结束日期</th><th>每日数量</th><th>单价</th><th>金额（元）</th><th>收费说明</th></tr></thead><tbody>${rows}</tbody></table></main>`;
}
