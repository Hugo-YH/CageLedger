import { describe, expect, it } from "vitest";

import type { BillingStatementResponse, IntakeBatch, QuantitySheet } from "../api/contracts";
import { intakeCardsPrintHtml } from "./intakeCards";
import { quantitySheetPagesMarkup } from "./quantitySheets";
import { qrCodeMatrix, qrCodeSvg } from "./qrCode";
import { settlementStatementHtml } from "./settlement";

describe("print templates", () => {
  it("generates a scannable QR matrix for a cage card short code", () => {
    const matrix = qrCodeMatrix("ABCD");
    expect(matrix).toHaveLength(21);
    expect(qrCodeSvg("ABCD")).toContain("<rect");
  });

  it("prints persisted cage-card QR IDs as SVG", () => {
    const batch = {
      batchNo: "B1",
      supplier: "S",
      strainStandard: "C57",
      pi: "PI",
      owner: "O",
      receiverName: "R",
      vetPhone: "1",
      intakeDate: "2026-06-01",
      endDate: "2026-06-30",
      roomName: "8014",
      quantity: 5,
      finalCardCount: 1,
      cards: [{ qrId: "ABCD", label: "1/1", index: 1, suggestedQuantity: "5" }],
    } as IntakeBatch;
    const html = intakeCardsPrintHtml([batch]);
    expect(html).toContain('aria-label="笼卡二维码"');
    expect(html).toContain("grid-auto-rows:40.09mm");
    expect(html).toContain("width:9.5mm");
    expect(html).toContain("width:19mm;height:19mm");
    expect(html).toContain('viewBox="0 0 23 23"');
    expect(html).toContain("5/5");
    expect(html).toContain('window.addEventListener("load"');
    expect(html).not.toContain("保存后生成");
  });

  it("keeps the last cage quantity blank when the batch cannot divide evenly", () => {
    const batch = {
      quantity: 23,
      intakeDate: "2026-07-01",
      endDate: "",
      finalCardCount: 5,
      cards: [{ qrId: "WXYZ", label: "5/5", index: 5, suggestedQuantity: "" }],
    } as IntakeBatch;
    expect(intakeCardsPrintHtml([batch])).toContain(" /23");
  });

  it("uses the two-column official quantity sheet layout", () => {
    const sheet = {
      month: "2026-05",
      roomName: "8014",
      manager: "登记人员",
      roomManager: "房间管理员",
      iacuc: "Z1",
      pi: "张教授",
      owner: "陈老师",
      project: "项目",
      pageCount: 1,
      rows: [
        {
          date: "2026-05-01",
          addedCount: 5,
          addedType: "购入",
          transferInFromIacuc: "",
          removedCount: null,
          removedType: "",
          transferOutToIacuc: "",
          animalCount: 5,
          cageCount: 1,
        },
        {
          date: "2026-05-31",
          addedCount: null,
          addedType: "",
          transferInFromIacuc: "",
          removedCount: null,
          removedType: "",
          transferOutToIacuc: "",
          animalCount: 5,
          cageCount: 1,
        },
      ],
    } as QuantitySheet;
    const html = quantitySheetPagesMarkup([sheet]);
    expect(html).toContain("实验动物数量统计表");
    expect(html.match(/新增（购\/转\/分）/g)).toHaveLength(2);
    expect(html.match(/<col/g)).toHaveLength(13);
    expect(html.match(/经手人/g)).toHaveLength(2);
    expect(html.match(/2026\.5\./g)).toHaveLength(31);
    expect(html).toContain("2026.5.31");
    expect(html).toContain("房间管理员：房间管理员");
    expect(html).not.toContain("房间管理员：登记人员");
  });

  it("renders settlement columns by iacuc and species with explicit zero amounts", () => {
    const result = {
      statement: {
        id: "s1",
        month: "2026-06",
        iacuc: "pi::张教授",
        iacucs: ["Z1", "Z2"],
        project: "项目",
        pi: "张教授",
        owner: "",
        funding: "",
        sourceType: "pi_merged_quantity_sheet",
        billingUnit: "mixed",
        freeCageAllowance: 20,
        totalCageDays: 12,
        totalAnimalDays: 3,
        totalFreeCageDays: 10,
        totalBillableCageDays: 2,
        totalAmount: 48,
      },
      lines: [
        {
          date: "2026-06-01",
          animalCount: 3,
          cageCount: 12,
          freeCages: 10,
          billableCages: 5,
          amount: 48,
          cumulative: 48,
          iacucBreakdown: [
            {
              iacuc: "Z1",
              cageCount: 6,
              freeCages: 6,
              billingItem: "小鼠饲养费",
              billingUnit: "cage_day",
              unitPrice: 4.5,
              fullExemption: true,
            },
            {
              iacuc: "Z1",
              animalCount: 3,
              freeCages: 0,
              billingItem: "猴饲养费",
              billingUnit: "animal_day",
              unitPrice: 13,
            },
            { iacuc: "Z2", cageCount: 6, freeCages: 4, unitPrice: 4.5 },
          ],
        },
      ],
    } as BillingStatementResponse;
    const html = settlementStatementHtml(result, false);
    expect(html).toContain("Z1（全额减免）");
    expect(html).toContain("Z1（猴）");
    expect(html).toContain("Z2");
    expect(html).toContain("48.00");
    expect(html).toContain('<td class="money">0.00</td>');
    expect(html).toContain("计费单位：混合");
    expect(html).toContain('class="meta-table"');
    expect(html).toContain("全额减免：Z1");
    expect(html).toContain('class="sign-table"');
    expect(html).toContain("支撑经费：-");
    expect(html).not.toContain("结算单二维码");
    expect(html).toContain("第 1 / 1 页");
    expect(html).toContain(".summary-table .col-date{width:20mm;min-width:20mm;max-width:20mm}");
    expect(html).toContain("@page{size:A4;margin:10mm}");
  });

  it("hides unused allowance columns and keeps paid amounts explicit", () => {
    const result = {
      statement: {
        id: "s2",
        month: "2026-06",
        iacuc: "pi::张教授",
        iacucs: ["Z1", "Z2"],
        project: "项目",
        pi: "张教授",
        owner: "",
        funding: "",
        sourceType: "pi_merged_quantity_sheet",
        billingUnit: "cage_day",
        freeCageAllowance: 6,
        totalCageDays: 12,
        totalAnimalDays: 0,
        totalFreeCageDays: 6,
        totalBillableCageDays: 6,
        totalTier2CageDays: 0,
        totalAmount: 27,
      },
      lines: [
        {
          date: "2026-06-01",
          animalCount: 0,
          cageCount: 12,
          freeCages: 6,
          billableCages: 6,
          amount: 27,
          cumulative: 27,
          iacucBreakdown: [
            { iacuc: "Z1", cageCount: 6, freeCages: 6, unitPrice: 4.5 },
            { iacuc: "Z2", cageCount: 6, freeCages: 0, unitPrice: 4.5 },
          ],
        },
        {
          date: "2026-06-02",
          animalCount: 0,
          cageCount: 6,
          freeCages: 0,
          billableCages: 6,
          amount: 27,
          cumulative: 54,
          iacucBreakdown: [{ iacuc: "Z2", cageCount: 6, freeCages: 0, unitPrice: 4.5 }],
        },
      ],
    } as BillingStatementResponse;
    const html = settlementStatementHtml(result, false);
    expect(html).toContain('<th colspan="3">Z1</th>');
    expect(html).toContain('<th colspan="2">Z2</th>');
    expect(html.match(/<th>减免<\/th>/g)).toHaveLength(1);
    expect(html).toContain('<td class="money">0.00</td>');
    expect(html).toContain('<td class="money">27.00</td>');
    expect(html).toContain(
      '2026-06-02</td><td class="num">6</td><td class="num"></td><td class="num"></td><td class="num"></td><td class="money"></td>',
    );
    expect(html).not.toContain("梯度笼数");
    expect(html).not.toContain("未缴纳月份");
    expect(html).not.toContain("CageLedger · Apache-2.0");
    expect(html).toContain('class="date-column"');
  });

  it("splits settlement pdf columns across pages after four iacucs on the first page", () => {
    const iacucs = ["Z1", "Z2", "Z3", "Z4", "Z5", "Z6"];
    const result = {
      statement: {
        id: "s3",
        month: "2026-06",
        iacuc: "pi::张教授",
        iacucs,
        project: "项目",
        pi: "张教授",
        owner: "",
        funding: "",
        sourceType: "pi_merged_quantity_sheet",
        billingUnit: "cage_day",
        freeCageAllowance: 0,
        totalCageDays: 21,
        totalAnimalDays: 0,
        totalFreeCageDays: 0,
        totalBillableCageDays: 21,
        totalAmount: 94.5,
      },
      lines: [
        {
          date: "2026-06-01",
          animalCount: 0,
          cageCount: 21,
          freeCages: 0,
          billableCages: 21,
          amount: 94.5,
          cumulative: 94.5,
          iacucBreakdown: iacucs.map((iacuc, index) => ({
            iacuc,
            cageCount: index + 1,
            freeCages: 0,
            billingItem: "小鼠饲养费",
            billingUnit: "cage_day",
            unitPrice: 4.5,
          })),
        },
      ],
    } as BillingStatementResponse;
    const html = settlementStatementHtml(result, false);
    const pages = html.split('class="document document-page');
    expect(html.match(/class="document document-page/g)).toHaveLength(2);
    expect(html).toContain("第 1 / 2 页");
    expect(html).toContain("第 2 / 2 页");
    expect(html).toContain(">Z1<");
    expect(html).toContain(">Z4<");
    expect(html).toContain(">Z5<");
    expect(html).toContain(">Z6<");
    expect(html.match(/单位支持/g)).toHaveLength(6);
    expect(html.match(/项目负责人<\/td><td>实验负责人\/经办人<\/td><td>日期<\/td>/g)).toHaveLength(2);
    expect(pages[1]).toContain("总笼数");
    expect(pages[1]).toContain("减免总笼数");
    expect(pages[2]).not.toContain("总笼数");
    expect(pages[2]).not.toContain("减免总笼数");
    expect(pages[2]).toContain("本页汇总");
  });

  it("keeps the official quantity document title and two-column page structure", () => {
    const html = quantitySheetPagesMarkup([
      {
        id: "sheet-1",
        month: "2026-06",
        roomId: "room-1",
        roomName: "8014",
        manager: "登记人员",
        roomManager: "房间管理员",
        iacuc: "Z1",
        pi: "张教授",
        owner: "陈老师",
        project: "项目",
        contact: "",
        funding: "",
        preferredFreeCages: null,
        freeCagePriority: null,
        fullExemption: false,
        customBillingEnabled: false,
        customUnitPrice: null,
        billingUnit: "cage_day",
        animalDetailEnabled: false,
        initialAnimalCount: 0,
        initialCageCount: 0,
        pageCount: 1,
        rows: [],
        updatedAt: "2026-06-01T00:00:00Z",
      },
    ]);
    expect(html).toContain("实验动物数量统计表");
    expect(html.match(/新增（购\/转\/分）/g)).toHaveLength(2);
    expect(html.match(/2026\.6\./g)).toHaveLength(30);
  });
});
