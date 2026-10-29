import { describe, expect, it } from "vitest";
import { formatPersonNames, splitPersonNames } from "./personNames";

describe("person names", () => {
  it("splits supported delimiters, trims and deduplicates in order", () => {
    expect(splitPersonNames(" 陈晓卿；李壮 /陈晓卿\\王五，赵六|孙七｜周八／吴九＼郑十\n 张三\t李四 ")).toEqual([
      "陈晓卿",
      "李壮",
      "王五",
      "赵六",
      "孙七",
      "周八",
      "吴九",
      "郑十",
      "张三",
      "李四",
    ]);
    expect(formatPersonNames("陈晓卿；李壮、陈晓卿")).toBe("陈晓卿、李壮");
  });
  it("preserves spaces, middle dots and hyphens within names", () => {
    expect(splitPersonNames("Mary Jane、阿·布、Jean-Luc")).toEqual(["Mary Jane", "阿·布", "Jean-Luc"]);
  });
});
