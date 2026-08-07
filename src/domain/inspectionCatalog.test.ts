import { describe, expect, it } from "vitest";

import type { InspectionCatalogNode } from "../contracts/animalManagement";
import {
  catalogDiff,
  catalogTreeData,
  catalogWorkingCopyReducer,
  formValuesToNode,
  nextChildCode,
  nodeToFormValues,
  nodesDiffer,
  referenceImageDisplayUrl,
  referenceImageFilename,
} from "./inspectionCatalog";

function node(overrides: Partial<InspectionCatalogNode> & { code: string }): InspectionCatalogNode {
  return {
    id: overrides.code,
    moduleCode: "basicAssessment",
    name: overrides.code,
    nodeType: "ITEM",
    sortOrder: 0,
    ...overrides,
  };
}

describe("inspectionCatalog diff", () => {
  const active = [
    node({ code: "a", name: "原有" }),
    node({ code: "b", name: "待删除" }),
    node({ code: "c", name: "待修改" }),
  ];

  it("counts added, removed and modified nodes", () => {
    const draft = [
      node({ code: "a", name: "原有" }),
      node({ code: "c", name: "新名称" }),
      node({ code: "d", name: "新增" }),
    ];
    const diff = catalogDiff(active, draft);
    expect(diff.added).toBe(1);
    expect(diff.modified).toBe(1);
    expect(diff.removed).toBe(1);
    expect(diff.nodes.find((item) => item.code === "d")?.change).toBe("added");
    expect(diff.nodes.find((item) => item.code === "b")?.change).toBe("removed");
  });

  it("ignores key order and identical payloads", () => {
    const draft = [node({ code: "a", name: "原有" }), node({ code: "c", name: "待修改" })];
    expect(catalogDiff(active, draft).modified).toBe(0);
  });

  it("detects config changes as modified", () => {
    const draft = [node({ code: "c", name: "待修改", config: { suggestionMeasure: "处理" } })];
    expect(nodesDiffer(active[2], draft[0])).toBe(true);
  });

  it("treats numeric and string parent ids as equal", () => {
    const left = node({ code: "x", id: "sub", parentId: 1001884, nodeType: "SUBCATEGORY" });
    const right = node({ code: "x", id: "sub", parentId: "1001884", nodeType: "SUBCATEGORY" });
    expect(nodesDiffer(left, right)).toBe(false);
  });
});

describe("inspectionCatalog tree", () => {
  it("builds module -> category -> subcategory -> item hierarchy", () => {
    const nodes = [
      node({ code: "m1", id: "cat", nodeType: "CATEGORY", name: "分类" }),
      node({ code: "m1_1", id: "sub", parentId: "cat", nodeType: "SUBCATEGORY", name: "子分类" }),
      node({ code: "m1_1_1", id: "item", parentId: "sub", name: "条目" }),
    ];
    const tree = catalogTreeData([{ id: "mod", code: "basicAssessment", name: "基础评估" }], nodes);
    expect(tree[0].nodeType).toBe("MODULE");
    expect(tree[0].children?.[0].key).toBe("m1");
    expect(tree[0].children?.[0].children?.[0].key).toBe("m1_1");
    expect(tree[0].children?.[0].children?.[0].children?.[0].key).toBe("m1_1_1");
  });

  it("filters by module", () => {
    const nodes = [node({ code: "x", id: "cat", nodeType: "CATEGORY", name: "分类" })];
    const modules = [
      { id: "m1", code: "basicAssessment" as const, name: "基础评估" },
      { id: "m2", code: "advancedAssessment" as const, name: "进阶评估" },
    ];
    expect(catalogTreeData(modules, nodes, "basicAssessment")).toHaveLength(1);
    expect(catalogTreeData(modules, nodes, "advancedAssessment")).toHaveLength(1);
  });
});

describe("nextChildCode", () => {
  it("increments the numeric suffix of the parent code", () => {
    const parent = node({ code: "m1_1", id: "sub", nodeType: "SUBCATEGORY" });
    const nodes = [
      node({ code: "m1_1_01", parentId: "sub" }),
      node({ code: "m1_1_02", parentId: "sub" }),
      node({ code: "m1_1_03", parentId: "sub" }),
    ];
    expect(nextChildCode(parent, nodes)).toBe("m1_1_04");
  });

  it("falls back to 01 when no children exist", () => {
    const parent = node({ code: "m1", id: "cat", nodeType: "CATEGORY" });
    expect(nextChildCode(parent, [])).toBe("m1_01");
  });
});

describe("reference image helpers", () => {
  it("extracts filenames and builds protected urls", () => {
    expect(referenceImageFilename("/downloads/images/diarrhea.jpg")).toBe("diarrhea.jpg");
    expect(referenceImageFilename("/api/animal-inspection-reference/eye.png")).toBe("eye.png");
    expect(referenceImageDisplayUrl("/downloads/images/eye.png")).toBe("/api/animal-inspection-reference/eye.png");
    expect(referenceImageFilename("")).toBe("");
  });
});

describe("node form conversion", () => {
  const original = node({
    code: "m1_1_1",
    id: "item-id",
    name: "肿胀",
    nodeType: "ITEM",
    inputType: "severity_with_options",
    config: {
      scoringCriteria: {
        "1": { level: "严重", levelEn: "Severe", description: "严重" },
        "2": { level: "轻微", levelEn: "Mild", description: "轻微" },
        "3": { level: "正常", levelEn: "Normal", description: "未勾选此项默认为3分" },
      },
      subOptions: [{ id: "pale", nameCn: "苍白", nameEn: "Pale" }],
      suggestionMeasure: "观察",
      referenceImages: [{ url: "/downloads/images/swell.jpg", desc: "示例" }],
    },
  });

  it("round-trips form values back to the original node", () => {
    const values = nodeToFormValues(original);
    expect(values.scoringCriteria).toHaveLength(3);
    expect(values.subOptions?.[0].nameCn).toBe("苍白");
    const rebuilt = formValuesToNode(values, original);
    expect(rebuilt.name).toBe(original.name);
    expect(rebuilt.config?.scoringCriteria?.["1"].levelEn).toBe("Severe");
    expect(rebuilt.config?.subOptions?.[0].id).toBe("pale");
    expect(rebuilt.config?.referenceImages?.[0].url).toBe("/downloads/images/swell.jpg");
  });

  it("preserves legacy scoring config when the binary form omits scoring fields", () => {
    const values = nodeToFormValues(original);
    delete values.inputType;
    delete values.scoringCriteria;
    delete values.subOptions;
    const rebuilt = formValuesToNode(values, original);
    expect(rebuilt.inputType).toBe("severity_with_options");
    expect(rebuilt.config?.subOptions?.[0].id).toBe("pale");
    expect(rebuilt.config?.scoringCriteria?.["1"].levelEn).toBe("Severe");
  });

  it("drops empty suggestion measure and images", () => {
    const values = nodeToFormValues(original);
    values.suggestionMeasure = "";
    values.referenceImages = [];
    const rebuilt = formValuesToNode(values, original);
    expect(rebuilt.config?.suggestionMeasure).toBeUndefined();
    expect(rebuilt.config?.referenceImages).toBeUndefined();
  });
});

describe("catalogWorkingCopyReducer", () => {
  const state = { modules: [], nodes: [node({ code: "a", name: "A" })] };
  it("applies, adds and removes nodes", () => {
    const applied = catalogWorkingCopyReducer(state, { type: "applyNode", node: node({ code: "a", name: "A2" }) });
    expect(applied.nodes[0].name).toBe("A2");
    const added = catalogWorkingCopyReducer(applied, { type: "addNode", node: node({ code: "b", name: "B" }) });
    expect(added.nodes).toHaveLength(2);
    const removed = catalogWorkingCopyReducer(added, { type: "removeNode", code: "a" });
    expect(removed.nodes.map((item) => item.code)).toEqual(["b"]);
  });
});
