import { describe, expect, it } from "vitest";

import type { BillingStatementResponse } from "../../contracts/billing";
import { settlementStatementHtml } from "./settlement";
import { technicalServiceNotice } from "../../domain/technicalServiceNotice";

function sample(count: number): BillingStatementResponse {
  return {
    statement: {
      id: "service-preview",
      sourceType: "pi_merged_technical_service",
      month: "2026-10",
      pi: "纪老师",
      project: "<项目>",
      iacuc: "Z2026001",
      owner: "",
      funding: "",
      totalAmount: count * 30,
      totalCageDays: 0,
      totalAnimalDays: 0,
      totalFreeCageDays: 0,
      totalBillableCageDays: 0,
      serviceDayCount: count,
      technicalServiceRows: Array.from({ length: count }, (_, i) => ({
        date: `2026-10-${String(i + 1).padStart(2, "0")}`,
        iacuc: "Z2026001",
        facility: "zhujiang",
        serviceName: "大动物滴眼<script>",
        unit: "眼",
        quantity: 1,
        unitPrice: 30,
        amount: 30,
      })),
    },
    lines: [],
  };
}

describe("技术服务双渲染及邮件", () => {
  it("keeps whole-document totals across pages and escapes names", () => {
    const html = settlementStatementHtml(sample(25), false);
    expect(html.match(/class="technical-service-print-page"/g)).toHaveLength(2);
    expect(html).toContain("750.00 元");
    expect(html).toContain("第 2 / 2 页");
    expect(html).toContain("2026-10-25");
    expect(html).toContain("大动物滴眼&lt;script&gt;");
    expect(html).not.toContain("动物饲养费核算汇总表");
  });
  it("mail uses the independent service total", () => {
    const mail = technicalServiceNotice("2026-10", "纪老师", 300);
    expect(mail.subject).toContain("技术服务费");
    expect(mail.body).toContain("300.00元");
    expect(mail.body).toContain("分别结算");
  });
});
