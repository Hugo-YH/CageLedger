export const DIAGNOSTIC_PAGES = [
  "overview",
  "cages",
  "intake",
  "quarantine",
  "animal-inspection",
  "billing",
  "workflows",
  "feedback",
  "settings",
  "scanner",
  "unknown",
] as const;

export const DIAGNOSTIC_RESOURCES = [
  "bootstrap",
  "state",
  "cages",
  "cage-cards",
  "rooms",
  "facilities",
  "users",
  "iacuc",
  "intake-batches",
  "placement-tasks",
  "quantity-sheets",
  "billing-statements",
  "billing-workflows",
  "settlement-candidates",
  "principal-identities",
  "reimbursements",
  "pdf-exports",
  "pdf-export-jobs",
  "quarantine",
  "quarantine-batches",
  "animal-inspections",
  "feedback",
  "system",
  ":other",
] as const;

export const DIAGNOSTIC_ROUTE_PARTS = [
  ":id",
  "summary",
  "preview",
  "pdf",
  "download",
  "export",
  "import",
  "filter-options",
  "integration",
  "retry",
  "sync",
  "comments",
  "attachments",
  "encounter",
  "environment",
  "performance-history",
  "catalog",
  "records",
  "reports",
  "draft",
  "publish",
  "versions",
  "complete",
  "cancel",
] as const;

export const DIAGNOSTIC_ERROR_TYPES = [
  "Error",
  "TypeError",
  "ReferenceError",
  "RangeError",
  "SyntaxError",
  "URIError",
  "EvalError",
  "ChunkLoadError",
  "ResourceError",
  "UnknownError",
] as const;

export type DiagnosticPage = (typeof DIAGNOSTIC_PAGES)[number];
export type DiagnosticEvent = {
  at: number;
  page: DiagnosticPage;
} & (
  | { kind: "navigation" }
  | { kind: "action"; action: "save" | "delete" | "download" }
  | {
      kind: "error";
      errorType: (typeof DIAGNOSTIC_ERROR_TYPES)[number];
      source: "runtime" | "promise" | "react" | "resource";
      line?: number;
      column?: number;
    }
  | {
      kind: "request";
      method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
      route: string;
      status: number;
      durationMs: number;
      requestId?: string;
    }
);

export interface FeedbackDiagnostics {
  schemaVersion: 1;
  capturedAt: number;
  windowSeconds: 300;
  events: DiagnosticEvent[];
}
