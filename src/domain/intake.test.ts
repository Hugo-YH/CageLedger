import { describe, expect, it } from "vitest";
import supplierAliases from "../../server_app/resources/intake/supplier-aliases.json";

import {
  abbreviateSupplier,
  missingIntakeRequiredFields,
  normalizeIntakeBatch,
  normalizeIntakeBatchNo,
  normalizeIntakeOrderIdentifiers,
  parseIntakeMessage,
  parseIntakeOrderIdentifiers,
  speciesLabel,
  standardizeStrain,
  updateIntakeDraft,
  inferIntakePurpose,
  intakeIdentifierLimitMessage,
  canConfirmIntakeReceipt,
  normalizeIntakeSex,
  createIntakeDraft,
} from "./intake";

describe("intake purchase and order identifiers", () => {
  it.each(["01", "07"])("derives the purchase ID without losing complete order suffix %s", (suffix) => {
    const orderNo = `DC2026110229486${suffix}`;
    expect(normalizeIntakeOrderIdentifiers({ orderNo })).toEqual({ purchaseOrderNo: "C2026110229486", orderNo });
    expect(normalizeIntakeBatch({ orderNo })).toMatchObject({ purchaseOrderNo: "C2026110229486", orderNo });
    expect(normalizeIntakeOrderIdentifiers({ purchaseOrderNo: orderNo })).toEqual({
      purchaseOrderNo: "C2026110229486",
      orderNo,
    });
  });

  it("uppercases only exact known IDs and keeps explicit conflicting values for review", () => {
    expect(
      normalizeIntakeOrderIdentifiers({ purchaseOrderNo: " c2026110229486 ", orderNo: " dc202611022948607 " }),
    ).toEqual({ purchaseOrderNo: "C2026110229486", orderNo: "DC202611022948607" });
    expect(
      normalizeIntakeOrderIdentifiers({ purchaseOrderNo: "C2026000000000", orderNo: "DC202611022948607" }),
    ).toEqual({ purchaseOrderNo: "C2026000000000", orderNo: "DC202611022948607" });
    expect(
      normalizeIntakeOrderIdentifiers({ purchaseOrderNo: "DC202611022948601", orderNo: "DC202611022948607" }),
    ).toEqual({
      purchaseOrderNo: "C2026110229486",
      orderNo: "DC202611022948601、DC202611022948607",
      identifiers: {
        purchaseOrderNos: ["C2026110229486"],
        orderNos: ["DC202611022948601", "DC202611022948607"],
        batchNos: [],
      },
    });
  });

  it.each(["DC2026110229486", "DC2026110229486012", "DC2026110229486A1", "DC202611022948607-extra", "ABC 123"])(
    "does not guess or truncate unknown order format %s",
    (value) => {
      expect(normalizeIntakeOrderIdentifiers({ orderNo: value })).toEqual({ purchaseOrderNo: "", orderNo: value });
      expect(normalizeIntakeOrderIdentifiers({ purchaseOrderNo: value })).toEqual({ purchaseOrderNo: value });
    },
  );

  it("preserves non-platform explanations, raw text and the original image evidence", () => {
    expect(normalizeIntakeOrderIdentifiers({ purchaseOrderNo: " 不走锐竞 " })).toEqual({ purchaseOrderNo: "不走锐竞" });
    expect(normalizeIntakeOrderIdentifiers({})).toEqual({ purchaseOrderNo: "" });
    const rawMessage = "锐竞单号dc202611022948607，原图文字不可改写";
    const recognition = {
      extractedText: rawMessage,
      warnings: [],
      fieldSources: { purchaseOrderNo: "原图" },
      images: [
        {
          id: "img",
          name: "原图.png",
          mime: "image/png",
          size: 10,
          sha256: "hash",
          url: "/original",
          createdAt: "now",
        },
      ],
    };
    const original = { purchaseOrderNo: "dc202611022948607", rawMessage, recognition };
    const normalized = normalizeIntakeBatch(original);
    expect(normalized).toMatchObject({ purchaseOrderNo: "C2026110229486", orderNo: "DC202611022948607", rawMessage });
    expect(normalized.recognition).toBe(recognition);
    expect(original.purchaseOrderNo).toBe("dc202611022948607");
  });

  it.each([
    "采购申请单号C2026110229486\n订单编号DC202611022948607",
    "锐竞单号DC202611022948607",
    "订单编号：dc202611022948607",
    "采购单号：DC202611022948607",
  ])("parses both fields from %s", (text) => {
    const result = parseIntakeMessage(text);
    expect(result).toMatchObject({ purchaseOrderNo: "C2026110229486", orderNo: "DC202611022948607", rawMessage: text });
  });

  it("keeps an explicitly conflicting purchase ID instead of replacing it with the order-derived ID", () => {
    expect(parseIntakeMessage("采购申请单号C2026000000000\n订单编号DC202611022948607")).toMatchObject({
      purchaseOrderNo: "C2026000000000",
      orderNo: "DC202611022948607",
    });
    expect(parseIntakeMessage("订单编号DC2026110229486072")).toMatchObject({
      purchaseOrderNo: "",
      orderNo: "DC2026110229486072",
    });
  });

  it.each([
    ["锐竞订单号：C2026060147925，", "C2026060147925"],
    ["申请单号为C2026072329400，", "C2026072329400"],
    ["锐竞采购申请号：C2026092927340", "C2026092927340"],
    ["C2026050819252，", "C2026050819252"],
    ["锐竞采购申请单号为C2026100925690", "C2026100925690"],
    ["订单编号：ｃ２０２６１１０２２９４８６", "C2026110229486"],
  ])("classifies the complete C identifier itself in %s", (text, purchaseOrderNo) => {
    expect(parseIntakeMessage(text)).toMatchObject({ purchaseOrderNo, orderNo: "", rawMessage: text });
  });

  it.each(["采购申请单号：DC202611022948607", "锐竞订单号：DC202611022948607", "ｄｃ２０２６１１０２２９４８６０７，"])(
    "classifies and derives a complete DC identifier in %s",
    (text) => {
      expect(parseIntakeMessage(text)).toMatchObject({
        purchaseOrderNo: "C2026110229486",
        orderNo: "DC202611022948607",
        rawMessage: text,
      });
    },
  );

  it.each([
    "采购单号：C20261009 25690",
    "采购单号：Ｃ２０２６１００９　２５６９０",
    "C202611022948",
    "C20261102294860",
    "AC2026110229486",
    "采购单号：C2026110229486A",
    "DC20261102294860",
    "DC2026110229486072",
    "订单编号：DC202611022948607A",
    "ADC202611022948607",
    "2026110229486",
  ])("leaves unlabelled, embedded or split identifier %s in the raw text instead of truncating it", (text) => {
    expect(parseIntakeMessage(text)).toMatchObject({ purchaseOrderNo: "", orderNo: "", rawMessage: text });
  });

  it.each([
    ["采购单号：C202611022948", "C202611022948", ""],
    ["采购单号：C20261102294860", "C20261102294860", ""],
    ["采购单号：AC2026110229486", "AC2026110229486", ""],
    ["采购单号：2026110229486", "2026110229486", ""],
    ["订单编号：DC20261102294860", "", "DC20261102294860"],
    ["订单编号：DC2026110229486072", "", "DC2026110229486072"],
    ["订单编号：ADC202611022948607", "", "ADC202611022948607"],
    ["锐竞单号dc2026110229486072", "", "dc2026110229486072"],
  ])("preserves the complete labelled nonstandard identifier in %s", (text, purchaseOrderNo, orderNo) => {
    expect(parseIntakeMessage(text)).toMatchObject({ purchaseOrderNo, orderNo, rawMessage: text });
    expect(parseIntakeOrderIdentifiers(text).hasConflict).toBe(false);
  });

  it("prioritizes canonical classification over labelled nonstandard candidates", () => {
    const text = "采购单号：AC2026110229486\n订单编号：C2026110229486";
    expect(parseIntakeMessage(text)).toMatchObject({ purchaseOrderNo: "C2026110229486", orderNo: "" });
    expect(parseIntakeOrderIdentifiers(text).hasConflict).toBe(false);
  });

  it.each([
    "采购单号：C202611022948\n采购单号：C202611022949",
    "订单编号：DC2026110229486072\n订单编号：DC2026110229486073",
    "采购单号：DC2026110229486072\n订单编号：DC2026110229486073",
  ])("retains all labelled nonstandard identifiers in the same appointment in %s", (text) => {
    const result = parseIntakeOrderIdentifiers(text);
    expect(result.hasConflict).toBe(false);
    expect(result.identifiers).toBeDefined();
    expect(parseIntakeMessage(text)).toMatchObject({
      purchaseOrderNo: result.purchaseOrderNo,
      orderNo: result.orderNo,
      rawMessage: text,
    });
  });

  it("deduplicates repeated nonstandard identifiers without deriving a purchase ID", () => {
    const text = "订单编号：dc2026110229486072\n订单编号：DC2026110229486072";
    expect(parseIntakeOrderIdentifiers(text)).toEqual({
      purchaseOrderNo: "",
      orderNo: "dc2026110229486072",
      hasConflict: false,
    });
  });

  it.each([
    "采购单号：C2026110229486\n原单号：C2026100925690",
    "C2026110229486，C2026100925690，DC202611022948607",
    "订单编号：DC202611022948601\n订单编号：DC202611022948607",
    "C2026110229486，DC202611022948607，DC202610092569001",
  ])("preserves multiple complete identifiers together in %s", (text) => {
    const result = parseIntakeMessage(text);
    expect(result.identifiers).toBeDefined();
    expect(parseIntakeOrderIdentifiers(text).hasConflict).toBe(false);
    const values = [...result.identifiers!.purchaseOrderNos, ...result.identifiers!.orderNos];
    for (const number of text.match(/(?:DC\d{15}|C\d{13})/g) ?? []) expect(values).toContain(number);
    expect(result.rawMessage).toBe(text);
  });

  it("deduplicates the same identifiers after width and case normalization", () => {
    const text = "C2026110229486，ｃ２０２６１１０２２９４８６\nDC202611022948607，ｄｃ２０２６１１０２２９４８６０７";
    expect(parseIntakeMessage(text)).toMatchObject({
      purchaseOrderNo: "C2026110229486",
      orderNo: "DC202611022948607",
      rawMessage: text,
    });
  });

  it.each(["C2026100925690，DC202611022948607"])("reports an isolated C/DC mismatch in %s", (text) => {
    expect(parseIntakeOrderIdentifiers(text).hasConflict).toBe(true);
    expect(parseIntakeMessage(text)).not.toHaveProperty("hasConflict");
  });

  it.each([
    "无采购编号的预约原文",
    "C2026110229486",
    "DC202611022948607",
    "C2026110229486，DC202611022948607",
    "C2026110229486，ｃ２０２６１１０２２９４８６",
    "C2026110229486，C2026100925690",
    "DC202611022948601，DC202611022948607",
    "C2026100925690，DC202611022948607，DC202609212926501",
  ])("does not report a conflict for %s", (text) => {
    expect(parseIntakeOrderIdentifiers(text).hasConflict).toBe(false);
  });

  it("keeps the real grouped appointment's two orders and demands while counting 60 animals once", () => {
    const text =
      "订单编号：DC202609212926501、DC202609212923401\n饲养需求批次号：（Z2025034）2025090302、（Z2025034）2025090313\n数量：60只";
    expect(parseIntakeMessage(text)).toMatchObject({
      purchaseOrderNo: "C2026092129265、C2026092129234",
      orderNo: "DC202609212926501、DC202609212923401",
      batchNo: "（Z2025034）2025090302、（Z2025034）2025090313",
      identifiers: {
        purchaseOrderNos: ["C2026092129265", "C2026092129234"],
        orderNos: ["DC202609212926501", "DC202609212923401"],
        batchNos: ["（Z2025034）2025090302", "（Z2025034）2025090313"],
      },
      quantity: 60,
      iacuc: "Z2025034",
    });
  });

  it("retains cross-IACUC demand numbers without selecting an arbitrary project's IACUC", () => {
    expect(
      parseIntakeMessage("饲养需求批次号：（Z2025034）2025090302、（Z2025035）2025090313\n数量：60只"),
    ).toMatchObject({
      batchNo: "（Z2025034）2025090302、（Z2025035）2025090313",
      iacuc: "",
      quantity: 60,
    });
  });

  it("normalizes separator input and only adds collection metadata for multiple identifiers", () => {
    const item = normalizeIntakeBatch({
      purchaseOrderNo: "c2026092129265，C2026092129234;C2026092129265",
      orderNo: "DC202609212926501\nDC202609212923401",
      batchNo: "(z2025034)2025090302；（Z2025034）2025090313",
      quantity: 60,
    });
    expect(item.purchaseOrderNo).toBe("C2026092129265、C2026092129234");
    expect(item.batchNo).toBe("（Z2025034）2025090302、（Z2025034）2025090313");
    expect(item.identifiers?.orderNos).toHaveLength(2);
    expect(item.quantity).toBe(60);
    expect(normalizeIntakeBatch({ orderNo: "DC202609212926501" })).not.toHaveProperty("identifiers");
  });

  it("preserves manually entered fullwidth order text without deriving a purchase identifier", () => {
    const orderNo = "ｄｃ２０２６０９２１２９２６５０１";
    expect(normalizeIntakeOrderIdentifiers({ orderNo })).toEqual({ purchaseOrderNo: "", orderNo });
    expect(normalizeIntakeBatch({ orderNo })).toMatchObject({ purchaseOrderNo: "", orderNo });
  });

  it("keeps separator keystrokes and pasted newlines available while editing identifier lists", () => {
    let draft = normalizeIntakeBatch({});
    draft = updateIntakeDraft(draft, "orderNo", "DC202609212926501\n");
    expect(draft.orderNo).toBe("DC202609212926501\n");
    draft = updateIntakeDraft(draft, "orderNo", "DC202609212926501\nDC202609212923401");
    expect(draft.orderNo).toBe("DC202609212926501\nDC202609212923401");
    expect(draft.identifiers?.orderNos).toEqual(["DC202609212926501", "DC202609212923401"]);
    expect(normalizeIntakeBatch(draft).orderNo).toBe("DC202609212926501、DC202609212923401");
    draft = updateIntakeDraft(draft, "batchNo", "（Z2025034）2025090302、");
    expect(draft.batchNo).toBe("（Z2025034）2025090302、");
  });

  it("reads array-only identifiers but gives explicit edits and clears priority over stale arrays", () => {
    const identifiers = {
      purchaseOrderNos: ["C2026092129265", "C2026092129234"],
      orderNos: ["DC202609212926501", "DC202609212923401"],
      batchNos: ["（Z2025034）2025090302", "（Z2025034）2025090313"],
    };
    const saved = normalizeIntakeBatch({ identifiers });
    expect(saved.orderNo).toBe("DC202609212926501、DC202609212923401");
    const edited = normalizeIntakeBatch({ ...saved, orderNo: "人工订单", purchaseOrderNo: "", batchNo: "" });
    expect(edited).toMatchObject({ purchaseOrderNo: "", orderNo: "人工订单", batchNo: "" });
    expect(edited).not.toHaveProperty("identifiers");
    const clearedOrder = updateIntakeDraft(saved, "orderNo", "");
    expect(clearedOrder.orderNo).toBe("");
    expect(clearedOrder.identifiers?.orderNos).toEqual([]);
  });

  it("reports collection size and member length limits without silently truncating identifiers", () => {
    const purchaseOrderNos = Array.from({ length: 50 }, (_, index) => `manual-${index}`);
    expect(intakeIdentifierLimitMessage({ identifiers: { purchaseOrderNos } })).toBe("");
    expect(
      intakeIdentifierLimitMessage({ identifiers: { purchaseOrderNos: [...purchaseOrderNos, "extra"] } }),
    ).toContain("最多50个");
    expect(intakeIdentifierLimitMessage({ orderNo: "x".repeat(200) })).toBe("");
    expect(intakeIdentifierLimitMessage({ orderNo: "x".repeat(201) })).toContain("最多200个字符");
    expect(
      normalizeIntakeBatch({
        identifiers: { purchaseOrderNos: [...purchaseOrderNos, "extra"], orderNos: [], batchNos: [] },
      }).identifiers?.purchaseOrderNos,
    ).toHaveLength(51);
  });
});

describe("intake batch-number presentation", () => {
  it.each([
    ["(Z2025170)2026102902", "（Z2025170）2026102902"],
    ["（Z2025170）2026102902", "（Z2025170）2026102902"],
    ["(Z2025170）2026102902", "（Z2025170）2026102902"],
    ["（Z2025170)2026102902", "（Z2025170）2026102902"],
    [" ( z2025170 )  2026102902 ", "（Z2025170）2026102902"],
    ["（zw2026001）\t\u30002026102902", "（ZW2026001）2026102902"],
    ["ABC 123", "ABC 123"],
    ["ABC123", "ABC123"],
    ["( abc ) 123", "（abc） 123"],
    ["(z2025170)2026 102902", "（z2025170）2026 102902"],
    ["(Z2025170 2026102902", "(Z2025170 2026102902"],
    ["Z2025170)2026102902", "Z2025170)2026102902"],
  ])("uses the same batch-number format for %s and normalized drafts", (raw, expected) => {
    expect(normalizeIntakeBatchNo(raw)).toBe(expected);
    expect(normalizeIntakeBatch({ batchNo: raw }).batchNo).toBe(expected);
  });

  it.each([null, undefined, "", "  "])("handles an absent batch number (%s)", (value) => {
    expect(normalizeIntakeBatchNo(value)).toBe("");
  });

  it("normalizes the editable number without changing source text or stored recognition image references", () => {
    const rawMessage = "原图片预约：( z2025170 )  2026102902\n保留原始括号及空白";
    const images = [
      {
        id: "original-image",
        name: "预约.png",
        url: "/original-image",
        mime: "image/png",
        size: 10,
        sha256: "hash",
        createdAt: "now",
      },
    ];
    const recognition = { extractedText: rawMessage, warnings: [], fieldSources: { batchNo: "原图" }, images };
    const original = { batchNo: "( z2025170 )  2026102902", rawMessage, recognition };
    const normalized = normalizeIntakeBatch(original);
    expect(normalized.batchNo).toBe("（Z2025170）2026102902");
    expect(normalized.rawMessage).toBe(rawMessage);
    expect(normalized.recognition).toBe(recognition);
    expect(normalized.recognition?.images).toBe(images);
    expect(original.batchNo).toBe("( z2025170 )  2026102902");
    expect(normalizeIntakeBatchNo("ABC 123")).not.toBe(normalizeIntakeBatchNo("ABC123"));
  });
});

describe("intake message parser", () => {
  it("resolves every maintained supplier name and alias from the shared catalog", () => {
    const seen = new Map<string, string>();
    for (const entry of supplierAliases.entries) {
      for (const name of [entry.shortName, ...entry.companyNames, ...entry.aliases, ...entry.exactAliases]) {
        expect(abbreviateSupplier(name), name).toBe(entry.shortName);
        const key = name
          .normalize("NFKC")
          .replace(/[\s()（）·\-—_]/g, "")
          .toLowerCase();
        expect(seen.get(key) ?? entry.shortName, name).toBe(entry.shortName);
        seen.set(key, entry.shortName);
      }
      if (entry.origin === "verified") {
        expect(entry.companyNames.length).toBeGreaterThan(0);
        expect(entry.sources.length).toBeGreaterThan(0);
      }
    }
  });

  it.each([
    ["斯贝福（北京）生物技术有限公司", "北京斯贝福"],
    [" 斯贝福 ( 北京 ) 生物技术有限公司 ", "北京斯贝福"],
    ["北京维通利华实验动物技术有限公司湖北分公司", "湖北维通利华"],
    ["湖南斯莱克景达实验动物有限公司", "湖南斯莱克景达"],
    ["百奥赛图江苏基因生物技术有限公司", "江苏百奥赛图"],
    ["百奥赛图（上海）医药科技有限公司", "上海百奥赛图"],
    ["深圳百奥赛图生物科技有限公司", "深圳百奥赛图生物科技有限公司"],
    ["武汉斯莱克生物科技有限公司", "武汉斯莱克生物科技有限公司"],
    ["北京维通利华实验动物技术有限公司南京分公司", "北京维通利华实验动物技术有限公司南京分公司"],
    ["广东明珠集团股份有限公司", "广东明珠集团股份有限公司"],
  ])("preserves supplier region while normalizing %s", (raw, expected) => {
    expect(abbreviateSupplier(raw)).toBe(expected);
    expect(parseIntakeMessage(`供应商：${raw}\n品系：C57\n数量：10`).supplier).toBe(expected);
  });

  it.each([
    ["雌性", "雌性"],
    ["母鼠", "雌性"],
    ["female", "雌性"],
    ["F", "雌性"],
    ["♀", "雌性"],
    ["雄性", "雄性"],
    ["公鼠", "雄性"],
    ["male", "雄性"],
    ["M", "雄性"],
    ["♂", "雄性"],
    ["雌性/雄性", "雌性/雄性"],
    ["雌雄各半", "雌性/雄性"],
    ["公母混合", "雌性/雄性"],
    ["female/male", "雌性/雄性"],
    ["", "雌性/雄性"],
    ["未知", "雌性/雄性"],
    [null, "雌性/雄性"],
  ])("normalizes sex %s to the three-option field", (input, expected) => {
    expect(normalizeIntakeSex(input)).toBe(expected);
    expect(normalizeIntakeBatch({ sex: input ?? "" }).sex).toBe(expected);
  });

  it("defaults new and unrecognized reservations to both sexes without reading adjacent fields", () => {
    expect(createIntakeDraft().sex).toBe("雌性/雄性");
    expect(parseIntakeMessage("数量：10，接收日期：2026-10-22").sex).toBe("雌性/雄性");
    expect(parseIntakeMessage("性别：雌性 供应商：某某公司 数量：10").sex).toBe("雌性");
    expect(parseIntakeMessage("性别：公母各半 数量：10").sex).toBe("雌性/雄性");
  });

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
    expect(result.supplier).toBe("广东南模");
    expect(result.strainStandard).toBe("C57BL/6J");
    expect(result.strainRaw).toBe("c57");
  });

  it("preserves an optional specification without adding it to legacy drafts", () => {
    expect(normalizeIntakeBatch({})).not.toHaveProperty("specification");
    expect(normalizeIntakeBatch({ specification: " 6–8个月 " }).specification).toBe("6–8个月");
    expect(updateIntakeDraft(normalizeIntakeBatch({}), "specification", "2–6月").specification).toBe("2–6月");
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

  it("allows saving a pending date while retaining the current form print requirements", () => {
    const result = normalizeIntakeBatch({ supplier: "购买单位", iacuc: "Z2026001", pi: "负责人" });
    expect(missingIntakeRequiredFields(result)).toEqual(["实验负责人", "房间"]);
    const ready = { ...result, owner: "实验负责人", roomName: "8101" };
    expect(missingIntakeRequiredFields(ready)).toEqual([]);
    expect(missingIntakeRequiredFields(ready, { forPrint: true })).toEqual(["接收日期"]);
    expect(missingIntakeRequiredFields({ ...ready, intakeDate: "2026-10-28" }, { forPrint: true })).toEqual([]);
  });

  it("standardizes common facility aliases without loading the full MGI index", () => {
    const cases: Array<[string, string]> = [
      ["c57", "C57BL/6J"],
      ["c57bl/6j", "C57BL/6J"],
      ["C57/B6J", "C57BL/6J"],
      ["C57BL/6JGpt", "C57BL/6J"],
      ["c57bl/6jGpt，3w", "C57BL/6J"],
      ["3w", "C57BL/6J"],
      ["c57小鼠", "C57BL/6J"],
      ["c57bl/6小鼠", "C57BL/6"],
      ["转基因小鼠", "基因工程小鼠"],
      ["基因鼠", "基因工程小鼠"],
      ["c57基因小鼠", "基因工程小鼠"],
      ["基因工程小鼠", "基因工程小鼠"],
      ["C57BL/6N小鼠", "C57BL/6N"],
      ["balb/c", "BALB/c"],
      ["BALB/c-nu", "BALB/c裸鼠"],
      ["CD-1（ICR）", "ICR"],
      ["昆明鼠", "KM"],
      ["nude", "裸鼠"],
      ["NOD/SCID", "NOD/SCID"],
      ["NSG小鼠", "NSG"],
      ["Rag2-/-", "Rag2-KO"],
      ["某新品系", ""],
    ];
    for (const [raw, expected] of cases) {
      expect(standardizeStrain(raw)).toBe(expected);
    }
  });

  it("shortens supplier names with the shared print rules", () => {
    expect(abbreviateSupplier("上海南方模式生物科技股份有限公司")).toBe("上海南模");
    expect(abbreviateSupplier("广东维通利华实验动物技术有限公司")).toBe("广东维通利华");
    expect(abbreviateSupplier("广东维通利华")).toBe("广东维通利华");
    expect(abbreviateSupplier("广东维通利")).toBe("广东维通利华");
    expect(parseIntakeMessage("供应商：广东维通利华实验动物技术有限公司 品系：C57 数量：10").supplier).toBe(
      "广东维通利华",
    );
    expect(abbreviateSupplier("未收录供应商")).toBe("未收录供应商");
  });

  it("shows stored species codes as Chinese business labels", () => {
    expect(speciesLabel("mouse")).toBe("小鼠");
    expect(speciesLabel("rat")).toBe("大鼠");
  });
});

describe("direct-sampling intake", () => {
  it.each(["到货直接取材", "接收后立即取材，无需饲养", "本批动物不需要饲养"])("recognizes explicit use: %s", (text) => {
    expect(inferIntakePurpose(text)).toBe("direct_sampling");
    expect(parseIntakeMessage(text).intakePurpose).toBe("direct_sampling");
  });

  it.each([
    "预约进驻饲养",
    "饲养两周后取材",
    "饲养30天后直接取材",
    "先饲养两周再直接取材",
    "不是直接取材",
    "不直接取材",
    "不要直接取材",
    "不是到货直接取材",
    "尚未确定用途",
  ])("keeps housing for %s", (text) => {
    expect(inferIntakePurpose(text)).toBe("housing");
  });

  it("does not require a room or create printable cards for direct sampling", () => {
    const direct = normalizeIntakeBatch({
      intakePurpose: "direct_sampling",
      supplier: "供应商",
      iacuc: "Z2026001",
      pi: "负责人",
      owner: "实验负责人",
      intakeDate: "2026-10-21",
      quantity: 10,
      roomName: "8101",
      husbandryDays: 30,
      finalCardCount: 2,
      cards: [{ id: "card", index: 1, label: "1", qrId: "ABCD", suggestedQuantity: "5" }],
    });
    expect(direct).toMatchObject({
      status: "pending_receipt",
      roomName: "",
      husbandryDays: null,
      endDate: "",
      finalCardCount: 0,
      suggestedCardCount: 0,
      cards: [],
    });
    expect(missingIntakeRequiredFields(direct)).toEqual([]);
    expect(missingIntakeRequiredFields({ ...direct, quantity: 0 })).toContain("数量（只）");
    expect(canConfirmIntakeReceipt(direct)).toBe(true);
    expect(canConfirmIntakeReceipt({ ...direct, status: "received" })).toBe(false);
  });

  it("keeps old batches housing and allows only unprinted drafts to change purpose", () => {
    const housing = normalizeIntakeBatch({ quantity: 10, finalCardCount: 2, roomName: "8101" });
    expect(housing.intakePurpose).toBe("housing");
    const direct = updateIntakeDraft(housing, "intakePurpose", "direct_sampling");
    const restored = updateIntakeDraft(direct, "intakePurpose", "housing");
    expect(restored).toMatchObject({ intakePurpose: "housing", status: "pending_print", finalCardCount: 2 });
    for (const status of ["printed", "received"] as const) {
      expect(updateIntakeDraft({ ...housing, status }, "intakePurpose", "direct_sampling").intakePurpose).toBe(
        "housing",
      );
    }
    expect(canConfirmIntakeReceipt(housing)).toBe(false);
    expect(canConfirmIntakeReceipt({ ...housing, status: "printed" })).toBe(true);
  });
});

describe("intake husbandry dates", () => {
  it.each([
    ["2026-10-21", 30, "2026-11-20"],
    ["2026-01-31", 30, "2026-03-02"],
    ["2026-12-31", 1, "2027-01-01"],
    ["2028-02-28", 1, "2028-02-29"],
    ["2026-02-28", 1, "2026-03-01"],
    ["2026-03-07", 2, "2026-03-09"],
    ["2026-10-21", 0, "2026-10-21"],
  ])("calculates both directions for %s + %i days", (intakeDate, husbandryDays, endDate) => {
    expect(normalizeIntakeBatch({ intakeDate, husbandryDays }).endDate).toBe(endDate);
    expect(normalizeIntakeBatch({ intakeDate, endDate }).husbandryDays).toBe(husbandryDays);
  });

  it("recalculates through sequential typing and later edits", () => {
    let draft = normalizeIntakeBatch({ intakeDate: "2026-10-21", batchNo: "KEEP-BATCH" });
    draft = updateIntakeDraft(draft, "husbandryDays", 3);
    expect(draft.endDate).toBe("2026-10-24");
    draft = updateIntakeDraft(draft, "husbandryDays", 30);
    expect(draft.endDate).toBe("2026-11-20");
    draft = updateIntakeDraft(draft, "intakeDate", "2026-10-25");
    expect(draft.endDate).toBe("2026-11-24");
    draft = updateIntakeDraft(draft, "endDate", "2026-12-01");
    expect(draft.husbandryDays).toBe(37);
    expect(draft.batchNo).toBe("KEEP-BATCH");
  });

  it("supports entering the end date or period before the intake date", () => {
    const endFirst = normalizeIntakeBatch({ endDate: "2026-11-20" });
    expect(updateIntakeDraft(endFirst, "intakeDate", "2026-10-21").husbandryDays).toBe(30);
    const daysFirst = normalizeIntakeBatch({ husbandryDays: 30 });
    expect(updateIntakeDraft(daysFirst, "intakeDate", "2026-10-21").endDate).toBe("2026-11-20");
  });

  it("keeps cleared fields empty instead of restoring their old derived values", () => {
    const initial = normalizeIntakeBatch({ intakeDate: "2026-10-21", husbandryDays: 30 });
    for (const cleared of [
      updateIntakeDraft(initial, "endDate", ""),
      updateIntakeDraft(initial, "husbandryDays", null),
    ]) {
      expect(cleared.endDate).toBe("");
      expect(cleared.husbandryDays).toBeNull();
      expect(updateIntakeDraft(cleared, "supplier", "新供应商").endDate).toBe("");
    }
    const clearedStart = updateIntakeDraft(initial, "intakeDate", "");
    expect(clearedStart.endDate).toBe("");
    expect(clearedStart.husbandryDays).toBe(30);
    expect(updateIntakeDraft(clearedStart, "intakeDate", "2026-12-01").endDate).toBe("2026-12-31");
  });

  it("does not invent dates for missing or invalid inputs or negative periods", () => {
    for (const days of [null, -1, 1.5, 10_000_000, Number.MAX_VALUE]) {
      expect(normalizeIntakeBatch({ intakeDate: "2026-10-21", husbandryDays: days }).endDate).toBe("");
    }
    expect(normalizeIntakeBatch({ intakeDate: "2026-02-30", husbandryDays: 30 }).endDate).toBe("");
    expect(normalizeIntakeBatch({ endDate: "2026-11-20", husbandryDays: 30 }).intakeDate).toBe("");
    const reversed = updateIntakeDraft(
      normalizeIntakeBatch({ intakeDate: "2026-10-21", husbandryDays: 30 }),
      "endDate",
      "2026-10-20",
    );
    expect(reversed.endDate).toBe("2026-10-20");
    expect(reversed.husbandryDays).toBeNull();
  });

  it("preserves existing explicit values when unrelated batch fields change", () => {
    const stored = normalizeIntakeBatch({ intakeDate: "2026-10-21", endDate: "2026-11-20", husbandryDays: 10 });
    const edited = updateIntakeDraft(stored, "supplier", "新供应商");
    expect(edited.endDate).toBe(stored.endDate);
    expect(edited.husbandryDays).toBe(stored.husbandryDays);
  });

  it.each([
    ["2026-10-26", "2026-11-26", 31],
    ["2026-01-31", "2026-02-28", 28],
    ["2024-01-31", "2024-02-29", 29],
    ["2026-04-15", "2026-05-15", 30],
    ["2026-12-31", "2027-01-31", 31],
    ["2099-12-31", "2100-01-31", 31],
  ])("uses an actual calendar month from %s", (intakeDate, endDate, husbandryDays) => {
    const batch = normalizeIntakeBatch({ intakeDate, husbandryMonths: 1 });
    expect(batch.endDate).toBe(endDate);
    expect(batch.husbandryDays).toBe(husbandryDays);
    expect(batch.husbandryMonths).toBe(1);
  });

  it("retains a recognized month until the intake date is filled, and recalculates date edits", () => {
    const parsed = parseIntakeMessage("饲养周期:1个月");
    expect(parsed.husbandryMonths).toBe(1);
    expect(parsed.endDate).toBe("");
    expect(parsed.husbandryDays).toBeNull();
    const october = updateIntakeDraft(parsed, "intakeDate", "2026-10-26");
    expect([october.endDate, october.husbandryDays]).toEqual(["2026-11-26", 31]);
    const january = updateIntakeDraft(october, "intakeDate", "2026-01-31");
    expect([january.endDate, january.husbandryDays]).toEqual(["2026-02-28", 28]);
    const cleared = updateIntakeDraft(january, "intakeDate", "");
    expect([cleared.husbandryMonths, cleared.endDate, cleared.husbandryDays]).toEqual([1, "", null]);
    expect(parseIntakeMessage("体重/日龄:1个月").husbandryMonths).toBeUndefined();
  });

  it("parses text-only calendar-month periods with optional punctuation", () => {
    const dated = parseIntakeMessage("接收日期：2026-10-26\n饲养周期1月");
    expect([dated.intakeDate, dated.husbandryMonths, dated.husbandryDays, dated.endDate]).toEqual([
      "2026-10-26",
      1,
      31,
      "2026-11-26",
    ]);

    const chineseMonth = parseIntakeMessage("接收日期：2026-10-26\n饲养周期一个月");
    expect([chineseMonth.husbandryMonths, chineseMonth.husbandryDays, chineseMonth.endDate]).toEqual([
      1,
      31,
      "2026-11-26",
    ]);

    const missingDate = parseIntakeMessage("饲养周期1月");
    expect([missingDate.husbandryMonths, missingDate.husbandryDays, missingDate.endDate]).toEqual([1, null, ""]);
    const october = updateIntakeDraft(missingDate, "intakeDate", "2026-10-26");
    expect([october.husbandryDays, october.endDate]).toEqual([31, "2026-11-26"]);
    const january = updateIntakeDraft(october, "intakeDate", "2026-01-31");
    expect([january.husbandryDays, january.endDate]).toEqual([28, "2026-02-28"]);

    expect(parseIntakeMessage("动物月龄：1月").husbandryMonths).toBeUndefined();
  });

  it("manual days or end date replaces calendar-month intent", () => {
    const original = normalizeIntakeBatch({ intakeDate: "2026-10-26", husbandryMonths: 1 });
    const days = updateIntakeDraft(original, "husbandryDays", 20);
    expect([days.husbandryMonths, days.endDate]).toEqual([null, "2026-11-15"]);
    expect(updateIntakeDraft(days, "intakeDate", "2026-01-31").endDate).toBe("2026-02-20");
    const end = updateIntakeDraft(original, "endDate", "2026-11-20");
    expect([end.husbandryMonths, end.husbandryDays]).toEqual([null, 25]);
    const clear = updateIntakeDraft(original, "husbandryDays", null);
    expect([clear.husbandryMonths, clear.husbandryDays, clear.endDate]).toEqual([null, null, ""]);
    expect(normalizeIntakeBatch({ intakePurpose: "direct_sampling", husbandryMonths: 1 }).husbandryMonths).toBeNull();
  });
});

it("recognizes an explicit delivery date when supplementing an image reservation", () => {
  for (const label of ["送货日期", "预约送货日期", "送达日期", "收货日期"])
    expect(parseIntakeMessage(`${label}：2026-11-06`, "录入人", []).intakeDate).toBe("2026-11-06");
});

it("recognizes both identifiers and the date in the approved procurement notice", () => {
  const text =
    "经审核采购申请单号为C2026110229486，饲养需求批次号为(Z2025170) 2026102902\n" +
    "供应商：广东药康\n品系：C57\n数量：6\n饲养房间：8101\n进驻日期： 2026-11-11";
  expect(parseIntakeMessage(text, "接收人员", ["8101"])).toMatchObject({
    purchaseOrderNo: "C2026110229486",
    batchNo: "（Z2025170）2026102902",
    quantity: 6,
    roomName: "8101",
    intakeDate: "2026-11-11",
  });
});

it.each(["采购单号：C2026110229486", "采购申请单号为C2026110229486", "采购订单编号：C2026110229486"])(
  "recognizes %s without requiring a platform name",
  (text) => {
    expect(parseIntakeMessage(text).purchaseOrderNo).toBe("C2026110229486");
  },
);

it.each(["采购申请日期：2026-11-02", "采购单号：不走锐竞", "饲养需求批次号为(Z2025170)2026102902"])(
  "does not turn %s into a purchase order number",
  (text) => {
    expect(parseIntakeMessage(text).purchaseOrderNo).toBe("");
  },
);

it("does not use demand approval year to infer a receipt year", () => {
  const year = new Date().getFullYear();
  const item = parseIntakeMessage("饲养需求批次号：（Z2000137）2000101406\n接收日期：11月3日");
  expect(item.intakeDate).toBe(`${year}-11-03`);
  expect(parseIntakeMessage("饲养需求批次号：（Z2000137）2000101406").intakeDate).toBe("");
});
