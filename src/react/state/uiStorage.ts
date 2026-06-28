import type { WorkspaceView } from "./uiTypes";

const UI_STORAGE_KEY = "cageledger.ui.v2";
const LEGACY_STORAGE_KEYS = ["cageledger.v1", "lahcas.v1"];
const WORKSPACE_VIEWS = new Set<WorkspaceView>(["dashboard", "cages", "intake", "cage-card-scanner", "billing", "workflow-center", "rooms", "data", "system", "users", "logs"]);

export function readStoredWorkspaceView(): WorkspaceView {
  const current = readView(UI_STORAGE_KEY);
  if (current) return current;
  const migrated = LEGACY_STORAGE_KEYS.map(readView).find(Boolean);
  if (migrated) persistWorkspaceView(migrated);
  clearLegacyBusinessState();
  return migrated || "dashboard";
}

export function persistWorkspaceView(activeView: WorkspaceView) {
  localStorage.setItem(UI_STORAGE_KEY, JSON.stringify({ activeView }));
}

export function clearUiStorage() {
  localStorage.removeItem(UI_STORAGE_KEY);
  clearLegacyBusinessState();
}

function readView(key: string): WorkspaceView | null {
  try {
    const raw = localStorage.getItem(key);
    const value = raw ? (JSON.parse(raw) as { activeView?: unknown }).activeView : "";
    return typeof value === "string" && WORKSPACE_VIEWS.has(value as WorkspaceView) ? value as WorkspaceView : null;
  } catch {
    localStorage.removeItem(key);
    return null;
  }
}

function clearLegacyBusinessState() {
  LEGACY_STORAGE_KEYS.forEach((key) => localStorage.removeItem(key));
}
