import { describe, expect, it } from "vitest";
import { cageCode, occupancyPeriodTone, slotPosition } from "./cages";

describe("cage map domain", () => {
  const slot = { id: "s1", rackId: "r1", row: 2, col: 3, status: "empty" as const };
  it("formats stable rack positions", () => {
    expect(slotPosition(slot)).toBe("C2");
    expect(cageCode(slot, 2)).toBe("02-C2");
    expect(cageCode(slot, 2, "8014")).toBe("8014-02-C2");
  });
  it("classifies active feeding periods", () => {
    expect(
      occupancyPeriodTone(
        {
          id: "o1",
          slotId: "s1",
          cageCode: "",
          status: "active",
          iacuc: "",
          project: "",
          pi: "",
          owner: "",
          startDate: "2026-01-01",
          endDate: "",
          notes: "",
          updatedAt: "",
        },
        "2026-06-28",
      ),
    ).toBe("open");
  });
});
