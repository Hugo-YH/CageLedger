import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useIntakeRecognition } from "../hooks/useIntakeRecognition";
import { IntakeRecognitionImages } from "./IntakeRecognitionImages";

function Harness() {
  const recognition = useIntakeRecognition(() => {});
  return (
    <IntakeRecognitionImages
      images={recognition.images}
      error={recognition.error}
      evidence={{
        extractedText: "识别原文",
        warnings: ["接收日期不明确"],
        fieldSources: { quantity: "预约.png", finalCardCount: "预约.png" },
        quantityCalculation: {
          baseQuantity: 27,
          giftQuantity: 3,
          addedGiftQuantity: 3,
          actualQuantity: 30,
          formula: "27 + 3 = 30",
          status: "calculated",
          reason: "赠送属于当前明细",
        },
        sources: [
          {
            imageIndex: 1,
            kind: "husbandry",
            batchNo: "原饲养批次",
            approvedQuantity: 240,
            quantity: 24,
            maleQuantity: 12,
            femaleQuantity: 12,
          },
          {
            imageIndex: 2,
            kind: "purchase",
            batchNo: "新采购批次",
            purchaseOrderNo: "PO-123",
            quantity: 27,
            specification: "6-8周龄",
            quantityFacts: {
              lineQuantity: 27,
              lineQuantityEvidence: "明细 27 只",
              giftQuantity: 3,
              giftEvidence: "额外赠送 3 只",
              giftInclusion: "extra",
              giftScope: "current_item",
              currentDeliveryQuantity: 30,
              currentDeliveryEvidence: "本次 30 只",
              deferredQuantity: 47,
              deferredEvidence: "后续 47 只",
              purchaseNotes: "需求 77 只",
            },
          },
          { imageIndex: 3, kind: "purchase" },
        ],
      }}
      onAdd={(files) => void recognition.addFiles(files)}
      onRemove={recognition.remove}
    />
  );
}

describe("intake image controls", () => {
  it("previews selected images, retains them after invalid input and removes them", async () => {
    vi.stubGlobal(
      "matchMedia",
      vi.fn().mockReturnValue({
        matches: false,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      }),
    );
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    );
    try {
      const { rerender } = render(<Harness />);
      expect(screen.queryByText("接收日期不明确")).toBeNull();
      expect(screen.queryByText("识别依据与留档")).toBeNull();
      fireEvent.click(screen.getByRole("button", { name: /请核对识别提示/ }));
      expect(screen.getByText("接收日期不明确")).toBeTruthy();
      fireEvent.click(screen.getByText("识别依据与留档"));
      expect(screen.getByText("饲养需求（图片 1）")).toBeTruthy();
      expect(screen.getByText("可申请总数量（只）：240")).toBeTruthy();
      expect(screen.getByText("本批动物数量（只）：24")).toBeTruthy();
      expect(screen.getByText("采购信息（图片 2）")).toBeTruthy();
      expect(screen.getByText("采购单号：PO-123")).toBeTruthy();
      expect(
        within(screen.getByRole("region", { name: "饲养需求，图片 1" })).getByText("批次编号：原饲养批次"),
      ).toBeTruthy();
      expect(
        within(screen.getByRole("region", { name: "采购信息，图片 2" })).getByText("批次编号：新采购批次"),
      ).toBeTruthy();
      expect(screen.getByText("采购数量（只）：27")).toBeTruthy();
      expect(screen.getByText("规格：6-8周龄")).toBeTruthy();
      expect(screen.getByText("明细数量依据：明细 27 只")).toBeTruthy();
      expect(screen.getByText("赠送情况：额外赠送")).toBeTruthy();
      expect(screen.getByText("赠送归属：本次当前商品")).toBeTruthy();
      expect(screen.getByText("本次到货备注数量（只）：30")).toBeTruthy();
      expect(screen.getByText("后续到货备注数量（只）：47")).toBeTruthy();
      expect(screen.getByText("采购备注：需求 77 只")).toBeTruthy();
      expect(screen.getByText("计入赠送（只）：3")).toBeTruthy();
      expect(screen.getByText("实际数量（只）：30")).toBeTruthy();
      expect(screen.getByText("计算式：27 + 3 = 30")).toBeTruthy();
      expect(
        within(screen.getByRole("region", { name: "采购信息，图片 3" })).getByText("批次编号：未识别，需核对"),
      ).toBeTruthy();
      expect(screen.getAllByText(/未识别，需核对/).length).toBeGreaterThan(0);
      expect(screen.getByText("数量（只）：预约.png")).toBeTruthy();
      expect(screen.getByText("打印张数：预约.png")).toBeTruthy();
      const picker = screen.getByLabelText("预约图片文件");
      fireEvent.change(picker, { target: { files: [new File(["png"], "预约.png", { type: "image/png" })] } });
      await screen.findByRole("button", { name: "移除图片 预约.png" });
      expect(screen.getByAltText("预约.png")).toBeTruthy();
      fireEvent.change(picker, { target: { files: [new File(["bad"], "bad.svg", { type: "image/svg+xml" })] } });
      expect(screen.getByText(/最多选择 4 张 PNG/)).toBeTruthy();
      expect(screen.getByAltText("预约.png")).toBeTruthy();
      fireEvent.click(screen.getByRole("button", { name: "移除图片 预约.png" }));
      await waitFor(() => expect(screen.queryByAltText("预约.png")).toBeNull());
      rerender(
        <IntakeRecognitionImages
          images={[]}
          error=""
          onAdd={() => {}}
          onRemove={() => {}}
          evidence={{
            extractedText: "",
            warnings: [],
            fieldSources: {},
            sources: [
              { imageIndex: 1, kind: "purchase", quantityFacts: { giftInclusion: "unknown", giftScope: "unknown" } },
            ],
            quantityCalculation: {
              baseQuantity: 27,
              giftQuantity: 3,
              addedGiftQuantity: 0,
              actualQuantity: null,
              formula: "",
              status: "review_required",
              reason: "赠送归属不明确",
            },
          }}
        />,
      );
      fireEvent.click(screen.getByRole("button", { name: /请核对识别提示/ }));
      fireEvent.click(screen.getByText("识别依据与留档"));
      expect(screen.getByText("赠送情况：是否额外赠送不明确")).toBeTruthy();
      expect(screen.getByText("赠送归属：归属不明确")).toBeTruthy();
      expect(screen.getByText("计入赠送（只）：0")).toBeTruthy();
      expect(screen.getByText("实际数量（只）：未确定")).toBeTruthy();
      expect(screen.getByText("计算状态：需核对")).toBeTruthy();
    } finally {
      cleanup();
      vi.unstubAllGlobals();
    }
  });
});
