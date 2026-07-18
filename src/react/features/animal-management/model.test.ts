import { describe, expect, it } from "vitest";

import type { InspectionCatalogNode } from "../../api/contracts";
import { groupedItems, inspectionAnswerKey, inspectionFacilityLabel } from "./model";

const nodes: InspectionCatalogNode[] = [
  { id: "category", code: "basic_01", moduleCode: "basicAssessment", name: "环境", nodeType: "CATEGORY" },
  {
    id: "item",
    parentId: "category",
    code: "basic_01_01",
    moduleCode: "basicAssessment",
    name: "温湿度",
    nodeType: "ITEM",
  },
  { id: "advanced", code: "advanced_01", moduleCode: "advancedAssessment", name: "操作", nodeType: "ITEM" },
];

describe("animal inspection model", () => {
  it("groups item nodes under their category", () => {
    expect(groupedItems(nodes, "basicAssessment")).toEqual([["环境", [nodes[1]]]]);
  });

  it("makes module-scoped answer keys", () => {
    expect(inspectionAnswerKey("abnormalAnimalAssessment", "abnormal_01_01")).toBe(
      "abnormalAnimalAssessment:abnormal_01_01",
    );
  });

  it("shows facility names in Chinese", () => {
    expect(inspectionFacilityLabel("zhujiang")).toBe("珠江新城设施");
    expect(inspectionFacilityLabel("bioisland")).toBe("生物岛设施");
  });
});
