import { describe, expect, it } from "vitest";

import {
  certificateFileError,
  certificateDifferences,
  certificateLineErrors,
  certificateSizeLimit,
  mergeCertificateReviewWarnings,
  newCertificateLine,
} from "./certificateDraft";

describe("certificate draft validation", () => {
  it("replaces repeated source comparisons with current values while preserving independent recognition concerns", () => {
    const line = {
      ...newCertificateLine("a1"),
      quantity: 100,
      certificateStrain: "C57BL/6J",
      supplier: "江苏集萃药康生物科技股份有限公司",
    };
    const comparisons = certificateDifferences([line], {
      quantity: 24,
      sex: "",
      strain: "BALB/c",
      supplier: "广东药康",
      specification: "",
    });
    const original = [
      "合格证明细合计100只，与预约预填24只不同，请核对实际接收数量",
      "合格证出售单位与预约购买单位不同或尚未识别，请对照原图核对，不以质量检测单位代替",
      "证载品系与预约标准品系有差异；两者分别保存，请对照原图核对",
      "雄性数量处有印章遮挡，请核对原件",
      "供应商名称模糊，可能为检测单位，请核对",
      "第1张合格证有待核对字段：品系、数量",
      "数量、性别、规格来自预约预填，需核对实际到货；合格证资料待补录",
    ];
    const before = [...original];
    expect(comparisons).toHaveLength(3);
    expect(mergeCertificateReviewWarnings(comparisons, [...original, ...original])).toEqual([
      ...comparisons,
      ...original.slice(3, 6),
    ]);
    expect(original).toEqual(before);
  });

  it("retains a source comparison if the editor cannot provide its corresponding current values", () => {
    const warning = "合格证出售单位与预约购买单位不同或尚未识别，请对照原图核对，不以质量检测单位代替";
    const unrelated = "证载品系为 ICR，预约标准品系为 BALB/c；请核对差异。";
    expect(mergeCertificateReviewWarnings([unrelated], [warning])).toEqual([unrelated, warning]);
  });

  it("keeps unknown quantities separate from zero and rejects both until corrected or removed", () => {
    const line = {
      ...newCertificateLine("a1"),
      certificateNo: "C1",
      certificateStrain: "ICR",
      grade: "SPF",
      supplier: "供应商",
      sex: "雄性",
    };
    const attachments = new Set(["a1"]);
    expect(line.quantity).toBeNull();
    expect(certificateLineErrors(line, attachments)).toHaveProperty("quantity");
    expect(certificateLineErrors({ ...line, quantity: 0 }, attachments)).toHaveProperty("quantity");
    expect(certificateLineErrors({ ...line, quantity: 1.5 }, attachments)).toHaveProperty("quantity");
    expect(certificateLineErrors({ ...line, quantity: 2 }, attachments)).toEqual({});
    expect(certificateLineErrors({ ...line, quantity: 2, attachmentId: "missing" }, attachments)).toHaveProperty(
      "attachmentId",
    );
  });

  it("accepts PDF and supported image originals up to 30 MiB and rejects invalid files before upload", () => {
    for (const [extension, type] of [
      ["pdf", "application/pdf"],
      ["png", "image/png"],
      ["jpg", "image/jpeg"],
      ["jpeg", "image/jpeg"],
      ["webp", "image/webp"],
    ]) {
      expect(certificateFileError(new File(["original"], `certificate.${extension}`, { type }))).toBe("");
      expect(certificateFileError(new File(["original"], `certificate.${extension}`))).toBe("");
    }
    for (const file of [
      new File(["image"], "certificate.gif", { type: "image/gif" }),
      new File(["image"], "certificate.pdf", { type: "image/png" }),
      new File(["image"], "certificate.png", { type: "application/pdf" }),
    ])
      expect(certificateFileError(file)).toContain("PDF、PNG、JPEG 或 WebP");
    expect(certificateFileError(new File([], "empty.png", { type: "image/png" }))).toContain("不能为空");
    const file = new File(["pdf"], "certificate.pdf", { type: "application/pdf" });
    Object.defineProperty(file, "size", { value: certificateSizeLimit + 1 });
    expect(certificateFileError(file)).toContain("30 MiB");
  });

  it("compares male and female detail rows with equivalent mixed-sex reservation labels", () => {
    const male = { ...newCertificateLine("a1"), sex: "雄性", quantity: 13 };
    const female = { ...male, id: "female", sex: "雌性", quantity: 8 };
    for (const sex of ["雌雄", "雌性/雄性", "雄性、雌性"]) {
      const warnings = certificateDifferences([male, female], {
        quantity: 21,
        sex,
        strain: "",
        supplier: "",
        specification: "",
      });
      expect(warnings.some((warning) => warning.includes("证载性别"))).toBe(false);
    }
    expect(
      certificateDifferences([male, female], {
        quantity: 21,
        sex: "雄性",
        strain: "",
        supplier: "",
        specification: "",
      }),
    ).toEqual(expect.arrayContaining([expect.stringContaining("证载性别")]));
  });

  it("compares supplier aliases and normalized specification without changing certificate source values", () => {
    const line = {
      ...newCertificateLine("a1"),
      quantity: 2,
      sex: "雄性",
      certificateStrain: "ICR",
      supplier: "江苏集萃",
      specification: "8 周",
      grade: "spf",
    };
    const batch = {
      quantity: 2,
      sex: "雄性",
      strain: "ICR",
      supplier: "江苏集萃药康生物科技股份有限公司",
      specification: "8周",
      grade: "SPF",
    };
    expect(certificateDifferences([line], batch)).toEqual([]);
    expect(line.supplier).toBe("江苏集萃");
    expect(line.specification).toBe("8 周");
  });

  it("flags supplier, specification and available grade differences including mistaken testing units", () => {
    const line = {
      ...newCertificateLine("a1"),
      quantity: 2,
      sex: "雄性",
      certificateStrain: "ICR",
      supplier: "广东省实验动物监测所",
      specification: "6周",
      grade: "普通级",
    };
    const batch = {
      quantity: 2,
      sex: "雄性",
      strain: "ICR",
      supplier: "广东维通利华",
      specification: "8周",
      grade: "SPF",
    };
    expect(certificateDifferences([line], batch)).toEqual(
      expect.arrayContaining([
        expect.stringContaining("证载供应商为 广东省实验动物监测所"),
        expect.stringContaining("证载规格为 6周"),
        expect.stringContaining("证载等级为 普通级"),
        expect.stringContaining("避免使用检测单位代替供应商"),
      ]),
    );
    expect(
      certificateDifferences([line], { ...batch, grade: undefined }).some((warning) => warning.includes("等级")),
    ).toBe(false);
    expect(certificateDifferences([{ ...line, supplier: "广东维通利华实验动物技术有限公司检测中心" }], batch)).toEqual(
      expect.arrayContaining([expect.stringContaining("避免使用检测单位代替供应商")]),
    );
  });
});
