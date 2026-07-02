import { describe, expect, it } from "vitest";
import { animalAgeText, animalSexLabel, cageCode, occupancyPeriodTone, slotPosition } from "./cages";

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

describe("monkey occupancy details", () => {
  it("calculates a stable age from birth and reference dates", () => {
    expect(animalAgeText("2024-01-15", "2026-07-02")).toBe("2岁5月");
    expect(animalAgeText("2026-05-20", "2026-07-02")).toBe("1月12天");
    expect(animalAgeText("2026-06-28", "2026-07-02")).toBe("4天");
  });

  it("rejects invalid or future birth dates", () => {
    expect(animalAgeText("2026-02-30", "2026-07-02")).toBe("");
    expect(animalAgeText("2027-01-01", "2026-07-02")).toBe("");
  });

  it("formats animal sex values", () => {
    expect(animalSexLabel("male")).toBe("雄");
    expect(animalSexLabel("female")).toBe("雌");
    expect(animalSexLabel(undefined)).toBe("未填写");
  });
});
