import type {
  ReceptionCertificateLine,
  ReceptionRecognitionRun,
  ReceptionRecord,
  ReceptionRegistrationResponse,
} from "../../../contracts/reception";
import { abbreviateSupplier } from "../../../domain/intake";

export const certificateSizeLimit = 30 * 1024 * 1024;
export const certificateSexOptions = ["雄性", "雌性", "雌雄", "未知"];

export function certificateErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error && error.message ? error.message : fallback;
}

export function certificateFileError(file: File) {
  if (!/\.pdf$/i.test(file.name) || (file.type && file.type !== "application/pdf")) return "请选择 PDF 合格证原件。";
  if (file.size > certificateSizeLimit) return "PDF 原件不能超过 30 MiB。";
  if (!file.size) return "PDF 原件不能为空。";
  return "";
}

export function newCertificateLine(attachmentId: string, certificateIndex = 1, grade = ""): ReceptionCertificateLine {
  return {
    id: crypto.randomUUID(),
    attachmentId,
    runId: null,
    certificateIndex,
    certificateLineIndex: 1,
    certificateNo: "",
    certificateStrain: "",
    grade,
    supplier: "",
    sex: "未知",
    quantity: null,
    weightRaw: "",
    ageRaw: "",
    specification: "",
    receiptId: null,
    experimentCertificateNo: "",
    notes: "",
  };
}

export function certificateLineErrors(line: ReceptionCertificateLine, attachmentIds: Set<string>) {
  const errors: Partial<Record<keyof ReceptionCertificateLine, string>> = {};
  for (const [key, label] of [
    ["certificateNo", "合格证编号"],
    ["certificateStrain", "证载品系"],
    ["grade", "等级"],
    ["supplier", "供应商"],
  ] as const) {
    if (!line[key].trim()) errors[key] = `请填写${label}`;
  }
  if (!attachmentIds.has(line.attachmentId)) errors.attachmentId = "请选择已上传的合格证原件";
  if (!certificateSexOptions.includes(line.sex)) errors.sex = "请选择证载性别";
  if (line.quantity == null || !Number.isSafeInteger(line.quantity) || line.quantity <= 0)
    errors.quantity = "数量须为正整数；未知数量请核对原图后填写，0 行请删除";
  if (!Number.isSafeInteger(line.certificateIndex) || line.certificateIndex < 1)
    errors.certificateIndex = "证件序号须为正整数";
  if (!Number.isSafeInteger(line.certificateLineIndex) || line.certificateLineIndex < 1)
    errors.certificateLineIndex = "证内行号须为正整数";
  return errors;
}

export function certificateDifferences(
  lines: ReceptionCertificateLine[],
  batch: Pick<ReceptionRecord, "quantity" | "sex" | "strain" | "supplier" | "specification" | "grade">,
) {
  if (!lines.length) return [];
  const warnings: string[] = [];
  if (batch.quantity != null && lines.every((line) => line.quantity != null)) {
    const total = lines.reduce((sum, line) => sum + (line.quantity ?? 0), 0);
    if (total !== batch.quantity) warnings.push(`证载明细数量合计 ${total}，预约预填数量 ${batch.quantity}。`);
  }
  const sexes = [...new Set(lines.map((line) => line.sex).filter(Boolean))];
  const sexParts = (value: string) => {
    const parts = [value.includes("雄") ? "雄性" : "", value.includes("雌") ? "雌性" : ""].filter(Boolean);
    return parts.length ? parts : [value];
  };
  const actualSexes = new Set(sexes.flatMap(sexParts));
  const expectedSexes = new Set(sexParts(batch.sex || ""));
  if (batch.sex && (actualSexes.size !== expectedSexes.size || [...actualSexes].some((sex) => !expectedSexes.has(sex))))
    warnings.push(`证载性别为 ${sexes.join("、") || "未填写"}，预约预填性别为 ${batch.sex}。`);
  const strains = [...new Set(lines.map((line) => line.certificateStrain).filter(Boolean))];
  if (batch.strain && strains.some((strain) => strain !== batch.strain))
    warnings.push(`证载品系为 ${strains.join("、")}，预约标准品系为 ${batch.strain}；请核对差异。`);
  const comparable = (value: string) => value.normalize("NFKC").replace(/\s+/g, "").toLowerCase();
  for (const [key, label] of [
    ["supplier", "供应商"],
    ["specification", "规格"],
    ["grade", "等级"],
  ] as const) {
    const expected = batch[key]?.trim();
    if (!expected) continue;
    const values = [...new Set(lines.map((line) => line[key].trim()))];
    const normalize = (value: string) => comparable(key === "supplier" ? abbreviateSupplier(value) : value);
    if (values.some((value) => normalize(value) !== normalize(expected)))
      warnings.push(
        `证载${label}为 ${values.map((value) => value || "未填写").join("、")}，预约预填${label}为 ${expected}；请核对差异。`,
      );
  }
  const testingSuppliers = [
    ...new Set(lines.map((line) => line.supplier.trim()).filter((value) => /检测|检验|监测|质检/.test(value))),
  ];
  if (testingSuppliers.length)
    warnings.push(
      `供应商字段出现检测或监测单位信息：${testingSuppliers.join("、")}；请核对合格证出售单位，避免使用检测单位代替供应商。`,
    );
  return warnings;
}

export function mergeCertificateReviewWarnings(differences: string[], archivedWarnings: string[]) {
  const alternatives = new Map([
    ["合格证出售单位与预约购买单位不同或尚未识别，请对照原图核对，不以质量检测单位代替", "证载供应商为 "],
    ["证载品系与预约标准品系有差异；两者分别保存，请对照原图核对", "证载品系为 "],
  ]);
  return [
    ...new Set([
      ...differences,
      ...archivedWarnings.filter((warning) => {
        if (warning.startsWith("数量、性别、规格来自预约预填")) return false;
        const prefix =
          alternatives.get(warning) ??
          (/^合格证明细合计\d+只，与预约预填\d+只不同，请核对实际接收数量$/.test(warning)
            ? "证载明细数量合计 "
            : undefined);
        // Replace only known duplicate comparisons, retaining all independent OCR concerns.
        return !prefix || !differences.some((difference) => difference.startsWith(prefix));
      }),
    ]),
  ];
}

export function hasStaleCertificateSource(
  detail: ReceptionRegistrationResponse | null,
  snapshot: ReceptionRegistrationResponse | null,
  lines: ReceptionCertificateLine[],
  pendingRun: ReceptionRecognitionRun | null,
) {
  if (!detail) return false;
  const version = detail.batch.updatedAt;
  if (
    [snapshot?.registration, detail.registration].some(
      (registration) => registration && registration.sourceBatchUpdatedAt !== version,
    )
  )
    return true;
  const usedRunIds = new Set([
    ...lines.flatMap((line) => (line.runId ? [line.runId] : [])),
    ...(pendingRun ? [pendingRun.id] : []),
  ]);
  return [...(snapshot?.runs ?? []), ...detail.runs, ...(pendingRun ? [pendingRun] : [])].some(
    (run) => usedRunIds.has(run.id) && run.sourceBatchUpdatedAt !== version,
  );
}
