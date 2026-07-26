import type { WorkspaceView } from "./uiTypes";

const UI_STORAGE_KEY = "cageledger.ui.v2";
const LEGACY_STORAGE_KEYS = ["cageledger.v1", "lahcas.v1"];
const WORKSPACE_VIEWS = new Set<WorkspaceView>([
  "dashboard",
  "cages",
  "intake-entry",
  "intake-batches",
  "cage-card-scanner",
  "animal-inspection-entry",
  "animal-inspection-findings",
  "animal-inspection-records",
  "animal-inspection-standards",
  "billing-cage-map",
  "billing-quantity-entry",
  "billing-quantity-saved",
  "billing-settlement",
  "billing-monthly-summary",
  "workflow-center",
  "rooms",
  "data",
  "system",
  "users",
  "logs",
]);

export function readStoredWorkspaceView(): WorkspaceView {
  const current = readView(UI_STORAGE_KEY);
  if (current) return current;
  const migrated = LEGACY_STORAGE_KEYS.map(readView).find(Boolean);
  if (migrated) persistWorkspaceView(migrated);
  clearLegacyBusinessState();
  return migrated || "dashboard";
}

export type ThemePreference = "system" | "light" | "dark";

type StoredUiState = {
  activeView?: unknown;
  theme?: unknown;
};

export function readStoredThemePreference(): ThemePreference {
  try {
    const raw = localStorage.getItem(UI_STORAGE_KEY);
    const value = raw ? (JSON.parse(raw) as StoredUiState).theme : "";
    return value === "light" || value === "dark" || value === "system" ? value : "system";
  } catch {
    return "system";
  }
}

export function persistWorkspaceView(activeView: WorkspaceView) {
  persistUiState({ activeView });
}

export function persistThemePreference(theme: ThemePreference) {
  persistUiState({ theme });
}

export function clearUiStorage() {
  localStorage.removeItem(UI_STORAGE_KEY);
  clearLegacyBusinessState();
}

function readView(key: string): WorkspaceView | null {
  try {
    const raw = localStorage.getItem(key);
    const value = raw ? (JSON.parse(raw) as StoredUiState).activeView : "";
    if (value === "intake") return "intake-entry";
    if (value === "billing") return "billing-quantity-entry";
    return typeof value === "string" && WORKSPACE_VIEWS.has(value as WorkspaceView) ? (value as WorkspaceView) : null;
  } catch {
    localStorage.removeItem(key);
    return null;
  }
}

function persistUiState(update: Partial<{ activeView: WorkspaceView; theme: ThemePreference }>) {
  try {
    const raw = localStorage.getItem(UI_STORAGE_KEY);
    const current = raw ? (JSON.parse(raw) as StoredUiState) : {};
    localStorage.setItem(UI_STORAGE_KEY, JSON.stringify({ ...current, ...update }));
  } catch {
    // UI preferences remain optional when browser storage is unavailable.
  }
}

function clearLegacyBusinessState() {
  LEGACY_STORAGE_KEYS.forEach((key) => localStorage.removeItem(key));
}
