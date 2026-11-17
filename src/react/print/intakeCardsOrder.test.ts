import { expect, it } from "vitest";
import type { IntakePrintBatch } from "../../contracts/intake";
import { intakeCardsPrintHtml } from "./intakeCards";

function batch(batchNo: string, roomName: string, pi: string, quantities = ["1"]): IntakePrintBatch {
  return {
    id: batchNo,
    updatedAt: "version-1",
    intakePurpose: "housing",
    status: "pending_print",
    batchNo,
    roomName,
    pi,
    owner: "实验负责人",
    iacuc: "Z2026001",
    supplier: "广东药康",
    strainStandard: "C57BL/6J",
    strainRaw: "C57BL/6J",
    intakeDate: "2026-11-18",
    endDate: "2026-12-18",
    quantity: 9,
    finalCardCount: quantities.length,
    cards: quantities.map((suggestedQuantity, index) => ({
      id: `${batchNo}-${index}`,
      qrId: `A00${index}`,
      suggestedQuantity,
    })),
  };
}

it("groups standard cards by natural room order then Chinese PI order across pages, preserving ties and cage order", () => {
  const batches = [
    batch("room10-li", "81010", "李四", Array(10).fill("1")),
    batch("room2-zhang", "8102", "张三"),
    batch("room2-li-first", " 8102 ", " 李四 ", ["5", "4"]),
    batch("room2-no-pi", "8102", ""),
    batch("room2-li-tie", "8102", "李四"),
    batch("no-room", "", "李四"),
    { ...batch("direct", "8101", "李四"), intakePurpose: "direct_sampling" as const },
  ];
  const original = structuredClone(batches);
  const document = new DOMParser().parseFromString(intakeCardsPrintHtml(batches, { fillBlanks: true }), "text/html");
  const cards = Array.from(document.querySelectorAll(".standard-card"));
  const names = cards.map((card) => card.querySelector(".standard-batch")!.textContent);
  const expected = [
    "room2-li-first",
    "room2-li-first",
    "room2-li-tie",
    "room2-zhang",
    "room2-no-pi",
    ...Array(10).fill("room10-li"),
    "no-room",
  ];
  expect(names.slice(0, expected.length)).toEqual(expected);
  expect(names.slice(expected.length)).toEqual(Array(12).fill(""));
  expect(cards.slice(0, 2).map((card) => card.querySelector(".quantity-ratio")!.textContent)).toEqual(["5/9", "4/9"]);
  expect(Array.from(document.querySelectorAll(".standard-sheet"), (page) => page.children.length)).toEqual([14, 14]);
  expect(batches).toEqual(original);
});

it("uses the same stable PI order for temporary cards and appends blank cards after all real cards", () => {
  const batches = [
    batch("zhang", "8014", "张三"),
    batch("li-first", "8014", "李四", ["5", "4"]),
    batch("li-tie", "8014", "李四"),
  ];
  const original = structuredClone(batches);
  const document = new DOMParser().parseFromString(
    intakeCardsPrintHtml(batches, { kind: "temporary", fillBlanks: true }),
    "text/html",
  );
  const cards = Array.from(document.querySelectorAll(".temporary-card"));
  expect(cards.map((card) => card.querySelector(".temporary-batch")!.textContent)).toEqual([
    "li-first",
    "li-first",
    "li-tie",
    "zhang",
    ...Array(11).fill(""),
  ]);
  expect(cards.slice(0, 2).map((card) => card.querySelectorAll("tr")[5].querySelector("td")!.textContent)).toEqual([
    "5/9",
    "4/9",
  ]);
  expect(document.querySelectorAll(".temporary-sheet")).toHaveLength(1);
  expect(batches).toEqual(original);
});
