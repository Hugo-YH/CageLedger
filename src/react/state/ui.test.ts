import { describe, expect, it } from "vitest";

import { uiReducer } from "./ui";

describe("uiReducer", () => {
  it("changes view without modifying unrelated shell state", () => {
    const state = { activeView: "dashboard" as const, sidebarCollapsed: true, settingsExpanded: false };
    expect(uiReducer(state, { type: "navigate", view: "billing-quantity-entry" })).toEqual({
      activeView: "billing-quantity-entry",
      sidebarCollapsed: true,
      settingsExpanded: false,
    });
  });
});
