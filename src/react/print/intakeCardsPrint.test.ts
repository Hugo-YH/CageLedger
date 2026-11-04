import { describe, expect, it } from "vitest";
import type { IntakeBatch } from "../api/contracts";
import { intakeCardsPrintHtml, planIntakeCardPrint } from "./intakeCards";
import { qrCodeMatrix, qrCodeSvg } from "./qrCode";

describe("print templates", () => {
  it("excludes direct-sampling batches even if stale card data is supplied", () => {
    const batch = {
      intakePurpose: "direct_sampling",
      finalCardCount: 1,
      cards: [{ qrId: "ABCD", label: "1/1", index: 1, suggestedQuantity: "5" }],
    } as IntakeBatch;
    expect(planIntakeCardPrint([batch], []).disabledReason).toContain("直接取材");
    expect(planIntakeCardPrint([batch, { finalCardCount: 1, roomName: "8101" }], []).disabledReason).toContain(
      "直接取材",
    );
    expect(intakeCardsPrintHtml([batch], { fillBlanks: true })).toBe("");
  });

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
    expect(html).toContain(".standard-sheet{padding:2.5mm 4mm");
    expect(html).toContain("grid-template-columns:repeat(2,100mm)");
    expect(html).toContain("grid-auto-rows:40mm;gap:2mm");
    expect(html).toContain(".standard-card{position:relative;width:100mm;height:40mm");
    expect(html).toContain("width:9.5mm");
    expect(html).toContain("width:19mm;height:19mm");
    expect(html).toContain('viewBox="0 0 23 23"');
    expect(html).toContain("5/5");
    expect(html).toContain('window.addEventListener("load"');
    expect(html).not.toContain("保存后生成");
  });

  it("reorders standard-card contact fields while preserving the lower grid dimensions", () => {
    const batch = {
      id: "batch-1",
      batchNo: "（Z2026013）2026110401",
      iacuc: "Z2026013",
      supplier: "广东药康生物科技有限公司",
      strainStandard: "C57BL/6J",
      strainRaw: "原始品系",
      specification: "6–8周龄，20–25g",
      pi: "项目负责人",
      owner: "实验负责人、实验助手",
      receiverName: "接收人员姓名",
      vetPhone: "13900000000",
      intakeDate: "2026-11-04",
      endDate: "2026-12-04",
      roomName: "8101",
      quantity: 23,
      finalCardCount: 1,
      cards: [{ qrId: "ABCD", label: "1/5", index: 1, suggestedQuantity: "5" }],
    } as IntakeBatch;
    const html = intakeCardsPrintHtml([batch], {
      contactPhones: { "batch-1": "13800000001 / 13800000002", other: "13800000003" },
    });
    const document = new DOMParser().parseFromString(html, "text/html");
    const table = document.querySelector<HTMLTableElement>(".standard-card table")!;
    const rows = Array.from(table.rows);
    expect(rows.slice(0, 4).map((row) => Array.from(row.cells, (cell) => cell.textContent))).toEqual([
      ["批次号", "（Z2026013）2026110401", "供应商", "广东药康"],
      ["项目负责人", "项目负责人", "动物品系", "C57BL/6J"],
      ["实验负责人/助手", "实验负责人、实验助手", "动物规格", "6–8周龄，20–25g"],
      ["联系电话", "13800000001 / 13800000002", "接收日期", "2026.11.4"],
    ]);
    expect(table.querySelector(".batch-iacuc-highlight")?.textContent).toBe("Z2026013");
    expect(html).not.toContain(batch.vetPhone);
    expect(html).not.toContain(batch.receiverName);
    expect(html).not.toContain("13800000003");
    expect(table.querySelector(".quantity-ratio")?.textContent).toBe("5/23");
    expect(table.querySelector(".cycle")?.textContent).toBe("2026.11.4-2026.12.4");
    expect(table.querySelector(".room")?.textContent).toBe("8101");
    expect(table.querySelectorAll('[aria-label="笼卡二维码"]')).toHaveLength(1);
    const columnWidths = Array.from(table.querySelectorAll("col"), (column) => Number.parseFloat(column.style.width));
    const cellWidths = (row: HTMLTableRowElement) => {
      let column = 0;
      return Array.from(row.cells, (cell) => {
        const width = columnWidths.slice(column, column + cell.colSpan).reduce((sum, value) => sum + value, 0);
        column += cell.colSpan;
        return width;
      });
    };
    expect(rows.slice(0, 4).map(cellWidths)).toEqual(Array.from({ length: 4 }, () => [20, 30, 16, 34]));
    expect(cellWidths(rows[4])).toEqual([14, 11, 25, 31, 19]);
    expect(cellWidths(rows[5])).toEqual([14, 11, 25, 31]);
    expect(rows.slice(6).map(cellWidths)).toEqual([
      [14, 11, 25],
      [14, 11, 25],
    ]);
  });

  it("leaves absent standard-card contact and specification values blank without legacy fallbacks", () => {
    const batch = {
      id: "batch-1",
      specification: "",
      sex: "雄",
      vetPhone: "13900000000",
      finalCardCount: 1,
      cards: [{}],
    } as IntakeBatch;
    for (const contactPhones of [undefined, { other: "13800000001" }]) {
      const html = intakeCardsPrintHtml([batch], { contactPhones });
      const document = new DOMParser().parseFromString(html, "text/html");
      const rows = document.querySelector<HTMLTableElement>(".standard-card table")!.rows;
      expect(rows[2].cells[3].textContent).toBe("");
      expect(rows[3].cells[1].textContent).toBe("");
      expect(html).not.toContain(batch.vetPhone);
      expect(html).not.toContain("13800000001");
      expect(html).not.toContain("雄");
    }
  });

  it("keeps all three responsible people readable and reserves compact text for long standard-card names", () => {
    for (const names of ["张三、李四", "丁小虎、蔡要嘉、林浩添"]) {
      const batch = { pi: names, owner: names, finalCardCount: 1, cards: [{}] } as IntakeBatch;
      const document = new DOMParser().parseFromString(intakeCardsPrintHtml([batch]), "text/html");
      const rows = document.querySelector<HTMLTableElement>(".standard-card table")!.rows;
      for (const cell of [rows[1].cells[1], rows[2].cells[1]]) {
        expect(cell.textContent).toBe(names);
        expect(cell.classList.contains("value-compact")).toBe(names === "丁小虎、蔡要嘉、林浩添");
      }
    }
  });

  it("uses the name text size for a single contact and compact text for multiple phones", () => {
    for (const [owner, phone, compact] of [
      ["张三", "13800000001", false],
      ["张三", "020-12345678", false],
      ["张三、李四", "13800000001 / 13800000002", true],
      ["张三", "13800000001 / 13800000002", true],
    ] as const) {
      const batch = { id: "contact-font", owner, finalCardCount: 1, cards: [{}] } as IntakeBatch;
      const html = intakeCardsPrintHtml([batch], { contactPhones: { [batch.id]: phone } });
      const document = new DOMParser().parseFromString(html, "text/html");
      const rows = document.querySelector<HTMLTableElement>(".standard-card table")!.rows;
      expect(rows[3].cells[1].textContent).toBe(phone);
      expect(rows[3].cells[1].classList.contains("value-compact")).toBe(compact);
      if (!compact) expect(rows[3].cells[1].className).toBe(rows[2].cells[1].className);
    }
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

  it("classifies only the uniquely configured Zhujiang 8014 room as temporary", () => {
    const temporary = { roomName: "8014", finalCardCount: 5 } as IntakeBatch;
    const standard = { roomName: "8101", finalCardCount: 9 } as IntakeBatch;
    const rooms = [
      { name: "8014", facility: "zhujiang" },
      { name: "8101", facility: "zhujiang" },
    ];
    expect(planIntakeCardPrint([temporary], rooms)).toMatchObject({
      kind: "temporary",
      cardCount: 5,
      pageSize: 15,
      missing: 10,
    });
    expect(planIntakeCardPrint([standard], rooms)).toMatchObject({
      kind: "standard",
      cardCount: 9,
      pageSize: 14,
      missing: 5,
    });
    expect(planIntakeCardPrint([temporary, standard], rooms)).toMatchObject({
      kind: "mixed",
      disabledReason: "普通饲养间与临时饲养间笼卡不能混合打印，请分开选择。",
    });
  });

  it("keeps non-Zhujiang 8014 standard and blocks unresolved 8014", () => {
    const batch = { roomName: "8014", finalCardCount: 1 } as IntakeBatch;
    expect(planIntakeCardPrint([batch], [{ name: "8014", facility: "bioisland" }])).toMatchObject({
      kind: "standard",
      disabledReason: "",
    });
    expect(planIntakeCardPrint([batch], [])).toMatchObject({
      kind: "unresolved",
      disabledReason: "无法确认 8014 饲养间的设施归属，请先检查房间配置。",
    });
    expect(
      planIntakeCardPrint(
        [batch],
        [
          { name: "8014", facility: "zhujiang" },
          { name: "8014", facility: "bioisland" },
        ],
      ),
    ).toMatchObject({ kind: "unresolved" });
  });

  it("renders and pads the temporary 8014 layout to fifteen cards with the compact QR information grid", () => {
    const batch = {
      batchNo: "2026-08-26-Z2026013",
      iacuc: "Z2026013",
      supplier: "广东药康生物科技有限公司",
      strainStandard: "C57BL/6J",
      pi: "项目负责人",
      owner: "实验负责人",
      intakeDate: "2026-08-26",
      endDate: "2026-09-26",
      roomName: "8014",
      quantity: 23,
      finalCardCount: 1,
      cards: [{ qrId: "ABCD", label: "1/5", index: 1, suggestedQuantity: "" }],
    } as IntakeBatch;
    const html = intakeCardsPrintHtml([batch], { kind: "temporary", fillBlanks: true });
    expect(html.match(/<section class="temporary-card">/g)).toHaveLength(15);
    expect(html).toContain(".temporary-sheet{padding:7mm 5.5mm");
    expect(html).toContain("grid-template-columns:repeat(3,65mm)");
    expect(html).toContain("grid-auto-rows:55mm");
    expect(html).toContain(" /23");
    expect(html).toContain("2026.8.26 至 2026.9.26");
    expect(html).toContain("实验负责人");
    expect(html).not.toContain("实验负责人/助手");
    expect(html).toContain("购买单位");
    expect(html).toContain("广东药康");
    expect(html).toContain("批次编号");
    expect(html).toContain('<span class="batch-iacuc-highlight">Z2026013</span>');
    expect(html).toContain(
      ".temporary-card .temporary-batch .batch-iacuc-highlight{font-size:2.6mm;color:#b91c1c;font-weight:800}",
    );
    expect(html.match(/aria-label="笼卡二维码"/g)).toHaveLength(1);
    expect(html).toContain(
      '<table class="temporary-card-grid"><colgroup><col style="width:19mm"><col style="width:28mm"><col style="width:18mm">',
    );
    expect(html).not.toContain("实验动物信息卡");
    expect(html).not.toContain("笼号");
    expect(html).toContain('class="temporary-strain" colspan="2"');
    expect(html).toContain('class="temporary-qr-cell" rowspan="2"');
    expect(html).toContain(".temporary-card .temporary-owner-row>*,.temporary-card .temporary-pi-row>*{height:9mm}");
    expect(html).toContain(".temporary-card .temporary-owner,.temporary-card .temporary-strain{font-size:2.55mm");
    expect(html).toContain(".temporary-card{width:65mm;height:55mm;overflow:visible");
    expect(html).toContain(".temporary-card .temporary-period{font-size:2.35mm;font-weight:400");
    expect(html).toContain(".temporary-card .temporary-qr-cell svg{display:block;width:100%;height:100%;margin:0}");
    expect(html).not.toContain("<th>房间</th>");
  });

  it("uses the compact two-line treatment only for unusually long temporary-card values", () => {
    const batch = {
      owner: "实验负责人兼动物实验技术支持人员",
      strainStandard: "C57BL/6J-Tg(超长基因工程小鼠品系名称用于版式检查)",
      finalCardCount: 1,
      cards: [{}],
    } as IntakeBatch;
    const html = intakeCardsPrintHtml([batch], { kind: "temporary" });
    expect(html).toContain('class="temporary-owner temporary-compact"');
    expect(html).toContain('class="temporary-strain temporary-compact"');
  });

  it("keeps temporary-card HTML identical when standard-card print context is supplied", () => {
    const batch = {
      id: "batch-1",
      batchNo: "（Z2026013）2026110401",
      iacuc: "Z2026013",
      supplier: "广东药康生物科技有限公司",
      strainStandard: "C57BL/6J",
      pi: "项目负责人",
      owner: "实验负责人",
      specification: "6–8周龄",
      vetPhone: "13900000000",
      intakeDate: "2026-11-04",
      endDate: "2026-12-04",
      roomName: "8014",
      quantity: 23,
      finalCardCount: 1,
      cards: [{ qrId: "ABCD", label: "1/5", index: 1, suggestedQuantity: "5" }],
    } as IntakeBatch;
    expect(
      intakeCardsPrintHtml([batch], {
        kind: "temporary",
        fillBlanks: true,
        contactPhones: { "batch-1": "13800000001" },
      }),
    ).toBe(intakeCardsPrintHtml([batch], { kind: "temporary", fillBlanks: true }));
  });

  it("highlights the parenthesized IACUC code on a temporary card when the stored IACUC has changed", () => {
    const batch = {
      batchNo: "（Z2025143变更）2026081301",
      iacuc: "Z2027001",
      finalCardCount: 1,
      cards: [{}],
    } as IntakeBatch;
    expect(intakeCardsPrintHtml([batch], { kind: "temporary" })).toContain(
      '（<span class="batch-iacuc-highlight">Z2025143</span>变更）2026081301',
    );
  });

  it("pads the standard layout to fourteen cards without creating QR markup for blank cards", () => {
    const batch = {
      id: "batch-1",
      specification: "6–8周龄",
      quantity: 5,
      finalCardCount: 1,
      cards: [{ qrId: "ABCD", label: "1/1", index: 1, suggestedQuantity: "5" }],
    } as IntakeBatch;
    const html = intakeCardsPrintHtml([batch], {
      fillBlanks: true,
      contactPhones: { "batch-1": "13800000001", undefined: "13800000002" },
    });
    expect(html.match(/<section class="standard-card">/g)).toHaveLength(14);
    expect(html.match(/aria-label="笼卡二维码"/g)).toHaveLength(1);
    const document = new DOMParser().parseFromString(html, "text/html");
    const blankCards = Array.from(document.querySelectorAll(".standard-card")).slice(1);
    for (const card of blankCards) {
      expect(Array.from(card.querySelectorAll(".value,.cycle,.room,.qr-cell"), (cell) => cell.textContent)).toEqual(
        Array(13).fill(""),
      );
    }
    expect(html).not.toContain("13800000002");
  });
});
