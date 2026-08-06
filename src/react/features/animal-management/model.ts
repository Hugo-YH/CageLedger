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

export function moduleItemCount(nodes: InspectionCatalogNode[], moduleCode: InspectionModuleCode) {
  if (moduleCode === "abnormalAnimalAssessment") {
    return abnormalAnimalBodyRegions(nodes).reduce((sum, region) => sum + region.itemCount, 0);
  }
  return catalogItems(nodes, moduleCode).length;
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

/** Static body-region vocabulary; node-to-region assignment comes from node config.presentation.region. */
const ABNORMAL_BODY_REGIONS: Array<Pick<InspectionBodyRegion, "key" | "name" | "description">> = [
  { key: "overall", name: "整体状态与行为", description: "精神、姿态、活动、体况与呼吸" },
  { key: "fur-skin", name: "被毛/皮肤", description: "全身被毛、皮肤与皮下状态" },
  { key: "head-neck", name: "头颈部", description: "耳朵、眼睛、口部与鼻子" },
  { key: "thorax-abdomen", name: "胸腹部", description: "胸部与腹部外观、整体状态" },
  { key: "limbs", name: "四肢", description: "肢体、足部与行动能力" },
  { key: "tail", name: "尾部", description: "尾部外观与损伤情况" },
  { key: "reproduction-perianal", name: "繁殖与肛周", description: "肛周、泌尿生殖区、繁殖与幼仔状态" },
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

/**
 * Renders abnormal-animal checks grouped by body region. Region, group and display
 * naming come from node config.presentation, so the form follows the catalog data.
 */
export function abnormalAnimalBodyRegions(nodes: InspectionCatalogNode[]): InspectionBodyRegion[] {
  const nodesById = new Map(nodes.map((node) => [String(node.id), node]));
  const regionGroups = new Map<string, Map<string, InspectionItemGroup & { sortOrder: number }>>();

  for (const item of catalogItems(nodes, "abnormalAnimalAssessment")) {
    const lineage = nodeLineage(item, nodesById);
    const subcategory =
      lineage.find((node) => node.nodeType === "SUBCATEGORY") || lineage.find((node) => node.nodeType === "CATEGORY");
    if (!subcategory) continue;
    const regionKey = subcategory.config?.presentation?.region;
    const region = regionKey ? ABNORMAL_BODY_REGIONS.find((candidate) => candidate.key === regionKey) : undefined;
    if (!region) continue;

    const itemPresentation = item.config?.presentation || {};
    const subPresentation = subcategory.config?.presentation || {};
    const isFurSkin = region.key === "fur-skin";
    const displayName = itemPresentation.displayName || item.name;
    const groupKey = isFurSkin ? itemPresentation.groupName || "皮肤" : subPresentation.groupName || subcategory.name;
    const groups = regionGroups.get(region.key) || new Map<string, InspectionItemGroup & { sortOrder: number }>();
    const group = groups.get(groupKey) || {
      key: groupKey,
      name: groupKey,
      items: [],
      sortOrder: isFurSkin
        ? (itemPresentation.groupSortOrder ?? 1)
        : (subPresentation.groupSortOrder ?? subcategory.sortOrder ?? 0),
    };
    group.items.push({ ...item, name: displayName });
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
