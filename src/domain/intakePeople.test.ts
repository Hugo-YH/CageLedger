import { describe, expect, it } from "vitest";
import { intakePeople } from "./intakePeople";

describe("intake people source priority", () => {
  const parsed = { iacuc: "Z1", pi: "图片负责人", owner: "图片实验负责人" };
  const matched = { pi: "陈晓卿", owner: "工作人员甲" };
  it("retains manually supplemented raw names for the same project", () => {
    expect(intakePeople({ iacuc: " z1 ", pi: "陈晓卿；李壮", owner: "工作人员甲/乙" }, parsed, matched)).toEqual({
      pi: "陈晓卿；李壮",
      owner: "工作人员甲/乙",
    });
  });
  it("uses the matched people for a different project, with image fallback", () => {
    const current = { iacuc: "Z2", pi: "上一项目", owner: "上一实验负责人" };
    expect(intakePeople(current, parsed, matched)).toEqual(matched);
    expect(intakePeople(current, parsed)).toEqual({ pi: parsed.pi, owner: parsed.owner });
  });
});
