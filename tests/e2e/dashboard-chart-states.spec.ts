import type { DashboardOverviewResponse } from "../../src/react/api/dashboardOverview";
import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures";

function overview(): DashboardOverviewResponse {
  return {
    month: "2026-09",
    availableMonths: ["2026-09", "2026-08"],
    intake: {
      month: "2026-09",
      batches: 0,
      animals: 0,
      trendUnit: "day",
      trend: [{ day: 1, batches: 0, animals: 0 }],
      strains: [],
      species: [],
    },
    rooms: [],
    pi: [],
    quantitySheetIacucCount: 0,
    feedingFeeTotal: { amount: 0, amountState: "ready" },
  };
}
async function login(page: Page) {
  await page.goto("/app");
  await page.getByLabel("用户名", { exact: true }).fill("admin");
  await page.getByLabel("密码", { exact: true }).fill("admin123");
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await expect(page.getByRole("button", { name: "退出登录", exact: true })).toBeVisible();
}

test("empty charts explain the successful no-record result at desktop and short windows", async ({ page }, info) => {
  await page.route("**/api/dashboard/overview*", (route) => route.fulfill({ json: overview() }));
  await page.setViewportSize({ width: 1440, height: 900 });
  await login(page);
  await expect(page.getByText("当前统计范围暂无接收记录", { exact: true })).toBeVisible();
  await expect(page.getByText("当前统计范围暂无品系统计", { exact: true })).toBeVisible();
  await page.locator(".ant-dashboard-room-area").scrollIntoViewIfNeeded();
  await expect(page.getByText("当前统计范围暂无笼位统计", { exact: true })).toBeVisible();
  await page.emulateMedia({ reducedMotion: "reduce" });
  for (const [width, height] of [
    [1440, 900],
    [1180, 820],
    [1180, 500],
    [844, 390],
  ]) {
    await page.setViewportSize({ width, height });
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    const name = `after-empty-charts-${width}x${height}`;
    const path = info.outputPath(`${name}.png`);
    await page.screenshot({ path, fullPage: true, animations: "disabled" });
    await info.attach(name, { path, contentType: "image/png" });
  }
  await expect(page.getByRole("alert")).toHaveCount(0);
});

test("real zero values and an empty room filter have different explanations", async ({ page }, info) => {
  const data = overview();
  data.intake.batches = 1;
  data.intake.trend = [{ day: 1, batches: 1, animals: 0 }];
  data.intake.strains = [{ strain: "测试品系", animals: 0 }];
  data.rooms = [
    {
      roomName: "零值房间",
      species: "mouse",
      cageDays: 0,
      amount: 0,
      unitPrice: 1,
      firstDay: 1,
      lastDay: 30,
      days: 30,
      trendUnit: "day",
      trend: [{ day: 1, cages: 0 }],
    },
    {
      roomName: "无趋势房间",
      species: "mouse",
      cageDays: 0,
      amount: 0,
      unitPrice: 1,
      firstDay: 1,
      lastDay: 30,
      days: 30,
      trendUnit: "day",
      trend: [],
    },
  ];
  await page.route("**/api/dashboard/overview*", (route) => route.fulfill({ json: data }));
  await login(page);
  await expect(page.getByText("当前统计范围暂无接收记录", { exact: true })).toHaveCount(0);
  await expect(page.getByText(/已记录 1 批接收，接收只数为 0/)).toBeVisible();
  await expect(page.getByText("已记录品系，接收只数均为 0", { exact: true })).toBeVisible();
  await page.locator(".ant-dashboard-room-area").scrollIntoViewIfNeeded();
  await expect(page.locator(".ant-dashboard-room-area .ant-dashboard-chart-empty")).toHaveCount(0);
  const select = page.getByRole("combobox", { name: "选择饲养间", exact: true });
  await select.click();
  await page.getByTitle("无趋势房间", { exact: true }).click();
  await expect(page.getByText("当前筛选下暂无笼位趋势记录", { exact: true })).toBeVisible();
  await expect(select).toBeFocused();
  const path = info.outputPath("after-zero-and-filter-empty.png");
  await page.screenshot({ path, fullPage: true, animations: "disabled" });
  await info.attach("zero-and-filter-empty", { path, contentType: "image/png" });
  await select.click();
  await page.keyboard.press("ArrowUp");
  await page.keyboard.press("ArrowUp");
  await page.keyboard.press("Enter");
  await expect(page.locator(".ant-dashboard-room-area .ant-dashboard-chart-empty")).toHaveCount(0);
});

test("request failure stays an error and recovered positive values remain charts", async ({ page }) => {
  let fail = true;
  const data = overview();
  data.intake.batches = 1;
  data.intake.animals = 5;
  data.intake.trend = [{ day: 1, batches: 1, animals: 5 }];
  data.intake.strains = [{ strain: "正常品系", animals: 5 }];
  await page.route("**/api/dashboard/overview*", (route) =>
    fail ? route.fulfill({ status: 503, json: { error: "隔离总览不可用" } }) : route.fulfill({ json: data }),
  );
  await login(page);
  await expect(page.getByText("运营数据加载失败", { exact: true })).toBeVisible();
  await expect(page.locator(".ant-dashboard-chart-empty")).toHaveCount(0);
  fail = false;
  await page.getByRole("button", { name: "重新加载", exact: true }).click();
  await expect(page.locator(".ant-dashboard-trend")).toBeVisible();
  await expect(page.locator(".ant-dashboard-trend .ant-dashboard-chart-empty")).toHaveCount(0);
  await expect(page.locator(".ant-dashboard-pie .ant-dashboard-chart-empty")).toHaveCount(0);
});
