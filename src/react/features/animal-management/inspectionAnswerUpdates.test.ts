import { describe, expect, it } from "vitest";

import type { InspectionCatalogNode } from "../../api/contracts";
import { applyInspectionAnswerPatch, applyInspectionOutcomeToNodes } from "./inspectionAnswerUpdates";

const first: InspectionCatalogNode = {
  id: "first",
  code: "first",
  moduleCode: "basicAssessment",
  name: "第一项",
  nodeType: "ITEM",
};
const second: InspectionCatalogNode = { ...first, id: "second", code: "second", name: "第二项" };

describe("inspection answer updates", () => {
  it("patches one answer without dropping finding details", () => {
    const answers = {
      "basicAssessment:first": {
        nodeCode: "first",
        moduleCode: "basicAssessment" as const,
        outcome: "abnormal" as const,
        score: 3 as const,
        note: "待复查",
        locationHint: "A区",
        animalIdentifier: "AR-1",
      },
    };

    expect(applyInspectionAnswerPatch(answers, first, { outcome: "normal" })).toEqual({
      "basicAssessment:first": { ...answers["basicAssessment:first"], outcome: "normal" },
    });
  });

  it("normalizes a whole section in one derived map while retaining per-item details", () => {
    const answers = {
      "basicAssessment:first": {
        nodeCode: "first",
        moduleCode: "basicAssessment" as const,
        outcome: "abnormal" as const,
        note: "已登记",
      },
    };

    expect(applyInspectionOutcomeToNodes(answers, [first, second], "normal")).toEqual({
      "basicAssessment:first": { ...answers["basicAssessment:first"], outcome: "normal" },
      "basicAssessment:second": { nodeCode: "second", moduleCode: "basicAssessment", outcome: "normal" },
    });
  });

  it("keeps the map reference when a requested outcome is already present", () => {
    const answers = {
      "basicAssessment:first": {
        nodeCode: "first",
        moduleCode: "basicAssessment" as const,
        outcome: "normal" as const,
      },
    };

    expect(applyInspectionAnswerPatch(answers, first, { outcome: "normal" })).toBe(answers);
    expect(applyInspectionOutcomeToNodes(answers, [first], "normal")).toBe(answers);
  });
});
