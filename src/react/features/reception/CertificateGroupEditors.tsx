import type { ReceptionCertificateLine } from "../../../contracts/reception";
import { CertificateLineEditor } from "./CertificateLineEditor";
import { addCertificateSexLine, groupCertificateLines, patchCertificateGroup } from "./certificateGroups";

export function CertificateGroupEditors({
  lines,
  attachments,
  receipts,
  errors,
  readOnly,
  onChange,
}: {
  lines: ReceptionCertificateLine[];
  attachments: Array<{ value: string; label: string }>;
  receipts: Array<{ id: string; actualReceiptDate: string }>;
  errors: Partial<Record<keyof ReceptionCertificateLine, string>>[];
  readOnly: boolean;
  onChange: (lines: ReceptionCertificateLine[]) => void;
}) {
  return groupCertificateLines(lines).map((group, groupIndex) => {
    const ids = group.entries.map(({ line }) => line.id);
    return (
      <CertificateLineEditor
        key={group.key}
        entries={group.entries.map((entry) => ({ ...entry, errors: errors[entry.index] ?? {} }))}
        groupIndex={groupIndex}
        attachments={attachments}
        receipts={receipts}
        readOnly={readOnly}
        onSharedChange={(patch) => {
          const next = patchCertificateGroup(lines, ids, patch);
          onChange(
            patch.attachmentId !== undefined
              ? next.map((line) => (ids.includes(line.id) ? { ...line, runId: null } : line))
              : next,
          );
        }}
        onLineChange={(next) => onChange(lines.map((line) => (line.id === next.id ? next : line)))}
        onAddSex={() => onChange(addCertificateSexLine(lines, ids))}
        onRemove={(id) => onChange(lines.filter((line) => line.id !== id))}
        onRemoveGroup={() => {
          const selectedIds = new Set(ids);
          onChange(lines.filter((line) => !selectedIds.has(line.id)));
        }}
      />
    );
  });
}
