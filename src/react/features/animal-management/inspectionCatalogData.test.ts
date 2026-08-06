import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import type { InspectionCatalogNode, InspectionModuleCode } from "../../api/contracts";
import { abnormalAnimalBodyRegions, catalogItems, moduleItemCount } from "./model";

const MODULE_BY_ID: Record<number, InspectionModuleCode> = {
  1000021: "abnormalAnimalAssessment",
  1000022: "advancedAssessment",
  1000023: "basicAssessment",
};

const nodes: InspectionCatalogNode[] = JSON.parse(
  readFileSync(join(process.cwd(), "server_app/resources/animal_inspection/v1/assessment-nodes.json"), "utf8"),
).map(
  (node: Record<string, unknown>) =>
    ({
      ...node,
      moduleCode: MODULE_BY_ID[Number(node.moduleId)],
      nodeType: node.nodeType,
      inputType: node.inputType || undefined,
    }) as InspectionCatalogNode,
);

describe("inspection catalog data consistency (T9)", () => {
  it("seed catalog holds 233 nodes with skipped and duplicated items removed", () => {
    expect(nodes).toHaveLength(233);
    const removedCodes = new Set([
      "abnormal_03_02_04",
      "abnormal_06_05_01",
      "abnormal_06_06_03",
      "abnormal_06_01_04",
      "abnormal_06_01_01",
      "abnormal_07_01_01",
      "abnormal_01_01_01",
      "abnormal_03_02_02",
      "abnormal_06_01_02",
      "abnormal_03_02_03",
      "abnormal_07_01_03",
      "abnormal_01_01_07",
    ]);
    for (const node of nodes) {
      expect(removedCodes.has(node.code)).toBe(false);
    }
  });

  it("every rendered abnormal subcategory carries a body-region presentation config", () => {
    const abnormalSubcategories = nodes.filter(
      (node) => node.moduleCode === "abnormalAnimalAssessment" && node.nodeType === "SUBCATEGORY",
    );
    expect(abnormalSubcategories.length).toBeGreaterThan(0);
    for (const node of abnormalSubcategories) {
      if (node.code !== "abnormal_07_03") {
        expect(node.config?.presentation?.region, node.code).toBeTruthy();
      } else {
        expect(node.config?.presentation?.region).toBeUndefined();
      }
    }
  });

  it("only the unassigned abnormal_07_03 subcategory is excluded from the form", () => {
    const rendered = new Set(
      abnormalAnimalBodyRegions(nodes).flatMap((region) =>
        region.groups.flatMap((group) => group.items.map((item) => item.code)),
      ),
    );
    const dropped = catalogItems(nodes, "abnormalAnimalAssessment").filter((item) => !rendered.has(item.code));
    expect(dropped.map((item) => item.code).sort()).toEqual(
      [
        "abnormal_07_03_01",
        "abnormal_07_03_02",
        "abnormal_07_03_03",
        "abnormal_07_03_04",
        "abnormal_07_03_05",
        "abnormal_07_03_06",
      ].sort(),
    );
  });

  it("abnormal module renders the expected 125 items with no duplicate group names", () => {
    const regions = abnormalAnimalBodyRegions(nodes);
    expect(regions.reduce((sum, region) => sum + region.itemCount, 0)).toBe(125);
    for (const region of regions) {
      for (const group of region.groups) {
        const names = group.items.map((item) => item.name);
        expect(new Set(names).size).toBe(names.length);
      }
    }
  });

  it("basic and advanced module counts match the standards page", () => {
    expect(catalogItems(nodes, "basicAssessment")).toHaveLength(32);
    expect(catalogItems(nodes, "advancedAssessment")).toHaveLength(26);
    expect(moduleItemCount(nodes, "basicAssessment")).toBe(32);
    expect(moduleItemCount(nodes, "advancedAssessment")).toBe(26);
    expect(moduleItemCount(nodes, "abnormalAnimalAssessment")).toBe(125);
  });
});
