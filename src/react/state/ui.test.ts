import { describe, expect, it, vi } from "vitest";

import { uiReducer, type UiState } from "./ui";

describe("uiReducer", () => {
  it("changes view without modifying unrelated shell state", () => {
    const state = {
      activeView: "dashboard" as const,
      sidebarCollapsed: true,
      settingsExpanded: false,
      theme: "system" as const,
    };
    expect(uiReducer(state, { type: "navigate", view: "billing-quantity-entry" })).toEqual({
      activeView: "billing-quantity-entry",
      sidebarCollapsed: true,
      settingsExpanded: false,
      theme: "system",
    });
  });

  it("returns the same state for unchanged navigation, settings and theme", () => {
    const state: UiState = {
      activeView: "dashboard",
      sidebarCollapsed: false,
      settingsExpanded: false,
      theme: "system",
    };
    expect(uiReducer(state, { type: "navigate", view: "dashboard" })).toBe(state);
    expect(uiReducer(state, { type: "set-settings", expanded: false })).toBe(state);
    expect(uiReducer(state, { type: "set-theme", theme: "system" })).toBe(state);
  });

  it("keeps the reducer pure when changing theme", () => {
    const write = vi.spyOn(localStorage, "setItem");
    const state: UiState = {
      activeView: "dashboard",
      sidebarCollapsed: false,
      settingsExpanded: false,
      theme: "system",
    };
    try {
      expect(uiReducer(state, { type: "set-theme", theme: "dark" }).theme).toBe("dark");
      expect(write).not.toHaveBeenCalled();
    } finally {
      write.mockRestore();
    }
  });
});
