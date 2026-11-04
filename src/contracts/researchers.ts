export interface Researcher {
  id: string;
  account: string;
  name: string;
  alias: string;
  department: string;
  position: string;
  gender: string;
  mobile: string;
  telephone: string;
  email: string;
  enterpriseEmail: string;
  englishName: string;
  sourceDisabled: boolean;
  activationStatus: string;
  createdAt: string;
  updatedAt: string;
}

export type ResearcherEditable = Omit<Researcher, "id" | "account" | "createdAt" | "updatedAt">;

export interface ResearcherListParams {
  q?: string;
  department?: string;
  limit: number;
  offset: number;
}

export interface ResearcherListResponse {
  items: Researcher[];
  page: { limit: number; offset: number; total: number };
  departments: string[];
}

export interface ResearcherContact {
  name: string;
  status: "matched" | "not_found" | "ambiguous" | "missing_phone";
  phone: string;
}

export interface ResearcherImportFile {
  filename: string;
  data: string;
}

export interface ResearcherImportCounts {
  created: number;
  updated: number;
  unchanged: number;
  invalid: number;
}

export interface ResearcherImportRow {
  row: number;
  sheet: string;
  account: string;
  name: string;
  action: "create" | "update" | "unchanged" | "invalid";
  changes: Array<{ field: string; label: string; before: string | boolean; after: string | boolean }>;
  warnings: string[];
  errors: string[];
}

export interface ResearcherImportPreview {
  fileName: string;
  total: number;
  counts: ResearcherImportCounts;
  rows: ResearcherImportRow[];
  confirmationToken: string;
  canImport: boolean;
}

export interface ResearcherImportRequest extends ResearcherImportFile {
  confirmationToken: string;
  requestId: string;
}

export interface ResearcherImportResult {
  total: number;
  counts: ResearcherImportCounts;
  updatedAt: string;
  replayed: boolean;
}
