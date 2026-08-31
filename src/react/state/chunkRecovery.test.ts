import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { claimChunkRecovery, clearChunkRecovery } from "./chunkRecovery";

const error = new Error("Failed to fetch dynamically imported module");

describe("chunk recovery", () => {
  beforeEach(() => sessionStorage.clear());
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("allows at most one reload within the recovery window", () => {
    expect(claimChunkRecovery(error, 100_000)).toBe(true);
    expect(claimChunkRecovery(error, 101_000)).toBe(false);
    expect(claimChunkRecovery(error, 130_000)).toBe(true);
  });

  it("never automatically reloads for a normal render error", () => {
    expect(claimChunkRecovery(new Error("Unexpected value"))).toBe(false);
    expect(sessionStorage.length).toBe(0);
  });

  it("lets the user explicitly reset the recovery guard", () => {
    expect(claimChunkRecovery(error, 100_000)).toBe(true);
    clearChunkRecovery();
    expect(claimChunkRecovery(error, 101_000)).toBe(true);
  });

  it.each(["getItem", "setItem"] as const)("does not reload when %s is unavailable", (method) => {
    vi.stubGlobal("sessionStorage", {
      getItem: () => null,
      setItem: () => {},
      [method]: () => {
        throw new DOMException("Denied", "SecurityError");
      },
    });
    expect(claimChunkRecovery(error)).toBe(false);
  });

  it("keeps manual recovery working if removal fails", () => {
    vi.stubGlobal("sessionStorage", {
      removeItem: () => {
        throw new DOMException("Denied", "SecurityError");
      },
    });
    expect(clearChunkRecovery).not.toThrow();
  });
});
