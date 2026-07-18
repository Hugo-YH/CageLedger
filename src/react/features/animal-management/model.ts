import type { InspectionAnswer, InspectionCatalogNode, InspectionModuleCode } from "../../api/contracts";

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

export function normalizeAnswer(answer: InspectionAnswer, moduleCode: InspectionModuleCode): InspectionAnswer {
  return { ...answer, moduleCode, score: answer.score || 3 };
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
