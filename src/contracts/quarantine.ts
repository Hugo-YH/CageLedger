export type QuarantineMethod = "parasite" | "elisa_mouse" | "elisa_rat" | "pcr";
export type QuarantineResult = "negative" | "positive" | "suspect" | "not_tested" | "";
export interface QuarantineSource {
  id: string;
  intakeId: string;
  supplier: string;
  pi: string;
  owner: string;
  iacuc: string;
  species: string;
  intakeDate: string;
  batchNo: string;
  notes: string;
  manual?: boolean;
  strainRaw?: string;
  strainStandard?: string;
  sex?: string;
  quantity?: string | number | null;
}
export interface QuarantineBatch {
  id: string;
  name: string;
  sources: QuarantineSource[];
  conclusion: string;
  handling: string;
  updatedAt: string;
  status?: string;
  completedAt?: string;
  completedBy?: { id: string; name: string };
  completionReportIds?: string[];
}
export interface QuarantineSample {
  id: string;
  number: string;
  material: string;
  specimenState?: string;
  poolCount: number;
  portionCount: number;
  sourceIds: string[];
}
export interface QuarantineProject {
  id: string;
  name: string;
  kit: string;
  lot: string;
  sampleIds: string[];
  results: Record<string, QuarantineResult>;
  wells: Record<string, string>;
  nc: QuarantineResult;
  pc: QuarantineResult;
}
export interface QuarantineTest {
  reportFormVersion?: number;
  reportMaterial?: string;
  reportSpecimenState?: string;
  id: string;
  batchId: string;
  method: QuarantineMethod;
  samplingDate: string;
  testDate: string;
  conclusion: string;
  notes: string;
  samples: QuarantineSample[];
  projects: QuarantineProject[];
  state: "draft" | "issued";
  updatedAt: string;
  retestOf: string;
  correctionOf: string;
}
export interface QuarantineAttachment {
  id: string;
  testId: string;
  name: string;
  sampleId: string;
  projectId: string;
  projectIds?: string[];
  caption?: string;
  position?: number;
  uploadedAt?: string;
  removed?: boolean;
  category: string;
  mime: string;
  uploadedBy: { id: string; name: string };
  updatedAt: string;
}
export interface QuarantineReport {
  id: string;
  testId: string;
  number: string;
  version: number;
  updatedAt: string;
  issuedBy: { id: string; name: string };
  templateVersion: string;
}
export interface QuarantineDetail {
  completionReasons: string[];
  item: QuarantineBatch;
  tests: QuarantineTest[];
  attachments: QuarantineAttachment[];
  reports: QuarantineReport[];
}
export interface QuarantinePage<T> {
  items: T[];
  page: { total: number; offset: number; limit: number; hasMore: boolean };
}
export interface SupplierHistory {
  supplier: string;
  method: QuarantineMethod;
  retest: boolean;
  intakeCount: number;
  batchCount: number;
  poolCount: number;
  portionCount: number;
  confirmed: number;
  pending: number;
  resolved: number;
  normal: number;
  incomplete: number;
  details: {
    batchId: string;
    batchName: string;
    testId: string;
    testDate: string;
    status: string;
    sharedPools: boolean;
  }[];
}
