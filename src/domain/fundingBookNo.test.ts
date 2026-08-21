import { describe, expect, it } from "vitest";

import {
  buildFundingBookOptions,
  extractFundingBookNo,
  reviewFundingBookNos,
  unverifiedFundingBookNos,
} from "./fundingBookNo";

describe("extractFundingBookNo", () => {
  it("提取显式标注的经费本编号", () => {
    expect(extractFundingBookNo("国自然（经费本编号：30309010012125）")).toBe("30309010012125");
    expect(extractFundingBookNo("课题配套（经费本编号：303090210502032）")).toBe("303090210502032");
    expect(extractFundingBookNo("科研经费（经费本编号：PT1001019）")).toBe("PT1001019");
    expect(extractFundingBookNo("广州市科技计划（经费本编号：3030901006095-01）")).toBe("3030901006095-01");
    expect(extractFundingBookNo("国家自然科学基金面上项目（经费本编号：3030902101310 ）")).toBe("3030902101310");
  });

  it("没有显式标注时回退到末尾经费本编号", () => {
    expect(extractFundingBookNo("五个五临床专科建设3030901010123")).toBe("3030901010123");
    expect(extractFundingBookNo("科研启动经费PT1001069")).toBe("PT1001069");
  });

  it("带项目编号或基金号标注时不误提取", () => {
    expect(extractFundingBookNo("国自然面上项目（项目编号：81870649）")).toBe("");
    expect(extractFundingBookNo("2018年国家重点研发计划（项目编号：2018YFA0108300）")).toBe("");
    expect(extractFundingBookNo("2020年国家自然科学基金 基金号：81870674")).toBe("");
  });

  it("无编号文本返回空字符串", () => {
    expect(extractFundingBookNo("横向项目")).toBe("");
    expect(extractFundingBookNo("五个五临床专科建设（经费本编号：")).toBe("");
    expect(extractFundingBookNo("")).toBe("");
  });

  it("构建选项时展示完整文本、值保存纯编号", () => {
    const options = buildFundingBookOptions(
      "国自然（经费本编号：30309010012125）、课题配套（经费本编号：303090210502032）",
    );
    expect(options).toEqual([
      { value: "30309010012125", label: "国自然（经费本编号：30309010012125）" },
      { value: "303090210502032", label: "课题配套（经费本编号：303090210502032）" },
    ]);
  });

  it("构建选项时按值去重", () => {
    const options = buildFundingBookOptions(
      "国自然（经费本编号：30309010012125）、国家自然科学基金（经费本编号：30309010012125）",
    );
    expect(options).toEqual([{ value: "30309010012125", label: "国自然（经费本编号：30309010012125）" }]);
  });

  it("仅返回项目负责人记录中不存在的人工经费本号", () => {
    expect(unverifiedFundingBookNos(["30309010012125", "MANUAL-1", "MANUAL-1", ""], ["30309010012125"])).toEqual([
      "MANUAL-1",
    ]);
  });

  it("区分本月伦理、同一负责人其他项目和未登记经费本", () => {
    expect(
      reviewFundingBookNos(
        ["111", "222", "333", "444"],
        ["111", "222"],
        [{ value: "333", label: "C 项目（经费本编号：333）" }],
      ),
    ).toEqual({
      otherProjectOptions: [{ value: "333", label: "C 项目（经费本编号：333）" }],
      unknownFundingBookNos: ["444"],
    });
  });
});
