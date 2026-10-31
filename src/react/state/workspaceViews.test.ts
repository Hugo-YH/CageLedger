import { describe, expect, it } from "vitest";
import { SYSTEM_FEATURE_KEYS } from "../../contracts/systemFeatures";
import { DEFAULT_FEATURE_VISIBILITY, isViewVisible, isWorkspaceView, WORKSPACE_VIEW_MODULES } from "./workspaceViews";
import { persistWorkspaceView, readStoredWorkspaceView } from "./uiStorage";

describe("workspace feature visibility", () => {
  it("defaults to every business view enabled and preserves settings when every group is hidden", () => {
    expect(Object.keys(DEFAULT_FEATURE_VISIBILITY)).toEqual([...SYSTEM_FEATURE_KEYS]);
    const hidden = { ...DEFAULT_FEATURE_VISIBILITY };
    for (const key of SYSTEM_FEATURE_KEYS) hidden[key] = false;
    for (const [view, module] of Object.entries(WORKSPACE_VIEW_MODULES)) {
      expect(isWorkspaceView(view)).toBe(true);
      if (!isWorkspaceView(view)) throw new Error("unregistered view");
      expect(isViewVisible(view, DEFAULT_FEATURE_VISIBILITY)).toBe(true);
      expect(isViewVisible(view, hidden)).toBe(module === null);
    }
    expect(isViewVisible("system-features", hidden)).toBe(true);
    expect(isWorkspaceView("quantity-sheet-entry")).toBe(false);
  });

  it("hides reception independently without changing the cage-card group", () => {
    const hidden = { ...DEFAULT_FEATURE_VISIBILITY, reception: false };
    expect(isViewVisible("reception-list", hidden)).toBe(false);
    expect(isViewVisible("intake-entry", hidden)).toBe(true);
    expect(isViewVisible("intake-batches", hidden)).toBe(true);
  });

  it("keeps common settlements visible independently of each fee-entry group", () => {
    const hiddenFees = { ...DEFAULT_FEATURE_VISIBILITY, billing: false, "technical-services": false };
    expect(isViewVisible("billing-quantity-entry", hiddenFees)).toBe(false);
    expect(isViewVisible("technical-service-saved", hiddenFees)).toBe(false);
    for (const view of [
      "billing-settlement",
      "technical-service-settlement",
      "workflow-center",
      "billing-monthly-summary",
    ] as const) {
      expect(isViewVisible(view, hiddenFees)).toBe(true);
    }
  });

  it("uses the same view registry for navigation and persisted technical-service settings views", () => {
    for (const view of [
      "technical-service-entry",
      "technical-service-saved",
      "system-features",
      "reception-list",
    ] as const) {
      persistWorkspaceView(view);
      expect(readStoredWorkspaceView()).toBe(view);
    }
    localStorage.clear();
  });
});
