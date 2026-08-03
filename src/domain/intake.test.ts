import { describe, expect, it } from "vitest";

import {
  abbreviateSupplier,
  missingIntakeRequiredFields,
  normalizeIntakeBatch,
  parseIntakeMessage,
  standardizeStrain,
} from "./intake";

describe("intake message parser", () => {
  it("extracts the purchase and husbandry fields", async () => {
    const result = await parseIntakeMessage(
      "锐竞采购单号：C2026043035083 饲养需求批次号：（Z2025050）2026042903 供应商：广东南模生物科技有限公司 品系：c57 数量：70 饲养房间：8101 进驻日期：5月13日",
      "管理员",
      ["8101"],
    );
    expect(result.purchaseOrderNo).toBe("C2026043035083");
    expect(result.batchNo).toBe("（Z2025050）2026042903");
    expect(result.iacuc).toBe("Z2025050");
    expect(result.quantity).toBe(70);
    expect(result.roomName).toBe("8101");
    expect(result.intakeDate).toBe("2026-05-13");
    expect(result.finalCardCount).toBe(14);
    expect(result.supplier).toBe("广东南模");
    expect(result.strainStandard).toBe("C57BL/6");
    expect(result.strainRaw).toBe("c57");
  });

  it("preserves server cards and receipt counts", () => {
    const result = normalizeIntakeBatch({
      finalCardCount: 4,
      confirmedCardCount: 1,
      cards: [{ id: "c1", index: 1, label: "1/4", suggestedQuantity: "5", qrId: "ABCD" }],
    });
    expect(result.cards).toHaveLength(1);
    expect(result.remainingCardCount).toBe(3);
  });

  it("reports the six required intake fields", () => {
    const result = normalizeIntakeBatch({ supplier: "购买单位", iacuc: "Z2026001", pi: "负责人" });
    expect(missingIntakeRequiredFields(result)).toEqual(["实验负责人", "房间", "接收日期"]);
  });

  it("standardizes MGI strain names from the shared alias table", async () => {
    const cases: Array<[string, string]> = [
      ["c57", "C57BL/6"],
      ["c57bl/6j", "C57BL/6J"],
      ["C57BL/6N小鼠", "C57BL/6N"],
      ["balb/c", "BALB/c"],
      ["BALB/c-nu", "BALB/c裸鼠"],
      ["CD-1（ICR）", "ICR"],
      ["昆明鼠", "KM"],
      ["nude", "裸鼠"],
      ["NOD/SCID", "NOD/SCID"],
      ["NSG小鼠", "NSG"],
      ["Rag2-/-", "Rag2-KO"],
      ["BALB/cAnN-Foxn1<nu>", "BALB/cAnN-Foxn1<nu>"],
      ["NOD.CB17-Prkdc<scid>/NcrCrl", "NOD.CB17-Prkdc<scid>/NcrCrl"],
      ["B6.Cg-Foxn1<nu>/J", "B6.Cg-Foxn1<nu>/J"],
      ["101", "101"],
      ["某新品系", ""],
    ];
    for (const [raw, expected] of cases) {
      expect(await standardizeStrain(raw)).toBe(expected);
    }
  });

  it("shortens supplier names with the shared print rules", () => {
    expect(abbreviateSupplier("上海南方模式生物科技股份有限公司")).toBe("上海南模");
    expect(abbreviateSupplier("未收录供应商")).toBe("未收录供应商");
  });
});
