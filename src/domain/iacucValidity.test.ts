import { describe, expect, it } from "vitest";
import { iacucExpiryStatus, iacucValidityStatus } from "./iacucValidity";

const today = "2026-10-19";
const valid = { projectStartDate: "2026-01-01", projectEndDate: "2028-12-31" };

describe("IACUC validity reminders", () => {
  it.each([
    ["2026-10-18", "error"],
    ["2026-10-19", "warning"],
    ["2027-01-17", "warning"],
    ["2027-01-18", "blue"],
  ])("shares saved-list expiry colors for %s", (end, color) => {
    expect(iacucExpiryStatus(end, today).color).toBe(color);
    expect(iacucValidityStatus({ ...valid, projectEndDate: end }, "2026-10", today).color).toBe(color);
  });

  it.each([
    undefined,
    {},
    { projectEndDate: "2028-12-31" },
    { projectStartDate: "2026-01-01" },
    { projectStartDate: "2026-02-30", projectEndDate: "2028-12-31" },
    { projectStartDate: "2028-01-01", projectEndDate: "2026-01-01" },
  ])("flags missing, invalid or inverted ranges", (application) => {
    expect(iacucValidityStatus(application, "2026-10", today).color).toBe("error");
  });

  it("checks the selected month even when the project is already active today", () => {
    const application = { ...valid, projectStartDate: "2026-10-09" };
    expect(iacucValidityStatus(application, "2026-09", today).label).toContain("早于");
    expect(iacucValidityStatus(application, "2026-10", today).color).toBe("blue");
    expect(iacucValidityStatus(application, "2029-01", today).label).toContain("晚于");
  });

  it("flags not-yet-started projects and accepts the start date itself", () => {
    const application = { ...valid, projectStartDate: "2026-10-20" };
    expect(iacucValidityStatus(application, "2026-10", today).label).toContain("尚未生效");
    expect(iacucValidityStatus(application, "2026-10", "2026-10-20").color).toBe("blue");
  });

  it("normalizes legacy slash dates and rejects impossible expiry dates", () => {
    expect(
      iacucValidityStatus({ projectStartDate: "2026/1/1", projectEndDate: "2028/12/31" }, "2026-10", today).color,
    ).toBe("blue");
    expect(iacucExpiryStatus("2026-13-01", today).color).toBe("error");
  });
});
