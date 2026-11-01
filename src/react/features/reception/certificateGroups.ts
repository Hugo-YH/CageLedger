import type { ReceptionCertificateLine } from "../../../contracts/reception";

const certificateSharedTextFields = [
  "attachmentId",
  "certificateNo",
  "certificateStrain",
  "grade",
  "supplier",
  "specification",
  "notes",
  "weightRaw",
  "ageRaw",
  "experimentCertificateNo",
] as const;

export type CertificateSharedPatch = Partial<
  Pick<ReceptionCertificateLine, (typeof certificateSharedTextFields)[number] | "certificateIndex">
>;

export interface CertificateGroup {
  key: string;
  entries: { line: ReceptionCertificateLine; index: number }[];
}

export function groupCertificateLines(lines: readonly ReceptionCertificateLine[]): CertificateGroup[] {
  const groups = new Map<string, CertificateGroup>();
  lines.forEach((line, index) => {
    const sharedKey = JSON.stringify([
      line.certificateIndex,
      ...certificateSharedTextFields.map((field) => line[field]),
    ]);
    const group = groups.get(sharedKey);
    if (group) group.entries.push({ line, index });
    else groups.set(sharedKey, { key: line.id, entries: [{ line, index }] });
  });
  return [...groups.values()];
}

export function patchCertificateGroup(
  lines: readonly ReceptionCertificateLine[],
  ids: readonly string[],
  patch: CertificateSharedPatch,
): ReceptionCertificateLine[] {
  const selectedIds = new Set(ids);
  return lines.map((line) => {
    if (!selectedIds.has(line.id)) return line;
    const next = { ...line };
    for (const field of certificateSharedTextFields) {
      const value = patch[field];
      if (value !== undefined) next[field] = value;
    }
    if (patch.certificateIndex !== undefined) next.certificateIndex = patch.certificateIndex;
    return next;
  });
}

export function addCertificateSexLine(
  lines: readonly ReceptionCertificateLine[],
  ids: readonly string[],
): ReceptionCertificateLine[] {
  const selectedIds = new Set(ids);
  const entries = lines.filter((line) => selectedIds.has(line.id));
  const first = entries[0];
  if (!first) return [...lines];
  const sexes = new Set(entries.map((line) => line.sex));
  const sex = sexes.size === 1 ? (sexes.has("雄性") ? "雌性" : sexes.has("雌性") ? "雄性" : "未知") : "未知";
  const certificateLineIndex =
    lines.reduce(
      (max, line) =>
        line.attachmentId === first.attachmentId && line.certificateIndex === first.certificateIndex
          ? Math.max(max, line.certificateLineIndex)
          : max,
      0,
    ) + 1;
  return [
    ...lines,
    {
      ...first,
      id: crypto.randomUUID(),
      runId: null,
      certificateLineIndex,
      sex,
      quantity: null,
    },
  ];
}
