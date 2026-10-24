import { describe, expect, it } from "vitest";
import type { QuantitySheet } from "../api/contracts";
import { quantitySheetPagesMarkup } from "./quantitySheets";

describe("print templates", () => {
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
    expect(html).not.toContain("登记人员</td>");
    expect(html).toContain('2026.5.2</td><td></td><td></td><td class="num"></td><td class="num">1</td>');
    expect(html).toContain("房间管理员：房间管理员");
    expect(html).not.toContain("房间管理员：登记人员");
  });

  it("leaves animal balances blank for cage-only quantity sheets", () => {
    const html = quantitySheetPagesMarkup([
      {
        id: "cage-only-sheet",
        month: "2026-06",
        roomId: "room-1",
        roomName: "8101",
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
        tierCagePriority: null,
        fullExemption: false,
        customBillingEnabled: false,
        customUnitPrice: null,
        customBillingSegments: [],
        billingUnit: "cage_day",
        animalDetailEnabled: false,
        initialAnimalCount: 0,
        initialCageCount: 0,
        pageCount: 1,
        rows: [
          {
            id: "qrow-1",
            date: "2026-06-01",
            rawDateInput: "2026-06-01",
            addedCount: null,
            addedType: "",
            transferInFromIacuc: "",
            removedCount: null,
            removedType: "",
            transferOutToIacuc: "",
            animalCount: null,
            cageCount: 7,
            handler: "",
            balanceSource: "manual",
            notes: "",
          },
        ],
        updatedAt: "2026-06-01T00:00:00Z",
      },
    ]);
    expect(html).toContain('2026.6.2</td><td></td><td></td><td class="num"></td><td class="num">7</td>');
    expect(html).not.toContain('2026.6.2</td><td></td><td></td><td class="num">0</td>');
  });

  it("leaves cage balances blank for animal-day sheets that only record animal balances", () => {
    const sheet = {
      id: "animal-day-sheet",
      month: "2026-07",
      roomId: "room-monkey",
      roomName: "猴饲养间1",
      manager: "登记人员",
      roomManager: "房间管理员",
      iacuc: "Z-MONKEY",
      pi: "张教授",
      owner: "陈老师",
      project: "项目",
      contact: "",
      funding: "",
      preferredFreeCages: null,
      freeCagePriority: null,
      tierCagePriority: null,
      fullExemption: false,
      customBillingEnabled: false,
      customUnitPrice: null,
      customBillingSegments: [],
      billingUnit: "animal_day",
      animalDetailEnabled: true,
      initialAnimalCount: 0,
      initialCageCount: 0,
      pageCount: 1,
      rows: [
        {
          id: "qrow-1",
          date: "2026-07-01",
          rawDateInput: "2026-07-01",
          addedCount: null,
          addedType: "",
          transferInFromIacuc: "",
          removedCount: null,
          removedType: "",
          transferOutToIacuc: "",
          animalCount: 50,
          cageCount: null,
          handler: "",
          balanceSource: "manual",
          notes: "",
        },
      ],
      updatedAt: "2026-07-01T00:00:00Z",
    } as QuantitySheet;
    const html = quantitySheetPagesMarkup([sheet]);
    // 按只计费房间只录只数：结余总数 50、结余笼数留空，不补 0。
    expect(html).toContain('2026.7.2</td><td></td><td></td><td class="num">50</td><td class="num"></td>');
    expect(html).not.toContain('2026.7.2</td><td></td><td></td><td class="num">50</td><td class="num">0</td>');
  });

  it("prints entered cage balances for animal-day sheets that record cage counts", () => {
    const sheet = {
      id: "animal-day-cage-sheet",
      month: "2026-07",
      roomId: "room-monkey",
      roomName: "猴饲养间1",
      manager: "登记人员",
      roomManager: "房间管理员",
      iacuc: "Z-MONKEY",
      pi: "张教授",
      owner: "陈老师",
      project: "项目",
      contact: "",
      funding: "",
      preferredFreeCages: null,
      freeCagePriority: null,
      tierCagePriority: null,
      fullExemption: false,
      customBillingEnabled: false,
      customUnitPrice: null,
      customBillingSegments: [],
      billingUnit: "animal_day",
      animalDetailEnabled: true,
      initialAnimalCount: 0,
      initialCageCount: 0,
      pageCount: 1,
      rows: [
        {
          id: "qrow-1",
          date: "2026-07-01",
          rawDateInput: "2026-07-01",
          addedCount: null,
          addedType: "",
          transferInFromIacuc: "",
          removedCount: null,
          removedType: "",
          transferOutToIacuc: "",
          animalCount: 50,
          cageCount: 3,
          handler: "",
          balanceSource: "manual",
          notes: "",
        },
      ],
      updatedAt: "2026-07-01T00:00:00Z",
    } as QuantitySheet;
    const html = quantitySheetPagesMarkup([sheet]);
    expect(html).toContain('2026.7.2</td><td></td><td></td><td class="num">50</td><td class="num">3</td>');
  });

  it("adds custom-billing details as a dedicated quantity-sheet appendix", () => {
    const sheet = {
      id: "custom-sheet",
      month: "2026-07",
      roomId: "room-1",
      roomName: "兔房",
      manager: "登记人员",
      roomManager: "房间管理员",
      iacuc: "Z-RABBIT",
      pi: "张教授",
      owner: "陈老师",
      project: "项目",
      contact: "",
      funding: "",
      preferredFreeCages: null,
      freeCagePriority: null,
      tierCagePriority: null,
      fullExemption: false,
      customBillingEnabled: true,
      customUnitPrice: null,
      customBillingSegments: [
        {
          id: "special-feed",
          startDate: "2026-07-10",
          endDate: "2026-07-20",
          quantity: 5,
          unitPrice: 12,
          note: "特殊饲料",
        },
      ],
      billingUnit: "animal_day" as const,
      animalDetailEnabled: true,
      initialAnimalCount: 10,
      initialCageCount: 10,
      pageCount: 1,
      rows: [],
      updatedAt: "2026-07-01T00:00:00Z",
    } satisfies QuantitySheet;
    const html = quantitySheetPagesMarkup([sheet]);
    expect(html).toContain("自定义收费明细");
    expect(html).toContain("特殊饲料");
    expect(html).toContain("¥12.00 / 只/天");
    const allHtml = quantitySheetPagesMarkup([
      { ...sheet, customBillingSegments: [{ ...sheet.customBillingSegments[0], quantityMode: "all", quantity: null }] },
    ]);
    expect(allHtml).toContain('<td class="num">全部</td>');
    expect(allHtml).toContain("¥12.00 / 只/天");
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
        tierCagePriority: null,
        fullExemption: false,
        customBillingEnabled: false,
        customUnitPrice: null,
        customBillingSegments: [],
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
