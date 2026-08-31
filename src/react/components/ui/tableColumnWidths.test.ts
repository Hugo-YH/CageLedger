import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { loadStoredWidths, persistColumnWidths, pixelWidth } from "./tableColumnWidths";

const key = "cageledger:table-column-widths:v1";

describe("table column widths", () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => vi.restoreAllMocks());

  it("validates persisted widths rather than trusting JSON", () => {
    localStorage.setItem(
      key,
      JSON.stringify({ intake: { name: 240, negative: -40, string: "120", huge: 9999, tiny: 2 }, other: [] }),
    );
    expect(loadStoredWidths("intake")).toEqual({ name: 240 });
    expect(loadStoredWidths("other")).toEqual({});
    expect(loadStoredWidths("toString")).toEqual({});
  });

  it.each(["null", "[]", "{"])("recovers from %s and preserves subsequent writes", (raw) => {
    localStorage.setItem(key, raw);
    expect(loadStoredWidths("intake")).toEqual({});
    persistColumnWidths("intake", { name: 220 });
    expect(loadStoredWidths("intake")).toEqual({ name: 220 });
  });

  it("merges the latest widths from different mounted tables", () => {
    persistColumnWidths("intake", { name: 220 });
    persistColumnWidths("billing", { name: 320 });
    persistColumnWidths("intake", { name: 260 });
    expect(loadStoredWidths("billing")).toEqual({ name: 320 });
    expect(loadStoredWidths("intake")).toEqual({ name: 260 });
  });

  it.each([120, "120", "120px", "120.5px", " 120px "])("recognizes pixel width %s", (value) => {
    expect(pixelWidth(value)).toBe(Number.parseFloat(String(value)));
  });

  it.each([undefined, 0, -1, Number.NaN, Infinity, "50%", "calc(100% - 20px)", "auto", "12rem"])(
    "does not convert relative or invalid width %s to pixels",
    (value) => {
      expect(pixelWidth(value)).toBeUndefined();
    },
  );
});
