export const STORAGE_KEY = "cageledger.v1";
export const LEGACY_STORAGE_KEY = "lahcas.v1";
export const VERSION_REFRESH_KEY = "cageledger.version-refresh";
export const CACHE_RESET_NOTICE_KEY = "cageledger.cache-reset-notice";
export const MAX_LOCAL_STATE_BYTES = 800_000;

export function readStoredState() {
  const raw = localStorage.getItem(STORAGE_KEY) || localStorage.getItem(LEGACY_STORAGE_KEY);
  if (!raw || raw.length > MAX_LOCAL_STATE_BYTES) return null;
  return JSON.parse(raw);
}

export function writeStoredState(payload) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
}

