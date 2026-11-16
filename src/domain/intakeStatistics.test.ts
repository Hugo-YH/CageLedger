import { describe, expect, it } from "vitest";

import type { IntakeBatch } from "../contracts/intake";
import { createIntakeDraft } from "./intake";
import {
  buildIntakeStatistics,
  intakePlannedTransferDate,
  intakeStatisticsText,
  resolveStatisticsPrincipal,
} from "./intakeStatistics";

function batch(id: string, values: Partial<IntakeBatch> = {}): IntakeBatch {
  return {
    ...createIntakeDraft("测试"),
    id,
    batchNo: id,
    intakeDate: "2026-10-10",
    roomName: "8014",
    iacuc: "Z2026001",
    pi: "旧笼卡负责人",
    strainStandard: "C57BL/6J",
    quantity: 25,
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
    expect(text).toContain("预计转入：2026年10月12日");
    expect(text).toContain("饲养合计：共 175 只，18 笼");
    expect(text).toContain("- 负责人甲　共 125 只，12 笼");
    expect(text).toContain("伦理 Z2026001｜品系 C57BL/6J　共 100 只，5 笼");
    expect(text).not.toMatch(/\d+\s*批/);
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
    const text = intakeStatisticsText(report);
    expect(text).toContain("直接取材（不转入饲养间）\n合计：已知 8 只（另有只数待确认）");
    expect(text).toContain("预约接收：2026年10月10日");
    expect(text).toContain("饲养合计：共 25 只，5 笼");
    expect(text).not.toMatch(/\d+\s*批/);
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
    expect(text).toContain("预计转入日期待确认");
    expect(text).toContain("已知 3 笼（另有笼数待确认）");
    expect(text).toContain("项目负责人待确认（UNKNOWN）");
    expect(text).toContain("项目负责人匹配不唯一");
    expect(text).not.toContain("旧笼卡负责人");
    expect(text).not.toMatch(/\d+\s*批/);
  });

  it("merges one planned Monday by room, PI, exact IACUC and strain without changing appointment groups", () => {
    const report = buildIntakeStatistics(
      [
        batch("wed", { intakeDate: "2026-11-18", quantity: 15, finalCardCount: 3, strainRaw: "原始写法甲" }),
        batch("thu", { intakeDate: "2026-11-19", quantity: 10, finalCardCount: 2, strainRaw: "原始写法乙" }),
        batch("other-strain", { intakeDate: "2026-11-18", quantity: 10, finalCardCount: 2, strainStandard: "BALB/c" }),
        batch("other-iacuc", { intakeDate: "2026-11-18", quantity: 8, finalCardCount: 2, iacuc: "Z2026002" }),
        batch("other-room", { intakeDate: "2026-11-18", quantity: 6, finalCardCount: 1, roomName: "8015" }),
        batch("next-week", { intakeDate: "2026-11-25", quantity: 4, finalCardCount: 1 }),
      ],
      principals,
    );
    const before = JSON.stringify(report);
    const text = intakeStatisticsText(report);
    expect(text).toContain("饲养合计：共 53 只，11 笼");
    expect(text.match(/预计转入：2026年11月23日/g)).toHaveLength(1);
    expect(text).toContain("预计转入：2026年11月30日");
    expect(text).toContain("8014 饲养间　共 43 只，9 笼");
    expect(text).toContain(
      "伦理 Z2026001　共 35 只，7 笼\n    - 品系 BALB/c　共 10 只，2 笼\n    - 品系 C57BL/6J　共 25 只，5 笼",
    );
    expect(text).toContain("伦理 Z2026002｜品系 C57BL/6J　共 8 只，2 笼");
    expect(text).toContain("8015 饲养间　共 6 只，1 笼");
    expect(text).not.toContain("原始写法");
    expect(JSON.stringify(report)).toBe(before);
    expect(intakeStatisticsText(report)).toBe(text);
    expect(text).not.toMatch(/\d+\s*批/);
  });

  it.each([null, 0, -2, 1.5])(
    "keeps an undetermined housing animal quantity (%s) separate from known cages",
    (quantity) => {
      const report = buildIntakeStatistics(
        [batch("unknown-animals", { quantity, finalCardCount: 2, strainStandard: "-", strainRaw: "原始品系" })],
        principals,
      );
      expect(report).toMatchObject({ cages: 2, housingAnimals: 0, unknownHousingAnimals: 1, animals: 0 });
      const text = intakeStatisticsText(report);
      expect(text).toContain("伦理 Z2026001｜品系 原始品系　只数待确认，2 笼");
      expect(text).toContain("动物数量待确认");
      expect(text).not.toContain("0 只");
      expect(text).not.toMatch(/\d+\s*批/);
    },
  );

  it("preserves missing strain and quantities in a sampling-only briefing without inventing housing cages", () => {
    const report = buildIntakeStatistics(
      [
        batch("direct-only", {
          intakePurpose: "direct_sampling",
          intakeDate: "2026-11-18",
          quantity: null,
          finalCardCount: 99,
          strainStandard: "",
          strainRaw: "",
        }),
      ],
      principals,
    );
    const text = intakeStatisticsText(report);
    expect(text).toContain("本次未选择转入饲养间的动物。");
    expect(text).toContain("直接取材（不转入饲养间）");
    expect(text).toContain("预约接收：2026年11月18日");
    expect(text).toContain("伦理 Z2026001｜品系待确认　只数待确认");
    expect(text).not.toContain("99");
    expect(text).not.toContain("预计转入：");
    expect(text).not.toContain("0 只");
  });

  it.each([
    ["2026-11-16", "2026-11-23"],
    ["2026-11-18", "2026-11-23"],
    ["2026-11-22", "2026-11-23"],
    ["2026-12-30", "2027-01-04"],
    ["2028-02-23", "2028-02-28"],
    ["2026-02-30", ""],
    ["", ""],
  ])("plans the following calendar week's Monday from %s without timezone shifts", (date, monday) => {
    expect(intakePlannedTransferDate(date)).toBe(monday);
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
