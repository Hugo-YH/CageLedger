export type InspectionModuleCode = "basicAssessment" | "advancedAssessment" | "abnormalAnimalAssessment";
export type InspectionStatus = "draft" | "submitted";
export type FindingStatus = "pending" | "in_progress" | "pending_recheck" | "resolved";
export type InspectionOutcome = "normal" | "abnormal";

export interface InspectionCatalogNode {
  id: string | number;
  parentId?: string | number;
  moduleId?: string | number;
  code: string;
  moduleCode: InspectionModuleCode;
  name: string;
  nameEn?: string;
  description?: string;
  descriptionEn?: string;
  nodeType: "CATEGORY" | "SUBCATEGORY" | "ITEM";
  inputType?: "score" | "severity" | "severity_with_options";
  sortOrder?: number;
  config?: {
    scoringCriteria?: Record<string, { level: string; levelEn?: string; description?: string; descriptionEn?: string }>;
    subOptions?: Array<{
      id?: string;
      value?: string;
      label?: string;
      name?: string;
      nameCn?: string;
      nameEn?: string;
      descriptionEn?: string;
    }>;
    referenceImages?: Array<{ url: string; desc?: string }>;
    referenceOrigin?: "exact" | "same_name";
    suggestionMeasure?: string;
    /** Abnormal-module presentation hints: body-region assignment and display renaming. */
    presentation?: {
      region?: string;
      groupName?: string;
      groupSortOrder?: number;
      displayName?: string;
    };
  };
}

export interface InspectionCatalogModule {
  id: string | number;
  code: InspectionModuleCode;
  name: string;
  description?: string;
  version?: number;
}

export interface InspectionCatalogVersion {
  version: string;
  source: string;
  status: string;
  imported_at: string;
}

export interface InspectionCatalogResponse {
  version: InspectionCatalogVersion;
  modules: InspectionCatalogModule[];
  nodes: InspectionCatalogNode[];
  reviewNotice: string;
}

export interface InspectionCatalogDraftVersion extends InspectionCatalogVersion {
  updatedAt: string;
}

export interface InspectionCatalogBaseline {
  version: InspectionCatalogVersion | null;
  modules: InspectionCatalogModule[];
  nodes: InspectionCatalogNode[];
}

export interface InspectionCatalogDraftResponse {
  version: InspectionCatalogDraftVersion;
  modules: InspectionCatalogModule[];
  nodes: InspectionCatalogNode[];
  hasDraft: boolean;
  /** Raw (untransformed) active catalog used as the edit baseline and diff reference. */
  active: InspectionCatalogBaseline;
}

export interface InspectionCatalogVersionSummary {
  version: string;
  source: string;
  status: string;
  importedAt: string;
  nodeCount: number;
  isActive: boolean;
}

export type InspectionNodeChange = "added" | "modified" | "removed";

export interface InspectionCatalogNodeDiff {
  code: string;
  moduleCode: InspectionModuleCode;
  name: string;
  change: InspectionNodeChange;
}

export interface InspectionCatalogDiff {
  added: number;
  modified: number;
  removed: number;
  nodes: InspectionCatalogNodeDiff[];
}

export interface InspectionAnswer {
  nodeCode: string;
  moduleCode: InspectionModuleCode;
  outcome?: InspectionOutcome;
  /** Historical compatibility for records created before binary inspection outcomes. */
  score?: 1 | 2 | 3;
  subOption?: string;
  note?: string;
  locationHint?: string;
  rackHint?: string;
  cageNumber?: string;
  animalIdentifier?: string;
}

export interface AnimalInspection {
  id: string;
  roomId: string;
  roomName: string;
  facility?: string;
  moduleCodes: InspectionModuleCode[];
  status: InspectionStatus;
  catalogVersion: string;
  createdBy: string;
  createdByName: string;
  createdAt: string;
  submittedAt?: string;
  updatedAt: string;
  snapshot: { iacucs: string[]; pis: string[]; species: string[]; animalCount: number; cageCodes: string[] };
  findingSummary?: { total: number; pending: number; resolved: number };
}

export interface InspectionAttachment {
  id: string;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  createdAt: string;
  downloadUrl: string;
}

export interface InspectionFinding {
  id: string;
  inspectionId: string;
  roomId: string;
  roomName: string;
  moduleCode: InspectionModuleCode;
  nodeCode: string;
  severity: 1 | 2;
  status: FindingStatus;
  locationHint?: string;
  rackHint?: string;
  cageNumber?: string;
  animalIdentifier?: string;
  actionNote?: string;
  responsibleName?: string;
  recheckDueAt?: string;
  resolvedAt?: string;
  updatedAt: string;
  attachments: InspectionAttachment[];
  events: Array<{ id: string; event_type: string; note?: string; actor_name: string; at: string }>;
}

export interface AnimalInspectionDetail {
  item: AnimalInspection;
  answers: Array<
    InspectionAnswer & { module_code: InspectionModuleCode; node_code: string; payload?: InspectionAnswer }
  >;
  findings: InspectionFinding[];
  catalog: InspectionCatalogResponse;
}

export interface AnimalInspectionListParams {
  limit: number;
  offset: number;
  sortKey?: string;
  sortDir?: "asc" | "desc";
  room?: string;
  status?: string;
  module?: string;
  creator?: string;
  severity?: string;
}
