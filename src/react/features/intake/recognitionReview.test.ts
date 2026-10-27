import { describe, expect, it } from "vitest";
import type { IntakeRecognitionEvidence } from "../../../contracts/intake";
import { buildRecognitionReview } from "./recognitionReview";

const evidence: IntakeRecognitionEvidence = {
  extractedText: "",
  fieldSources: {},
  warnings: [
    "动物品系差异：饲养需求为“C57”，采购信息为“ICR”，已采用采购信息。",
    "体重/日龄（规格）差异：饲养需求为“8周龄”，采购信息为“6周龄”，已采用采购信息。",
    "本批数量差异：饲养需求为77只，本次采购实际数量为30只，已按采购信息回填；需求可能包含后续批次，请核对笼数及性别适用范围。",
  ],
  sources: [
    { imageIndex: 1, kind: "husbandry", strainRaw: "C57", specification: "8周龄", quantity: 77 },
    {
      imageIndex: 2,
      kind: "purchase",
      productName: "ICR",
      specification: "6周龄",
      quantity: 27,
      quantityFacts: { giftQuantity: 3 },
    },
  ],
  quantityCalculation: {
    baseQuantity: 27,
    giftQuantity: 3,
    addedGiftQuantity: 3,
    actualQuantity: 30,
    formula: "27 + 3 = 30",
    status: "calculated",
    reason: "",
  },
};

describe("buildRecognitionReview", () => {
  it("groups reported conflicts and preserves the original quantity and additional review instruction", () => {
    const result = buildRecognitionReview(evidence);
    expect(result.comparisons.map((row) => row.key)).toEqual(["strain", "specification", "quantity"]);
    expect(result.comparisons[2]).toMatchObject({ husbandry: "77 只", purchase: "27 只（赠送 3 只）；本次实际 30 只" });
    expect(result.reminders).toEqual(["需求可能包含后续批次，请核对笼数及性别适用范围。"]);
  });
  it("does not infer conflicts from different values without a warning", () => {
    expect(
      buildRecognitionReview({
        ...evidence,
        warnings: [],
        sources: [
          { imageIndex: 1, kind: "husbandry", strainRaw: "ICR" },
          { imageIndex: 2, kind: "purchase", productName: "ICR小鼠" },
        ],
      }).comparisons,
    ).toEqual([]);
  });
  it("keeps all same-kind image values and merges repeated field warnings", () => {
    const result = buildRecognitionReview({
      ...evidence,
      warnings: [evidence.warnings[0], "品系不一致，请核对。", "同类图片中的品系信息不一致，请核对原图。"],
      sources: [...evidence.sources!, { imageIndex: 3, kind: "purchase", strainRaw: "BALB/c" }],
    });
    expect(result.comparisons).toHaveLength(1);
    expect(result.comparisons[0].purchase).toBe("图片 2：ICR；图片 3：BALB/c");
    expect(result.reminders).toContain("同类图片中的品系信息不一致，请核对原图。");
  });
  it("keeps warnings when either source value is missing and deduplicates identical reminders", () => {
    const warning = "供应商差异，请核对。";
    const result = buildRecognitionReview({
      ...evidence,
      warnings: [warning, warning, "缺少接收日期"],
      sources: [
        { imageIndex: 1, kind: "husbandry", supplier: "甲" },
        { imageIndex: 2, kind: "purchase" },
      ],
    });
    expect(result.comparisons).toEqual([]);
    expect(result.reminders).toEqual([warning, "缺少接收日期"]);
  });
  it("does not group a one-sided sex or same-kind warning", () => {
    const warnings = [
      "饲养需求雌雄数量合计与采购数量不一致，请核对性别分配。",
      "同类图片中的数量信息不一致，请核对原图。",
    ];
    expect(buildRecognitionReview({ ...evidence, warnings })).toEqual({ comparisons: [], reminders: warnings });
  });
  it("keeps additional split or correction instructions when grouping a comparison", () => {
    const result = buildRecognitionReview({ ...evidence, warnings: ["品系不一致，请拆分不同批次后重新识别。"] });
    expect(result.comparisons).toHaveLength(1);
    expect(result.reminders).toEqual(["请拆分不同批次后重新识别。"]);
    expect(evidence.warnings).toHaveLength(3);
    const withSemicolon = buildRecognitionReview({
      ...evidence,
      warnings: ["品系不一致，请拆分不同批次；重新识别后核对。"],
    });
    expect(withSemicolon.reminders).toEqual(["请拆分不同批次；重新识别后核对。"]);
  });
});
