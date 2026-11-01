import { describe, expect, it } from "vitest";

import type { ReceptionCertificateLine } from "../../../contracts/reception";
import {
  addCertificateSexLine,
  groupCertificateLines,
  patchCertificateGroup,
  type CertificateSharedPatch,
} from "./certificateGroups";

function certificateLine(patch: Partial<ReceptionCertificateLine> = {}): ReceptionCertificateLine {
  return {
    id: "line-1",
    attachmentId: "attachment-1",
    runId: "run-1",
    certificateIndex: 1,
    certificateLineIndex: 1,
    certificateNo: "CERT-1",
    certificateStrain: "ICR 原文",
    grade: "SPF",
    supplier: "证载供应商",
    sex: "雄性",
    quantity: 13,
    weightRaw: "20-22g",
    ageRaw: "8 周",
    specification: "8 周 / 20-22g",
    receiptId: "receipt-1",
    experimentCertificateNo: "SCXK-1",
    notes: "证载备注",
    ...patch,
  };
}

describe("certificate groups", () => {
  it("groups 13 males and 8 females from one certificate while preserving source rows and global indexes", () => {
    const male = certificateLine();
    const other = certificateLine({ id: "other", certificateNo: "CERT-2" });
    const female = certificateLine({
      id: "line-2",
      sex: "雌性",
      quantity: 8,
      runId: "run-2",
      certificateLineIndex: 2,
      receiptId: "receipt-2",
    });
    const groups = groupCertificateLines([male, other, female]);

    expect(groups).toEqual([
      {
        key: male.id,
        entries: [
          { line: male, index: 0 },
          { line: female, index: 2 },
        ],
      },
      { key: other.id, entries: [{ line: other, index: 1 }] },
    ]);
    expect(groups[0].entries[0].line).toBe(male);
    expect(groups[0].entries[1].line).toBe(female);
    expect(groups[0].key).toBe(groupCertificateLines([{ ...male, certificateNo: "CORRECTED" }])[0].key);
  });

  const differentSharedFields: [string, CertificateSharedPatch][] = [
    ["attachment", { attachmentId: "attachment-2" }],
    ["certificate index", { certificateIndex: 2 }],
    ["certificate number", { certificateNo: "CERT-2" }],
    ["strain", { certificateStrain: "BALB/c" }],
    ["grade", { grade: "普通级" }],
    ["supplier", { supplier: "另一供应商" }],
    ["specification", { specification: "8周 / 20-22g" }],
    ["notes", { notes: "另一备注" }],
    ["weight source text", { weightRaw: "20~22 g" }],
    ["age source text", { ageRaw: "8周" }],
    ["experiment certificate number", { experimentCertificateNo: "SCXK-2" }],
  ];

  it.each(differentSharedFields)(
    "keeps rows with different %s separate even when certificate numbers match",
    (_, patch) => {
      const first = certificateLine();
      const second = certificateLine({ id: "line-2", ...patch });
      expect(groupCertificateLines([first, second])).toEqual([
        { key: first.id, entries: [{ line: first, index: 0 }] },
        { key: second.id, entries: [{ line: second, index: 1 }] },
      ]);
    },
  );

  it("retains unknown sex, unknown quantity and zero quantity without filtering or inventing values", () => {
    const unknown = certificateLine({ sex: "未知", quantity: null });
    const zero = certificateLine({ id: "line-2", sex: "雌性", quantity: 0, certificateLineIndex: 2 });
    const groups = groupCertificateLines([unknown, zero]);
    expect(groups).toHaveLength(1);
    expect(groups[0].entries.map(({ line }) => [line.sex, line.quantity])).toEqual([
      ["未知", null],
      ["雌性", 0],
    ]);
    expect(groupCertificateLines([])).toEqual([]);
  });
});

describe("patch certificate group", () => {
  it("changes only selected shared fields and retains quantities, sex, source identities and receipt links", () => {
    const first = certificateLine({ quantity: null });
    const second = certificateLine({
      id: "line-2",
      runId: "run-2",
      certificateLineIndex: 2,
      sex: "雌性",
      quantity: 0,
      receiptId: "receipt-2",
    });
    const other = certificateLine({ id: "other", certificateNo: "CERT-2" });
    const lines = [first, other, second];
    const before = lines.map((line) => ({ ...line }));
    const patch: CertificateSharedPatch = {
      certificateNo: "CORRECTED",
      certificateStrain: "BALB/c",
      grade: "普通级",
      supplier: "更正供应商",
      specification: "6 周",
      notes: "",
      weightRaw: "18-20g",
      ageRaw: "6 周",
      experimentCertificateNo: "SCXK-2",
      attachmentId: "attachment-2",
      certificateIndex: 2,
    };
    const patched = patchCertificateGroup(lines, [first.id, second.id], patch);

    expect(patched).toEqual([{ ...first, ...patch }, other, { ...second, ...patch }]);
    expect(patched[1]).toBe(other);
    expect(lines).toEqual(before);
  });

  it("ignores non-shared fields included in a received patch", () => {
    const first = certificateLine();
    const receivedPatch = {
      certificateNo: "CORRECTED",
      id: "replacement-id",
      runId: "replacement-run",
      certificateLineIndex: 99,
      receiptId: "replacement-receipt",
      quantity: 99,
      sex: "雌性",
    };
    expect(patchCertificateGroup([first], [first.id], receivedPatch)).toEqual([
      { ...first, certificateNo: "CORRECTED" },
    ]);
    expect(patchCertificateGroup([first], ["missing"], { certificateNo: "IGNORED" })).toEqual([first]);
  });
});

describe("add certificate sex line", () => {
  it("adds a manual line without copying quantity or AI origin and allocates the next line index across the source certificate", () => {
    const first = certificateLine();
    const sameCertificate = certificateLine({
      id: "different-specification",
      specification: "6 周",
      certificateLineIndex: 9,
    });
    const anotherAttachment = certificateLine({
      id: "another-attachment",
      attachmentId: "attachment-2",
      certificateLineIndex: 99,
    });
    const anotherCertificate = certificateLine({
      id: "another-certificate",
      certificateIndex: 2,
      certificateLineIndex: 99,
    });
    const lines = [first, sameCertificate, anotherAttachment, anotherCertificate];
    const next = addCertificateSexLine(lines, [first.id]);
    const added = next[lines.length];

    expect(next).toHaveLength(lines.length + 1);
    lines.forEach((line, index) => expect(next[index]).toBe(line));
    expect(added.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
    expect(added.id).not.toBe(first.id);
    expect(added).toEqual({
      ...first,
      id: added.id,
      runId: null,
      certificateLineIndex: 10,
      quantity: null,
      sex: "雌性",
    });
    expect(lines).toHaveLength(4);
  });

  const defaultSexCases: [string[], string][] = [
    [["雄性"], "雌性"],
    [["雄性", "雄性"], "雌性"],
    [["雌性"], "雄性"],
    [["雌性", "雌性"], "雄性"],
    [["雄性", "雌性"], "未知"],
    [["未知"], "未知"],
    [["雌雄"], "未知"],
    [[""], "未知"],
    [["雄性", "未知"], "未知"],
  ];

  it.each(defaultSexCases)("defaults a new sex line from existing sexes %j to %s", (sexes, expectedSex) => {
    const lines = sexes.map((sex, index) =>
      certificateLine({ id: `line-${index}`, sex, quantity: index === 0 ? 0 : null, certificateLineIndex: index + 1 }),
    );
    const next = addCertificateSexLine(lines, lines.map((line) => line.id).reverse());
    const added = next[lines.length];
    expect(added.sex).toBe(expectedSex);
    expect(added.quantity).toBeNull();
    expect(added.receiptId).toBe(lines[0].receiptId);
    expect(next.slice(0, lines.length)).toEqual(lines);
  });

  it("does not add a line when no selected member exists", () => {
    const first = certificateLine();
    expect(addCertificateSexLine([first], [])).toEqual([first]);
    expect(addCertificateSexLine([first], ["missing"])).toEqual([first]);
    expect(addCertificateSexLine([], [])).toEqual([]);
  });
});
