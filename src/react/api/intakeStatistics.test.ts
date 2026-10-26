import { afterEach, expect, it, vi } from "vitest";

import { fetchIacucSearch } from "./iacuc";
import { fetchIntakeStatisticsPrincipals } from "./intakeStatistics";

vi.mock("./iacuc", () => ({ fetchIacucSearch: vi.fn() }));
afterEach(() => vi.resetAllMocks());

it("bounds project queries to three concurrent requests and records per-code failure without old names", async () => {
  let active = 0;
  let peak = 0;
  vi.mocked(fetchIacucSearch).mockImplementation(async (code) => {
    active += 1;
    peak = Math.max(peak, active);
    await new Promise((resolve) => setTimeout(resolve, 2));
    active -= 1;
    if (code === "Z4") throw new Error("network failure");
    return { items: [{ iacuc: code, pi: `汇总${code}`, owner: "", project: "", funding: "" }] };
  });
  const result = await fetchIntakeStatisticsPrincipals(["Z1", "Z2", "Z3", "Z4", "Z5"]);
  expect(peak).toBe(3);
  expect(fetchIacucSearch).toHaveBeenCalledTimes(5);
  expect(result.Z5).toEqual({ pi: "汇总Z5" });
  expect(result.Z4).toEqual({ pi: "", issue: "项目汇总表查询失败，请重新查询" });
});

it("stops queued lookups when the statistics window is abandoned", async () => {
  const controller = new AbortController();
  const cancelled = new DOMException("统计窗口已关闭", "AbortError");
  vi.mocked(fetchIacucSearch).mockImplementation(() => {
    controller.abort(cancelled);
    return Promise.reject(cancelled);
  });
  await expect(fetchIntakeStatisticsPrincipals(["Z1", "Z2", "Z3", "Z4"], controller.signal)).rejects.toBeDefined();
  expect(fetchIacucSearch).toHaveBeenCalledTimes(1);
});
