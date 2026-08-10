import { describe, expect, it } from "vitest";

import { buildSettlementNoticeEmail } from "./settlementNotice";

describe("buildSettlementNoticeEmail", () => {
  it("fills month, period, amount, staff and date placeholders", () => {
    const { subject, body } = buildSettlementNoticeEmail({
      month: "2026-07",
      totalAmount: 12345.6,
      staffName: "于欢",
      staffPhone: "13800138000",
      date: new Date("2026-08-10T12:00:00+08:00"),
    });
    expect(subject).toBe("实验动物中心关于开展2026年07月实验动物饲养费结算的通知");
    expect(body).toContain("您在2026年07月01日至07月31日期间");
    expect(body).toContain("当月应交总额为12,345.60元");
    expect(body).toContain("（于欢 13800138000）");
    expect(body).toContain("实验动物中心\n2026年08月10日");
  });

  it("handles zero amount and empty staff fields", () => {
    const { body } = buildSettlementNoticeEmail({
      month: "2026-12",
      totalAmount: 0,
      staffName: "",
      staffPhone: "",
      date: new Date("2026-12-01T00:00:00+08:00"),
    });
    expect(body).toContain("当月应交总额为0.00元");
    expect(body).toContain("（ ）");
    expect(body).toContain("2026年12月01日至12月31日");
  });
});
