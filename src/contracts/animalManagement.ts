export type InspectionModuleCode = "basicAssessment" | "advancedAssessment" | "abnormalAnimalAssessment";
export type InspectionStatus = "draft" | "submitted";
export type FindingStatus = "pending" | "in_progress" | "pending_recheck" | "resolved";

export interface InspectionCatalogNode {
  id: string | number;
  parentId?: string | number;
  moduleId?: string | number;
  code: string;
  moduleCode: InspectionModuleCode;
  name: string;
  description?: string;
  nodeType: "CATEGORY" | "SUBCATEGORY" | "ITEM";
  inputType?: "score" | "severity" | "severity_with_options";
  sortOrder?: number;
  config?: {
    scoringCriteria?: Record<string, { level: string; description?: string }>;
    subOptions?: Array<{ id?: string; value?: string; label?: string; name?: string; nameCn?: string }>;
    referenceImages?: Array<{ url: string; desc?: string }>;
    referenceOrigin?: "exact" | "same_name";
    suggestionMeasure?: string;
  };
}

export interface InspectionCatalogModule {
  id: string | number;
  code: InspectionModuleCode;
  name: string;
  description?: string;
  version?: number;
}

export interface InspectionCatalogResponse {
  version: { version: string; source: string; status: string; imported_at: string };
  modules: InspectionCatalogModule[];
  nodes: InspectionCatalogNode[];
  reviewNotice: string;
}

export interface InspectionAnswer {
  nodeCode: string;
  moduleCode: InspectionModuleCode;
  score: 1 | 2 | 3;
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
