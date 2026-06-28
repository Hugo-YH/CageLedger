import { beforeEach, describe, expect, it } from "vitest";

import { clearUiStorage, persistWorkspaceView, readStoredWorkspaceView } from "./uiStorage";

describe("UI preference storage", () => {
  beforeEach(() => localStorage.clear());

  it("stores only the active React workspace", () => {
    persistWorkspaceView("billing");
    expect(JSON.parse(localStorage.getItem("cageledger.ui.v2") || "{}")).toEqual({ activeView: "billing" });
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
});
