import { describe, expect, it } from "vitest";
import type { BillingStatementLine, BillingStatementResponse } from "../api/contracts";
import settlementParityFixture from "./fixtures/settlement-parity.json";
import { settlementStatementHtml } from "./settlement";
import { settlementNotesMarkup } from "./settlementNotes";

describe("print templates", () => {
  it("keeps the browser settlement template aligned with the server parity fixture", () => {
    const html = settlementStatementHtml(settlementParityFixture as BillingStatementResponse, false);
    [
      "模板校验课题组实验动物饲养费核算汇总表",
      "Z-PARITY-MOUSE",
      "Z-PARITY-RABBIT",
      "小鼠",
      "兔",
      "单位支持：45.00",
      "实际待缴纳：45.00",
      "第1页 共1页",
    ].forEach((expected) => expect(html).toContain(expected));
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
    expect(html).toContain("Z1 / ¥4.50（全额减免）");
    expect(html).toContain("Z1 / ¥13.00");
    expect(html).toContain("Z2");
    expect(html).toContain("48.00");
    expect(html).toContain('<td colspan="4" class="money">0.00</td>');
    expect(html).toContain("计费单位：混合");
    expect(html).toContain('class="meta-table"');
    expect(html).toContain("全额减免：Z1");
    expect(html).toContain('class="sign-table"');
    expect(html).toContain("支撑经费：-");
    expect(html).not.toContain("结算单二维码");
    expect(html).toContain("第1页 共1页");
    expect(html).toContain(".summary-table .col-date{width:8.4%;min-width:8.4%;max-width:8.4%}");
    expect(html).toContain(".summary-table .col-group{width:1.526667%}");
    expect(html).toContain("@page{size:A4;margin:10mm}");
  });

  it("renders custom billing in settlement notes without a dedicated document page", () => {
    const markup = settlementNotesMarkup(
      [
        {
          speciesLabel: "兔",
          billingUnit: "animal_day",
          unitPrice: 12,
          overageUnitPrice: 0,
          tiered: false,
          hasTieredCharge: false,
        },
      ],
      "",
      [
        {
          date: "2026-06-10",
          animalCount: 5,
          cageCount: 0,
          freeCages: 0,
          billableCages: 0,
          amount: 60,
          cumulative: 60,
          iacucBreakdown: [
            {
              iacuc: "Z-RABBIT",
              animalCount: 5,
              billingItem: "兔饲养费",
              billingUnit: "animal_day",
              unitPrice: 12,
              customBilling: true,
              customBillingSegmentId: "special-feed",
              customBillingStartDate: "2026-06-10",
              customBillingEndDate: "2026-06-20",
              customBillingNote: "特殊饲料",
              payableAmount: 60,
            },
          ],
        },
      ] as BillingStatementLine[],
    );
    expect(markup).toContain("自定义收费：");
    expect(markup).toContain("Z-RABBIT：2026-06-10 至 2026-06-20，每日5只兔，12元/只/日，本月共计60.00元。特殊饲料");
    expect(markup).not.toContain("自定义收费明细");
  });

  it("renders tiered iacuc columns with a dedicated tier column", () => {
    const result = {
      statement: {
        id: "s-tiered",
        month: "2026-06",
        iacuc: "pi::张教授",
        iacucs: ["Z2026001"],
        project: "项目",
        pi: "张教授",
        owner: "陈老师",
        funding: "",
        sourceType: "pi_merged_quantity_sheet",
        billingUnit: "cage_day",
        freeCageAllowance: 5,
        totalCageDays: 170,
        totalAnimalDays: 0,
        totalFreeCageDays: 5,
        totalBillableCageDays: 165,
        totalTier2CageDays: 5,
        totalAmount: 770,
      },
      lines: [
        {
          date: "2026-06-01",
          animalCount: 0,
          cageCount: 170,
          freeCages: 5,
          billableCages: 165,
          tier2Cages: 10,
          amount: 770,
          cumulative: 770,
          iacucBreakdown: [
            {
              iacuc: "Z2026001",
              cageCount: 170,
              freeCages: 5,
              tier2Cages: 10,
              tier2BillableCages: 5,
              payableAmount: 770,
              billingItem: "小鼠饲养费",
              billingUnit: "cage_day",
              unitPrice: 4.5,
              overageUnitPrice: 7.25,
              tiered: true,
            },
          ],
        },
      ],
    } as BillingStatementResponse;
    const html = settlementStatementHtml(result, false);
    expect(html).toContain('<th colspan="12">汇总</th>');
    expect(html).toContain(
      '<th colspan="3">笼数</th><th colspan="2">减免</th><th colspan="3">梯度</th><th colspan="4">缴纳（元）</th>',
    );
    expect(html).toContain('<th colspan="12">Z2026001（梯度收费）</th>');
    expect(html).toContain(
      '<th colspan="3">笼数</th><th colspan="2">减免</th><th colspan="3">梯度</th><th colspan="4">缴纳（元）</th>',
    );
    expect(html).toContain(
      '<td colspan="2" class="num">5</td><td colspan="3" class="num">5</td><td colspan="4" class="money">770.00</td>',
    );
    expect(html).toContain("笼位数≤160，4.5元/笼/日；笼位数＞160，7.25元/笼/日");
    expect(html).not.toContain("梯度笼数");
  });

  it("groups settlement IACUC columns by species and limits summary fields to mice", () => {
    const result = {
      statement: {
        id: "s-species",
        month: "2026-06",
        iacuc: "pi::张教授",
        iacucs: ["R1", "Z1", "M1"],
        project: "项目",
        pi: "张教授",
        owner: "陈老师",
        funding: "",
        sourceType: "pi_merged_quantity_sheet",
        billingUnit: "mixed",
        totalCageDays: 8,
        totalAnimalDays: 1,
        totalFreeCageDays: 2,
        totalBillableCageDays: 6,
        totalAmount: 58.5,
      },
      lines: [
        {
          date: "2026-06-01",
          animalCount: 1,
          cageCount: 8,
          freeCages: 2,
          billableCages: 6,
          amount: 58.5,
          cumulative: 58.5,
          iacucBreakdown: [
            { iacuc: "R1", species: "rat", cageCount: 2, payableAmount: 17, billingUnit: "cage_day", unitPrice: 8.5 },
            {
              iacuc: "Z1",
              species: "mouse",
              cageCount: 6,
              freeCages: 2,
              payableAmount: 18,
              billingUnit: "cage_day",
              unitPrice: 4.5,
              statementOverageUnitPrice: 6.5,
              statementTiered: true,
              overageUnitPrice: 6.5,
              tiered: true,
            },
            {
              iacuc: "M1",
              species: "monkey",
              animalCount: 1,
              payableAmount: 23.5,
              billingUnit: "animal_day",
              unitPrice: 23.5,
            },
          ],
        },
      ],
    } as BillingStatementResponse;
    const html = settlementStatementHtml(result, false);
    expect(html).toContain('<th colspan="24">小鼠</th>');
    expect(html).toContain('<th colspan="12">大鼠</th>');
    expect(html).toContain('<th colspan="12">猴</th>');
    expect(html).toContain('<th colspan="12">汇总</th>');
    expect(html).toContain('<th colspan="6">笼数</th><th colspan="6">缴纳（元）</th>');
    expect(html).toContain('<th colspan="6">只数</th><th colspan="6">缴纳（元）</th>');
    expect(html).toContain("收费标准：");
    expect(html).toContain("1）小鼠 4.5元/笼/日、2）大鼠 8.5元/笼/日、3）猴 23.5元/只/日");
    expect(html).not.toContain("笼位数＞160");
    expect(html).not.toContain("伦理到期提示：");
  });

  it("shows billable tier cages in the summary column and iacuc columns", () => {
    const result = {
      statement: {
        id: "s-tiered-raw",
        month: "2026-06",
        iacuc: "pi::张峰",
        iacucs: ["A", "B"],
        project: "项目",
        pi: "张峰",
        owner: "陈老师",
        funding: "",
        sourceType: "pi_merged_quantity_sheet",
        billingUnit: "cage_day",
        freeCageAllowance: 20,
        totalCageDays: 377,
        totalAnimalDays: 0,
        totalFreeCageDays: 20,
        totalBillableCageDays: 357,
        totalTier2CageDays: 197,
        totalAmount: 2000.5,
      },
      lines: [
        {
          date: "2026-06-01",
          animalCount: 0,
          cageCount: 377,
          freeCages: 20,
          billableCages: 357,
          tier2Cages: 217,
          tier2BillableCages: 197,
          amount: 2000.5,
          cumulative: 2000.5,
          iacucBreakdown: [
            {
              iacuc: "A",
              cageCount: 166,
              freeCages: 20,
              tier2Cages: 166,
              tier2BillableCages: 146,
              supportAmount: 130,
              payableAmount: 949,
              billingItem: "小鼠饲养费",
              billingUnit: "cage_day",
              unitPrice: 4.5,
              overageUnitPrice: 6.5,
              tiered: true,
            },
            {
              iacuc: "B",
              cageCount: 211,
              freeCages: 0,
              tier2Cages: 51,
              tier2BillableCages: 51,
              supportAmount: 0,
              payableAmount: 1051.5,
              billingItem: "小鼠饲养费",
              billingUnit: "cage_day",
              unitPrice: 4.5,
              overageUnitPrice: 6.5,
              tiered: true,
            },
          ],
        },
      ],
    } as BillingStatementResponse;
    const html = settlementStatementHtml(result, false);
    expect(html).toContain('<td colspan="3" class="num">197</td>');
    expect(html).toContain('<td colspan="3" class="num">146</td><td colspan="4" class="money">949.00</td>');
    expect(html).toContain('<td colspan="3" class="num">51</td><td colspan="5" class="money">1051.50</td>');
  });

  it("keeps a recorded zero-balance collection date in the settlement printout", () => {
    const result = {
      statement: {
        id: "s-zero-balance",
        month: "2026-06",
        iacuc: "pi::张教授",
        iacucs: ["Z1"],
        project: "项目",
        pi: "张教授",
        owner: "",
        funding: "",
        sourceType: "pi_merged_quantity_sheet",
        billingUnit: "cage_day",
        freeCageAllowance: 0,
        totalCageDays: 1,
        totalAnimalDays: 0,
        totalFreeCageDays: 0,
        totalBillableCageDays: 1,
        totalAmount: 4.5,
      },
      lines: [
        {
          date: "2026-06-01",
          animalCount: 0,
          cageCount: 1,
          freeCages: 0,
          billableCages: 1,
          amount: 4.5,
          cumulative: 4.5,
          iacucBreakdown: [{ iacuc: "Z1", cageCount: 1, billingUnit: "cage_day", unitPrice: 4.5 }],
        },
        {
          date: "2026-06-02",
          animalCount: 0,
          cageCount: 0,
          freeCages: 0,
          billableCages: 0,
          amount: 0,
          cumulative: 4.5,
          iacucBreakdown: [],
          quantitySheetRowIds: ["qrow-collection"],
        },
      ],
    } as BillingStatementResponse;
    const html = settlementStatementHtml(result, false);
    expect(html).toContain("2026-06-02");
  });

  it("renders an expiry note from the settlement statement", () => {
    const result = {
      statement: {
        id: "s-expiry-note",
        month: "2026-06",
        iacuc: "pi::张教授",
        iacucs: ["Z1"],
        project: "项目",
        pi: "张教授",
        owner: "",
        funding: "",
        sourceType: "pi_merged_quantity_sheet",
        billingUnit: "cage_day",
        freeCageAllowance: 20,
        totalCageDays: 1,
        totalAnimalDays: 0,
        totalFreeCageDays: 0,
        totalBillableCageDays: 1,
        totalAmount: 4.5,
        notes: "Z1 将于 2026-06-15 到期，自 2026-06-16 起不参与减免",
      },
      lines: [
        {
          date: "2026-06-16",
          animalCount: 0,
          cageCount: 1,
          freeCages: 0,
          billableCages: 1,
          amount: 4.5,
          cumulative: 4.5,
          iacucBreakdown: [{ iacuc: "Z1", cageCount: 1, billingUnit: "cage_day", unitPrice: 4.5 }],
        },
      ],
    } as BillingStatementResponse;
    const html = settlementStatementHtml(result, false);
    expect(html).toContain("伦理到期提示：");
    expect(html).toContain("Z1 将于 2026-06-15 到期，自 2026-06-16 起不参与减免");
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
    expect(html).toContain('<th colspan="12">Z1</th>');
    expect(html).toContain('<th colspan="12">Z2</th>');
    expect(html).toContain('<th colspan="4">笼数</th><th colspan="4">减免</th><th colspan="4">缴纳（元）</th>');
    expect(html).toContain('<td colspan="4" class="money">0.00</td>');
    expect(html).toContain('<td colspan="6" class="money">27.00</td>');
    expect(html).toContain(
      '2026-06-02</td><td colspan="4" class="num">6</td><td colspan="4" class="num">0</td><td colspan="4" class="money">27.00</td><td colspan="4" class="num group-empty-cell"></td><td colspan="4" class="num group-empty-cell"></td><td colspan="4" class="money group-empty-cell"></td><td colspan="6" class="num">6</td><td colspan="6" class="money">27.00</td>',
    );
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
    expect(html).toContain("第1页 共2页");
    expect(html).toContain("第2页 共2页");
    expect(html).toContain(">Z1<");
    expect(html).toContain(">Z4<");
    expect(html).toContain(">Z5<");
    expect(html).toContain(">Z6<");
    expect(html.match(/单位支持/g)).toHaveLength(6);
    expect(html.match(/项目负责人<\/td><td>实验负责人\/经办人<\/td><td>日期<\/td>/g)).toHaveLength(2);
    expect(pages[1]).toContain(">笼数<");
    expect(pages[1]).toContain("汇总");
    expect(pages[1]).toContain(
      '<td>2026-06-01</td><td colspan="6" class="num">21</td><td colspan="6" class="money">94.50</td>',
    );
    expect(pages[1]).toContain(
      '<td colspan="7" class="row-label row-label-summary row-label-summary-wide">本月待缴纳饲养费<br />总计（元）</td><td colspan="6" class="money summary-total-money">94.50</td>',
    );
    expect(pages[2]).not.toContain('<th colspan="12">汇总</th>');
    expect(pages[2]).toContain("本页汇总");
    expect((pages[1].match(/col-group/g) || []).length).toBe(60);
    expect((pages[2].match(/col-group/g) || []).length).toBe(60);
  });

  it("pads missing iacuc columns with empty groups to keep fixed page width", () => {
    const result = {
      statement: {
        id: "s4",
        month: "2026-06",
        iacuc: "pi::张教授",
        iacucs: ["Z1", "Z2", "Z3"],
        project: "项目",
        pi: "张教授",
        owner: "",
        funding: "",
        sourceType: "pi_merged_quantity_sheet",
        billingUnit: "cage_day",
        freeCageAllowance: 0,
        totalCageDays: 6,
        totalAnimalDays: 0,
        totalFreeCageDays: 0,
        totalBillableCageDays: 6,
        totalAmount: 27,
      },
      lines: [
        {
          date: "2026-06-01",
          animalCount: 0,
          cageCount: 6,
          freeCages: 0,
          billableCages: 6,
          amount: 27,
          cumulative: 27,
          iacucBreakdown: ["Z1", "Z2", "Z3"].map((iacuc, index) => ({
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
    expect(html.match(/class="column-empty"/g)).toHaveLength(1);
  });
});
