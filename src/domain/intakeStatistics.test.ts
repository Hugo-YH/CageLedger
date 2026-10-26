import { describe, expect, it } from "vitest";

import type { IntakeBatch } from "../contracts/intake";
import { createIntakeDraft } from "./intake";
import { buildIntakeStatistics, intakeStatisticsText, resolveStatisticsPrincipal } from "./intakeStatistics";

function batch(id: string, values: Partial<IntakeBatch> = {}): IntakeBatch {
  return {
    ...createIntakeDraft("测试"),
    id,
    batchNo: id,
    intakeDate: "2026-10-10",
    roomName: "8014",
    iacuc: "Z2026001",
    pi: "旧笼卡负责人",
    finalCardCount: 5,
    ...values,
  };
}
const principals = { Z2026001: { pi: "负责人甲" }, Z2026002: { pi: "负责人甲" }, Z2026003: { pi: "负责人乙" } };

describe("selected intake statistics", () => {
  it("deduplicates selection and totals final card counts by date, room and current summary PI", () => {
    const first = batch("first", {
      confirmedCardCount: 3,
      remainingCardCount: 2,
      quantity: 100,
      suggestedCardCount: 20,
    });
    const report = buildIntakeStatistics(
      [
        first,
        batch("second", { iacuc: "Z2026002", finalCardCount: 7, status: "received" }),
        batch("other-room", { roomName: "8015", finalCardCount: 2 }),
        batch("other-date", { intakeDate: "2026-10-11", iacuc: "Z2026003", finalCardCount: 4 }),
        first,
      ],
      principals,
    );
    expect(report.batches).toBe(4);
    expect(report.cages).toBe(18);
    expect(report.days.map((day) => [day.date, day.cages])).toEqual([
      ["2026-10-10", 14],
      ["2026-10-11", 4],
    ]);
    expect(report.days[0].rooms.map((room) => [room.name, room.cages])).toEqual([
      ["8014", 12],
      ["8015", 2],
    ]);
    expect(report.days[0].rooms[0].people).toMatchObject([{ pi: "负责人甲", batches: 2, cages: 12 }]);
    expect(report.issues).toEqual([]);
    const text = intakeStatisticsText(report);
    expect(text).toContain("2026年10月10日　14 笼");
    expect(text).toContain("- 负责人甲　12 笼（2 批）");
    expect(text).not.toContain("旧笼卡负责人");
    expect(text).not.toContain("\t");
  });

  it("counts direct sampling animals independently even if a historic card count remains", () => {
    const report = buildIntakeStatistics(
      [
        batch("housing"),
        batch("direct", { intakePurpose: "direct_sampling", finalCardCount: 50, quantity: 8, roomName: "" }),
        batch("direct-unknown", { intakePurpose: "direct_sampling", quantity: null, roomName: "" }),
      ],
      principals,
    );
    expect(report).toMatchObject({ cages: 5, samplingBatches: 2, animals: 8, unknownAnimals: 1, batches: 3 });
    expect(report.days[0].rooms).toHaveLength(1);
    expect(report.days[0].sampling).toMatchObject([{ pi: "负责人甲", batches: 2, animals: 8 }]);
    expect(report.issues).toHaveLength(1);
    expect(intakeStatisticsText(report)).toContain("直接取材　2 批｜8 只（另有 1 批数量待确认）（不计笼数）");
  });

  it("keeps unresolved dates, rooms, PIs and cage counts visible rather than inferring or discarding", () => {
    const report = buildIntakeStatistics(
      [
        batch("invalid", {
          intakeDate: "2026-02-30",
          roomName: "",
          iacuc: "",
          finalCardCount: 0,
          suggestedCardCount: 9,
        }),
        batch("missing-project", { iacuc: "UNKNOWN", finalCardCount: 3 }),
        batch("conflict", { iacuc: "CONFLICT", finalCardCount: -2 }),
      ],
      { CONFLICT: { pi: "", issue: "项目负责人匹配不唯一" } },
    );
    expect(report).toMatchObject({ batches: 3, cages: 3, unknownCages: 2 });
    expect(report.days.at(-1)?.date).toBe("");
    expect(report.issues).toHaveLength(3);
    const text = intakeStatisticsText(report);
    expect(text).toContain("饲养间未填写");
    expect(text).toContain("接收日期待确认");
    expect(text).toContain("另有 2 批笼数待确认");
    expect(text).toContain("项目负责人待确认（UNKNOWN）");
    expect(text).toContain("项目负责人匹配不唯一");
    expect(text).not.toContain("旧笼卡负责人");
  });

  it("allows identical PI duplicates, but rejects conflicting, incomplete, truncated or prefix-only matches", () => {
    const project = { iacuc: "Z2026001", pi: "负责人甲", owner: "", project: "", funding: "" };
    expect(resolveStatisticsPrincipal("Z2026001", { items: [project, project] })).toEqual({ pi: "负责人甲" });
    for (const response of [
      { items: [{ ...project, iacuc: "Z20260010" }] },
      { items: [{ ...project, pi: "" }] },
      { items: [project, { ...project, pi: "负责人乙" }] },
      { items: [project], count: 81 },
    ])
      expect(resolveStatisticsPrincipal("Z2026001", response)).toMatchObject({ pi: "", issue: expect.any(String) });
  });
});
