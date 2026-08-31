import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  clearUiStorage,
  persistThemePreference,
  persistWorkspaceView,
  readStoredThemePreference,
  readStoredWorkspaceView,
} from "./uiStorage";

describe("UI preference storage", () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => vi.restoreAllMocks());

  it("stores only the active React workspace", () => {
    persistWorkspaceView("billing-quantity-entry");
    expect(JSON.parse(localStorage.getItem("cageledger.ui.v2") || "{}")).toEqual({
      activeView: "billing-quantity-entry",
    });
  });

  it("migrates legacy combined workspaces to their primary child page", () => {
    localStorage.setItem("cageledger.ui.v2", JSON.stringify({ activeView: "billing" }));
    expect(readStoredWorkspaceView()).toBe("billing-quantity-entry");
  });

  it("migrates the active view and clears the legacy business snapshot", () => {
    localStorage.setItem("cageledger.v1", JSON.stringify({ activeView: "rooms", quantitySheets: [{ id: "legacy" }] }));
    expect(readStoredWorkspaceView()).toBe("rooms");
    expect(localStorage.getItem("cageledger.v1")).toBeNull();
    expect(JSON.parse(localStorage.getItem("cageledger.ui.v2") || "{}")).toEqual({ activeView: "rooms" });
  });

  it("falls back to the dashboard for unknown legacy views", () => {
    localStorage.setItem("lahcas.v1", JSON.stringify({ activeView: "removed-view" }));
    expect(readStoredWorkspaceView()).toBe("dashboard");
    clearUiStorage();
    expect(localStorage.length).toBe(0);
  });

  it.each(["null", "[]", '"invalid"', "123", "{"])("recovers from malformed preferences: %s", (raw) => {
    localStorage.setItem("cageledger.ui.v2", raw);
    expect(readStoredThemePreference()).toBe("system");
    expect(readStoredWorkspaceView()).toBe("dashboard");
    persistWorkspaceView("rooms");
    expect(readStoredWorkspaceView()).toBe("rooms");
  });

  it("repairs invalid JSON on write without requiring a read first", () => {
    localStorage.setItem("cageledger.ui.v2", "{");
    persistThemePreference("dark");
    expect(readStoredThemePreference()).toBe("dark");
  });

  it("preserves the other preference when updating a single field", () => {
    persistThemePreference("dark");
    persistWorkspaceView("rooms");
    expect(readStoredThemePreference()).toBe("dark");
    persistThemePreference("light");
    expect(readStoredWorkspaceView()).toBe("rooms");
  });

  it("keeps startup and recovery usable when every storage operation is denied", () => {
    const denied = () => {
      throw new DOMException("Storage access denied", "SecurityError");
    };
    vi.spyOn(localStorage, "getItem").mockImplementation(denied);
    vi.spyOn(localStorage, "setItem").mockImplementation(denied);
    vi.spyOn(localStorage, "removeItem").mockImplementation(denied);
    expect(readStoredWorkspaceView()).toBe("dashboard");
    expect(readStoredThemePreference()).toBe("system");
    expect(() => persistWorkspaceView("rooms")).not.toThrow();
    expect(() => persistThemePreference("dark")).not.toThrow();
    expect(clearUiStorage).not.toThrow();
  });

  it("handles a denied localStorage property getter", () => {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      get() {
        throw new DOMException("Storage access denied", "SecurityError");
      },
    });
    try {
      expect(readStoredWorkspaceView()).toBe("dashboard");
      expect(readStoredThemePreference()).toBe("system");
      expect(clearUiStorage).not.toThrow();
    } finally {
      if (descriptor) Object.defineProperty(globalThis, "localStorage", descriptor);
    }
  });
});
