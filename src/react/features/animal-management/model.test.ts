import { describe, expect, it } from "vitest";

import type { InspectionCatalogNode } from "../../api/contracts";
import {
  abnormalAnimalBodyRegions,
  groupedItems,
  inspectionAnswerKey,
  inspectionFacilityLabel,
  inspectionOutcome,
} from "./model";

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

  it("maps historical scores and new binary outcomes to a shared inspection conclusion", () => {
    expect(inspectionOutcome({ score: 3 })).toBe("normal");
    expect(inspectionOutcome({ score: 1 })).toBe("abnormal");
    expect(inspectionOutcome({ outcome: "normal" })).toBe("normal");
    expect(inspectionOutcome({ outcome: "abnormal" })).toBe("abnormal");
  });

  it("orders abnormal-animal checks by body region without changing item codes", () => {
    const abnormalNodes: InspectionCatalogNode[] = [
      {
        id: "abdomen",
        code: "abnormal_03",
        moduleCode: "abnormalAnimalAssessment",
        name: "腹部",
        nodeType: "CATEGORY",
      },
      {
        id: "anus",
        parentId: "abdomen",
        code: "abnormal_03_01",
        moduleCode: "abnormalAnimalAssessment",
        name: "肛门",
        nodeType: "SUBCATEGORY",
        sortOrder: 1,
        config: { presentation: { region: "reproduction-perianal" } },
      },
      {
        id: "abdomen-skin",
        parentId: "abdomen",
        code: "abnormal_03_02",
        moduleCode: "abnormalAnimalAssessment",
        name: "腹部被毛/皮肤",
        nodeType: "SUBCATEGORY",
        sortOrder: 2,
        config: { presentation: { region: "fur-skin" } },
      },
      {
        id: "anus-item",
        parentId: "anus",
        code: "abnormal_03_01_01",
        moduleCode: "abnormalAnimalAssessment",
        name: "肛周异常",
        nodeType: "ITEM",
      },
      {
        id: "abdomen-item",
        parentId: "abdomen-skin",
        code: "abnormal_03_02_01",
        moduleCode: "abnormalAnimalAssessment",
        name: "腹部皮肤异常",
        nodeType: "ITEM",
      },
      { id: "head", code: "abnormal_06", moduleCode: "abnormalAnimalAssessment", name: "头颈部", nodeType: "CATEGORY" },
      {
        id: "eye",
        parentId: "head",
        code: "abnormal_06_03",
        moduleCode: "abnormalAnimalAssessment",
        name: "眼睛",
        nodeType: "SUBCATEGORY",
        sortOrder: 3,
        config: { presentation: { region: "head-neck" } },
      },
      {
        id: "eye-item",
        parentId: "eye",
        code: "abnormal_06_03_01",
        moduleCode: "abnormalAnimalAssessment",
        name: "眼睛异常",
        nodeType: "ITEM",
      },
      {
        id: "thorax",
        code: "abnormal_07",
        moduleCode: "abnormalAnimalAssessment",
        name: "胸部",
        nodeType: "CATEGORY",
      },
      {
        id: "thorax-skin",
        parentId: "thorax",
        code: "abnormal_07_01",
        moduleCode: "abnormalAnimalAssessment",
        name: "胸部被毛/皮肤",
        nodeType: "SUBCATEGORY",
        config: { presentation: { region: "fur-skin" } },
      },
      {
        id: "thorax-item",
        parentId: "thorax-skin",
        code: "abnormal_07_01_01",
        moduleCode: "abnormalAnimalAssessment",
        name: "胸部皮肤异常",
        nodeType: "ITEM",
      },
    ];

    const regions = abnormalAnimalBodyRegions(abnormalNodes);
    expect(regions.map((region) => region.name)).toEqual(["被毛/皮肤", "头颈部", "繁殖与肛周"]);
    expect(regions[0].groups.map((group) => group.name)).toEqual(["皮肤"]);
    expect(regions[0].groups.flatMap((group) => group.items).map((item) => item.code)).toEqual(
      expect.arrayContaining(["abnormal_03_02_01", "abnormal_07_01_01"]),
    );
    expect(regions[2].groups[0].items[0].code).toBe("abnormal_03_01_01");
  });
});
