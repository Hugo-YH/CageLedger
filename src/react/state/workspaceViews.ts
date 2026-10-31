import {
  DEFAULT_SYSTEM_FEATURE_FLAGS,
  type SystemFeatureKey,
  type SystemFeatures,
} from "../../contracts/systemFeatures";

export const WORKSPACE_VIEW_MODULES = {
  dashboard: null,
  "reception-list": "reception",
  "intake-entry": "intake",
  "intake-batches": "intake",
  "cage-card-scanner": "intake",
  "quarantine-batches": "quarantine",
  "quarantine-parasite": "quarantine",
  "quarantine-elisa": "quarantine",
  "quarantine-pcr": "quarantine",
  "quarantine-reports": "quarantine",
  cages: "cages",
  "animal-inspection-entry": "animal",
  "animal-inspection-findings": "animal",
  "animal-inspection-records": "animal",
  "animal-inspection-standards": "animal",
  "technical-service-entry": "technical-services",
  "technical-service-saved": "technical-services",
  "technical-service-settlement": "settlement",
  "billing-cage-map": "billing",
  "billing-quantity-entry": "billing",
  "billing-quantity-saved": "billing",
  "billing-settlement": "settlement",
  "billing-monthly-summary": "settlement",
  "workflow-center": "settlement",
  feedback: null,
  rooms: null,
  data: null,
  "data-quality": null,
  "system-features": null,
  system: null,
  users: null,
  logs: null,
} as const satisfies Record<string, SystemFeatureKey | null>;

export type WorkspaceView = keyof typeof WORKSPACE_VIEW_MODULES;

export function isWorkspaceView(value: string): value is WorkspaceView {
  return Object.hasOwn(WORKSPACE_VIEW_MODULES, value);
}

export function isViewVisible(view: WorkspaceView, enabled: SystemFeatures["enabled"]) {
  const module = WORKSPACE_VIEW_MODULES[view];
  return module === null || enabled[module];
}

export const DEFAULT_FEATURE_VISIBILITY = DEFAULT_SYSTEM_FEATURE_FLAGS;
