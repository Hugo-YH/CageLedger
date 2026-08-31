const CHUNK_RECOVERY_KEY = "cageledger.workspace.chunk-recovery-at";
const CHUNK_RECOVERY_WINDOW_MS = 30_000;

export function claimChunkRecovery(error: Error, now = Date.now()): boolean {
  if (!/chunkloaderror|loading chunk|dynamically imported module|module script/i.test(error.message)) return false;
  try {
    const lastRecoveryAt = Number(sessionStorage.getItem(CHUNK_RECOVERY_KEY) || 0);
    if (Number.isFinite(lastRecoveryAt) && now - lastRecoveryAt < CHUNK_RECOVERY_WINDOW_MS) return false;
    sessionStorage.setItem(CHUNK_RECOVERY_KEY, String(now));
    return true;
  } catch {
    // Without a durable reload guard, leave recovery to the user instead of risking a reload loop.
    return false;
  }
}

export function clearChunkRecovery() {
  try {
    sessionStorage.removeItem(CHUNK_RECOVERY_KEY);
  } catch {
    // A disabled browser store must not disable navigation out of the error screen.
  }
}
