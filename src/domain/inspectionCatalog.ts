import type {
  InspectionCatalogDiff,
  InspectionCatalogModule,
  InspectionCatalogNode,
  InspectionCatalogNodeDiff,
  InspectionModuleCode,
} from "../contracts/animalManagement";

export interface InspectionScoringRow {
  key: string;
  level: string;
  description?: string;
}

export interface InspectionSubOptionRow {
  id: string;
  nameCn: string;
  nameEn?: string;
  descriptionEn?: string;
}

export interface InspectionReferenceImageRow {
  url: string;
  desc?: string;
}

export interface InspectionNodeFormValues {
  code: string;
  name: string;
  description?: string;
  nodeType: "CATEGORY" | "SUBCATEGORY" | "ITEM";
  inputType?: "score" | "severity" | "severity_with_options";
  sortOrder: number;
  suggestionMeasure?: string;
  scoringCriteria: InspectionScoringRow[];
  subOptions: InspectionSubOptionRow[];
  referenceImages: InspectionReferenceImageRow[];
}

export interface CatalogWorkingCopy {
  modules: InspectionCatalogModule[];
  nodes: InspectionCatalogNode[];
}

export type CatalogWorkingCopyAction =
  | { type: "applyNode"; node: InspectionCatalogNode }
  | { type: "addNode"; node: InspectionCatalogNode }
  | { type: "removeNode"; code: string };

export type CatalogTreeNode = {
  key: string;
  title: string;
  nodeType: "MODULE" | "CATEGORY" | "SUBCATEGORY" | "ITEM";
  children?: CatalogTreeNode[];
};

const NODE_PROJECTION_FIELDS: Array<keyof InspectionCatalogNode> = [
  "code",
  "moduleCode",
  "parentId",
  "nodeType",
  "inputType",
  "name",
  "nameEn",
  "description",
  "descriptionEn",
  "sortOrder",
  "config",
];

function nodeSignature(node: InspectionCatalogNode) {
  const projection: Record<string, unknown> = {};
  for (const field of NODE_PROJECTION_FIELDS) {
    const value = node[field];
    projection[field] = field === "parentId" && value != null ? String(value) : (value ?? null);
  }
  return stableStringify(projection);
}

function stableStringify(value: unknown): string {
  if (value === undefined) return "null";
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    const entries = Object.keys(record)
      .sort()
      .filter((key) => record[key] !== undefined)
      .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`);
    return `{${entries.join(",")}}`;
  }
  return JSON.stringify(value);
}

export function nodesDiffer(active: InspectionCatalogNode, draft: InspectionCatalogNode) {
  return nodeSignature(active) !== nodeSignature(draft);
}

export function catalogDiff(
  activeNodes: InspectionCatalogNode[],
  draftNodes: InspectionCatalogNode[],
): InspectionCatalogDiff {
  const activeByCode = new Map(activeNodes.map((node) => [node.code, node]));
  const draftByCode = new Map(draftNodes.map((node) => [node.code, node]));
  const changes: InspectionCatalogNodeDiff[] = [];
  for (const node of draftNodes) {
    const active = activeByCode.get(node.code);
    if (!active) changes.push({ code: node.code, moduleCode: node.moduleCode, name: node.name, change: "added" });
    else if (nodesDiffer(active, node)) {
      changes.push({ code: node.code, moduleCode: node.moduleCode, name: node.name, change: "modified" });
    }
  }
  for (const node of activeNodes) {
    if (!draftByCode.has(node.code)) {
      changes.push({ code: node.code, moduleCode: node.moduleCode, name: node.name, change: "removed" });
    }
  }
  changes.sort((left, right) => left.moduleCode.localeCompare(right.moduleCode) || left.code.localeCompare(right.code));
  return {
    added: changes.filter((item) => item.change === "added").length,
    modified: changes.filter((item) => item.change === "modified").length,
    removed: changes.filter((item) => item.change === "removed").length,
    nodes: changes,
  };
}

export function catalogTreeData(
  modules: InspectionCatalogModule[],
  nodes: InspectionCatalogNode[],
  moduleFilter?: InspectionModuleCode,
): CatalogTreeNode[] {
  const visibleModules = moduleFilter ? modules.filter((module) => module.code === moduleFilter) : modules;
  const childrenOf = new Map<string, InspectionCatalogNode[]>();
  for (const node of nodes) {
    const parentKey = node.parentId == null || String(node.parentId) === "" ? "" : String(node.parentId);
    const bucket = childrenOf.get(parentKey) || [];
    bucket.push(node);
    childrenOf.set(parentKey, bucket);
  }
  const sortNodes = (items: InspectionCatalogNode[]) =>
    [...items].sort(
      (left, right) => (left.sortOrder || 0) - (right.sortOrder || 0) || left.code.localeCompare(right.code),
    );

  const toTreeNode = (node: InspectionCatalogNode): CatalogTreeNode => {
    const children = (childrenOf.get(String(node.id)) || [])
      .sort((left, right) => (left.sortOrder || 0) - (right.sortOrder || 0) || left.code.localeCompare(right.code))
      .map(toTreeNode);
    return {
      key: node.code,
      title: node.name,
      nodeType: node.nodeType,
      children: children.length ? children : undefined,
    };
  };

  return visibleModules.map((module) => {
    const roots = sortNodes(nodes.filter((node) => node.moduleCode === module.code && node.nodeType === "CATEGORY"));
    return {
      key: module.code,
      title: module.name,
      nodeType: "MODULE" as const,
      children: roots.map((node) => toTreeNode(node)),
    };
  });
}

export function nextChildCode(parent: InspectionCatalogNode, nodes: InspectionCatalogNode[]) {
  const children = nodes.filter((node) => String(node.parentId) === String(parent.id));
  const maxSuffix = children.reduce((max, child) => {
    const match = String(child.code).match(/(\d+)$/);
    return match ? Math.max(max, Number(match[1])) : max;
  }, 0);
  return `${parent.code}_${String(maxSuffix + 1).padStart(2, "0")}`;
}

export function referenceImageFilename(url?: string) {
  const value = String(url || "").trim();
  return value ? value.split("/").pop() || "" : "";
}

export function referenceImageDisplayUrl(url?: string) {
  const filename = referenceImageFilename(url);
  return filename ? `/api/animal-inspection-reference/${filename}` : "";
}

export function nodeToFormValues(node: InspectionCatalogNode): InspectionNodeFormValues {
  const config = node.config || {};
  const scoringCriteria = Object.entries(config.scoringCriteria || {})
    .map(([key, entry]) => ({ key, level: entry.level || "", description: entry.description || "" }))
    .sort((left, right) => Number(left.key) - Number(right.key));
  return {
    code: node.code,
    name: node.name,
    description: node.description || "",
    nodeType: node.nodeType,
    inputType: node.inputType,
    sortOrder: node.sortOrder || 0,
    suggestionMeasure: config.suggestionMeasure || "",
    scoringCriteria,
    subOptions: (config.subOptions || []).map((option) => ({
      id: option.id || "",
      nameCn: option.nameCn || option.name || "",
      nameEn: option.nameEn || "",
      descriptionEn: option.descriptionEn || "",
    })),
    referenceImages: (config.referenceImages || []).map((image) => ({ url: image.url, desc: image.desc || "" })),
  };
}

export function formValuesToNode(
  values: InspectionNodeFormValues,
  original: InspectionCatalogNode,
): InspectionCatalogNode {
  const originalConfig: InspectionCatalogNode["config"] = original.config || {};
  const criteria: Record<string, { level: string; levelEn?: string; description?: string; descriptionEn?: string }> =
    {};
  for (const row of values.scoringCriteria) {
    const key = String(row.key || "").trim();
    if (!key) continue;
    const existing = originalConfig.scoringCriteria?.[key];
    criteria[key] = {
      ...(existing || {}),
      level: row.level || "",
      description: row.description || existing?.description || "",
    };
  }
  const config: Record<string, unknown> = { ...originalConfig };
  if (Object.keys(criteria).length) config.scoringCriteria = criteria;
  else delete config.scoringCriteria;
  if (values.inputType === "severity_with_options") {
    config.subOptions = values.subOptions
      .filter((option) => String(option.id || "").trim() && String(option.nameCn || "").trim())
      .map((option) => ({
        id: option.id.trim(),
        nameCn: option.nameCn.trim(),
        nameEn: option.nameEn?.trim() || "",
        descriptionEn: option.descriptionEn?.trim() || "",
      }));
  } else {
    delete config.subOptions;
  }
  if (String(values.suggestionMeasure || "").trim()) {
    config.suggestionMeasure = String(values.suggestionMeasure || "").trim();
  } else delete config.suggestionMeasure;
  if (values.referenceImages.length) {
    config.referenceImages = values.referenceImages
      .filter((image) => String(image.url || "").trim())
      .map((image) => ({ url: image.url.trim(), desc: String(image.desc || "").trim() || undefined }));
  } else {
    delete config.referenceImages;
  }
  return {
    ...original,
    name: String(values.name || "").trim(),
    description: String(values.description || "").trim() || undefined,
    sortOrder: Number(values.sortOrder) || 0,
    inputType: original.nodeType === "ITEM" ? values.inputType : undefined,
    config,
  };
}

export function catalogWorkingCopyReducer(
  state: CatalogWorkingCopy,
  action: CatalogWorkingCopyAction,
): CatalogWorkingCopy {
  switch (action.type) {
    case "applyNode":
      return { ...state, nodes: state.nodes.map((node) => (node.code === action.node.code ? action.node : node)) };
    case "addNode":
      return { ...state, nodes: [...state.nodes, action.node] };
    case "removeNode":
      return { ...state, nodes: state.nodes.filter((node) => node.code !== action.code) };
  }
}
