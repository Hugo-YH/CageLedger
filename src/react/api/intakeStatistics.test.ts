import { afterEach, expect, it, vi } from "vitest";

import { requestJson } from "./client";
import { fetchIntakeStatisticsPrincipals } from "./intakeStatistics";

vi.mock("./client", () => ({ requestJson: vi.fn() }));
afterEach(() => vi.resetAllMocks());

it("uses bounded batches of 200 exact codes and at most three requests at once", async () => {
  let active = 0;
  let peak = 0;
  const batches: string[][] = [];
  const controller = new AbortController();
  vi.mocked(requestJson).mockImplementation(async (url, options) => {
    expect(url).toBe("/api/iacuc-index/lookup");
    expect(options?.method).toBe("POST");
    expect(options?.signal).toBe(controller.signal);
    const { codes } = JSON.parse(String(options?.body)) as { codes: string[] };
    batches.push(codes);
    active += 1;
    peak = Math.max(peak, active);
    await new Promise((resolve) => setTimeout(resolve, 2));
    active -= 1;
    if (codes.includes("Z401")) throw new Error("network failure");
    return {
      items: codes.map((iacuc) => ({ iacuc, pi: `汇总${iacuc}` })),
      counts: Object.fromEntries(codes.map((code) => [code, 1])),
    };
  });
  const result = await fetchIntakeStatisticsPrincipals(
    Array.from({ length: 601 }, (_, index) => `Z${index + 1}`),
    controller.signal,
  );
  expect(peak).toBe(3);
  expect(batches.map((codes) => codes.length)).toEqual([200, 200, 200, 1]);
  expect(result.Z601).toEqual({ pi: "汇总Z601" });
  expect(result.Z401).toEqual({ pi: "", issue: "项目汇总表查询失败，请重新查询" });
  expect(result.Z600).toEqual(result.Z401);
});

it("normalizes codes and preserves missing, empty, conflicting and truncated-match semantics", async () => {
  vi.mocked(requestJson).mockResolvedValue({
    items: [
      ...Array.from({ length: 80 }, () => ({ iacuc: "Z1", pi: "同名" })),
      { iacuc: "Z3", pi: "" },
      { iacuc: "Z4", pi: "甲" },
      { iacuc: "Z4", pi: "乙" },
      { iacuc: " z5 ", pi: "正确负责人" },
    ],
    counts: { Z1: 81, Z2: 0, Z3: 1, Z4: 2, Z5: 1 },
  });
  const result = await fetchIntakeStatisticsPrincipals([" z1 ", "Z1", "", "Z2", "Z3", "Z4", "Z5"]);
  expect(JSON.parse(String(vi.mocked(requestJson).mock.calls[0][1]?.body))).toEqual({
    codes: ["Z1", "Z2", "Z3", "Z4", "Z5"],
  });
  expect(result.Z1.issue).toContain("不唯一");
  expect(result.Z2.issue).toContain("未找到");
  expect(result.Z3.issue).toContain("未填写");
  expect(result.Z4.issue).toContain("不唯一");
  expect(result.Z5).toEqual({ pi: "正确负责人" });
});

it("stops queued batches when the statistics window is abandoned", async () => {
  const controller = new AbortController();
  const cancelled = new DOMException("统计窗口已关闭", "AbortError");
  vi.mocked(requestJson).mockImplementation(() => {
    controller.abort(cancelled);
    return Promise.reject(cancelled);
  });
  await expect(
    fetchIntakeStatisticsPrincipals(
      Array.from({ length: 801 }, (_, index) => `Z${index}`),
      controller.signal,
    ),
  ).rejects.toBeDefined();
  expect(requestJson).toHaveBeenCalledOnce();
});

it("does not infer a usable match when the server omits exact match counts", async () => {
  vi.mocked(requestJson).mockResolvedValue({ items: [{ iacuc: "Z1", pi: "不能猜测" }], counts: {} });
  expect(await fetchIntakeStatisticsPrincipals(["Z1"])).toEqual({
    Z1: { pi: "", issue: "项目汇总表查询失败，请重新查询" },
  });
});
