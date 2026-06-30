import { describe, expect, it } from "vitest";

import { normalizeIntakeBatch, parseIntakeMessage } from "./intake";

describe("intake message parser", () => {
  it("extracts the purchase and husbandry fields", () => {
    const result = parseIntakeMessage(
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
});
