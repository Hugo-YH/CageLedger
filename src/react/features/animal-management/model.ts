import type {
  InspectionAnswer,
  InspectionCatalogNode,
  InspectionModuleCode,
  InspectionOutcome,
} from "../../api/contracts";

export const MODULE_LABELS: Record<InspectionModuleCode, string> = {
  basicAssessment: "基础评估",
  advancedAssessment: "进阶评估",
  abnormalAnimalAssessment: "异常动物（小鼠）评估",
};

export const FINDING_STATUS_LABELS = {
  pending: "待处理",
  in_progress: "处理中",
  pending_recheck: "待复查",
  resolved: "已关闭",
} as const;

const FACILITY_LABELS: Record<string, string> = {
  zhujiang: "珠江新城设施",
  bioisland: "生物岛设施",
};

export function inspectionFacilityLabel(value?: string) {
  const facility = String(value || "").trim();
  return FACILITY_LABELS[facility] || facility || "未设置设施";
}

export function catalogItems(nodes: InspectionCatalogNode[], moduleCode: InspectionModuleCode) {
  return nodes.filter((node) => node.moduleCode === moduleCode && node.nodeType === "ITEM");
}

export function categoryLabel(item: InspectionCatalogNode, nodes: InspectionCatalogNode[]) {
  const byId = new Map(nodes.map((node) => [String(node.id), node]));
  let current = byId.get(String(item.parentId));
  let fallback = "其他检查项";
  while (current) {
    fallback = current.name || fallback;
    if (current.nodeType === "CATEGORY") return fallback;
    current = byId.get(String(current.parentId));
  }
  return fallback;
}

export function groupedItems(nodes: InspectionCatalogNode[], moduleCode: InspectionModuleCode) {
  const groups = new Map<string, InspectionCatalogNode[]>();
  for (const item of catalogItems(nodes, moduleCode)) {
    const label = categoryLabel(item, nodes);
    groups.set(label, [...(groups.get(label) || []), item]);
  }
  return [...groups.entries()];
}

export type InspectionItemGroup = {
  key: string;
  name: string;
  items: InspectionCatalogNode[];
};

export type InspectionBodyRegion = {
  key: string;
  name: string;
  description: string;
  groups: InspectionItemGroup[];
  itemCount: number;
};

type BodyRegionDefinition = Omit<InspectionBodyRegion, "groups" | "itemCount"> & {
  categoryCodes: string[];
  subcategoryCodes?: string[];
};

const ABNORMAL_BODY_REGIONS: BodyRegionDefinition[] = [
  {
    key: "overall",
    name: "整体状态与行为",
    description: "精神、姿态、活动、体况与呼吸",
    categoryCodes: ["abnormal_01", "abnormal_02"],
    subcategoryCodes: ["abnormal_01_02", "abnormal_02_01", "abnormal_02_02"],
  },
  {
    key: "fur-skin",
    name: "被毛/皮肤",
    description: "全身被毛、皮肤与皮下状态",
    categoryCodes: ["abnormal_01", "abnormal_03", "abnormal_06", "abnormal_07"],
    subcategoryCodes: ["abnormal_01_01", "abnormal_03_02", "abnormal_06_01", "abnormal_07_01"],
  },
  {
    key: "head-neck",
    name: "头颈部",
    description: "耳朵、眼睛、口部与鼻子",
    categoryCodes: ["abnormal_06"],
    subcategoryCodes: ["abnormal_06_02", "abnormal_06_03", "abnormal_06_04", "abnormal_06_05", "abnormal_06_06"],
  },
  {
    key: "thorax-abdomen",
    name: "胸腹部",
    description: "胸部与腹部外观、整体状态",
    categoryCodes: ["abnormal_07", "abnormal_03"],
    subcategoryCodes: ["abnormal_07_02", "abnormal_03_03"],
  },
  {
    key: "limbs",
    name: "四肢",
    description: "肢体、足部与行动能力",
    categoryCodes: ["abnormal_04"],
  },
  {
    key: "tail",
    name: "尾部",
    description: "尾部外观与损伤情况",
    categoryCodes: ["abnormal_05"],
  },
  {
    key: "reproduction-perianal",
    name: "繁殖与肛周",
    description: "肛周、泌尿生殖区、繁殖与幼仔状态",
    categoryCodes: ["abnormal_08", "abnormal_03"],
    subcategoryCodes: [
      "abnormal_08",
      "abnormal_03_01",
      "abnormal_03_04",
      "abnormal_03_05",
      "abnormal_03_06",
      "abnormal_03_07",
    ],
  },
];

function nodeLineage(item: InspectionCatalogNode, nodesById: Map<string, InspectionCatalogNode>) {
  const lineage: InspectionCatalogNode[] = [];
  let current = nodesById.get(String(item.parentId));
  while (current) {
    lineage.push(current);
    current = nodesById.get(String(current.parentId));
  }
  return lineage;
}

const FUR_SKIN_GROUPS: Array<{ key: string; name: string; match: (name: string) => boolean }> = [
  {
    key: "fur",
    name: "被毛",
    match: (name) => name.includes("被毛") || name.includes("脱毛"),
  },
  {
    key: "skin",
    name: "皮肤",
    match: () => true,
  },
];

function furSkinGroup(itemName: string) {
  const group = FUR_SKIN_GROUPS.find((candidate) => candidate.match(itemName)) || FUR_SKIN_GROUPS[1];
  return { key: group.key, name: group.name };
}

function renameFurSkinItemName(name: string) {
  if (name === "皮下肿胀") return "皮下肿瘤";
  if (name === "皮下多处肿胀") return "皮下肿胀";
  return name;
}

const OVERALL_GROUP_OVERRIDES: Record<string, { name: string; sortOrder: number }> = {
  abnormal_01_02: { name: "形体状态", sortOrder: 0 },
};

const HEAD_NECK_GROUP_OVERRIDES: Record<string, { name: string; sortOrder: number }> = {
  abnormal_06_04: { name: "头部", sortOrder: 0 },
};

const THORAX_ABDOMEN_GROUP_OVERRIDES: Record<string, { name: string; sortOrder: number }> = {
  abnormal_07_02: { name: "呼吸状态", sortOrder: 0 },
  abnormal_03_03: { name: "胸部", sortOrder: 1 },
};

/**
 * Reorders abnormal-animal checks for field inspection while preserving catalog IDs and answer keys.
 */
export function abnormalAnimalBodyRegions(nodes: InspectionCatalogNode[]): InspectionBodyRegion[] {
  const nodesById = new Map(nodes.map((node) => [String(node.id), node]));
  const regionGroups = new Map<string, Map<string, InspectionItemGroup & { sortOrder: number }>>();

  for (const item of catalogItems(nodes, "abnormalAnimalAssessment")) {
    const lineage = nodeLineage(item, nodesById);
    const category = lineage.find((node) => node.nodeType === "CATEGORY");
    const subcategory = lineage.find((node) => node.nodeType === "SUBCATEGORY") || category;
    if (!category || !subcategory) continue;

    const region = ABNORMAL_BODY_REGIONS.find(
      (definition) =>
        definition.categoryCodes.includes(category.code) &&
        (!definition.subcategoryCodes ||
          definition.subcategoryCodes.some(
            (code) => subcategory.code === code || subcategory.code.startsWith(`${code}_`),
          )),
    );
    if (!region) continue;
    if (region.key === "fur-skin" && item.name === "肿胀") continue;
    if (item.code === "abnormal_06_05_01") continue;
    if (item.code === "abnormal_06_06_03") continue;

    const groups = regionGroups.get(region.key) || new Map<string, InspectionItemGroup & { sortOrder: number }>();
    const itemName = region.key === "fur-skin" ? renameFurSkinItemName(item.name) : item.name;
    const groupOverride =
      region.key === "overall"
        ? OVERALL_GROUP_OVERRIDES[subcategory.code]
        : region.key === "head-neck"
          ? HEAD_NECK_GROUP_OVERRIDES[subcategory.code]
          : region.key === "thorax-abdomen"
            ? THORAX_ABDOMEN_GROUP_OVERRIDES[subcategory.code]
            : undefined;
    const { key: groupKey, name: groupName } = groupOverride
      ? { key: subcategory.code, name: groupOverride.name }
      : region.key === "fur-skin"
        ? furSkinGroup(itemName)
        : { key: subcategory.code, name: subcategory.name };
    const group = groups.get(groupKey) || {
      key: groupKey,
      name: groupName,
      items: [],
      sortOrder:
        region.key === "fur-skin"
          ? FUR_SKIN_GROUPS.findIndex((candidate) => candidate.key === groupKey)
          : groupOverride
            ? groupOverride.sortOrder
            : subcategory.sortOrder || 0,
    };
    if (
      region.key !== "fur-skin" ||
      !group.items.some((existing) => renameFurSkinItemName(existing.name) === itemName)
    ) {
      group.items.push(itemName === item.name ? item : { ...item, name: itemName });
    }
    groups.set(groupKey, group);
    regionGroups.set(region.key, groups);
  }

  return ABNORMAL_BODY_REGIONS.map((region) => {
    const groups = [...(regionGroups.get(region.key)?.values() || [])]
      .sort((left, right) => left.sortOrder - right.sortOrder)
      .map((group) => ({
        key: group.key,
        name: group.name,
        items: [...group.items].sort((left, right) => (left.sortOrder || 0) - (right.sortOrder || 0)),
      }));
    return {
      key: region.key,
      name: region.name,
      description: region.description,
      groups,
      itemCount: groups.reduce((total, group) => total + group.items.length, 0),
    };
  }).filter((region) => region.itemCount > 0);
}

export function normalizeAnswer(answer: InspectionAnswer, moduleCode: InspectionModuleCode): InspectionAnswer {
  const outcome = inspectionOutcome(answer);
  return { ...answer, moduleCode, outcome, score: outcome === "abnormal" ? 2 : 3 };
}

export function inspectionOutcome(answer?: Pick<InspectionAnswer, "outcome" | "score">): InspectionOutcome {
  if (answer?.outcome === "abnormal") return "abnormal";
  if (answer?.outcome === "normal") return "normal";
  return Number(answer?.score || 3) < 3 ? "abnormal" : "normal";
}

export function inspectionAnswerKey(moduleCode: InspectionModuleCode, nodeCode: string) {
  return `${moduleCode}:${nodeCode}`;
}

export function resumeInspectionId() {
  return sessionStorage.getItem("cageledger.animal-inspection.resume-id") || "";
}

export function setResumeInspectionId(id: string) {
  if (id) sessionStorage.setItem("cageledger.animal-inspection.resume-id", id);
  else sessionStorage.removeItem("cageledger.animal-inspection.resume-id");
}
