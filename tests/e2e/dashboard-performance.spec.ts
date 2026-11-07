import type { DashboardOverviewResponse } from "../../src/react/api/dashboardOverview";
import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures";
import { installDashboardPlotProbe, readDashboardPlotCalls } from "./dashboardPlotProbe";

function chartRuntimeWasRequested() {
  return performance
    .getEntriesByType("resource")
    .some((entry) => /@ant-design[/_-]plots|makeChartComp/.test(entry.name));
}

function overview(month = "2026-09", positive = true): DashboardOverviewResponse {
  return {
    month,
    availableMonths: ["2026-09", "2026-08"],
    intake: {
      month,
      batches: positive ? 1 : 0,
      animals: positive ? 5 : 0,
      trendUnit: "day",
      trend: [{ day: 1, batches: positive ? 1 : 0, animals: positive ? 5 : 0 }],
      strains: positive ? [{ strain: "合成品系", animals: 5 }] : [],
      species: [],
    },
    rooms: positive
      ? [
          {
            roomName: "合成房间",
            species: "mouse",
            cageDays: 5,
            amount: 1,
            unitPrice: 1,
            firstDay: 1,
            lastDay: 30,
            days: 30,
            trendUnit: "day",
            trend: [{ day: 1, cages: 5 }],
          },
        ]
      : [],
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
  await expect(page.getByRole("heading", { name: "实验动物笼位管理与计费系统", exact: true })).toBeVisible();
}

async function chooseMonth(page: Page, number: "08" | "09") {
  await page.getByRole("combobox", { name: "选择统计月份", exact: true }).click();
  await page.getByTitle(`2026 年 ${number} 月`, { exact: true }).click();
  await expect(page.getByText(`当前统计月份：2026-${number}`, { exact: true })).toBeVisible();
}

test("dashboard requests the chart runtime only after a populated chart enters the viewport", async ({ page }) => {
  await page.route("**/api/dashboard/overview*", (route) => route.fulfill({ json: overview() }));
  await page.setViewportSize({ width: 1280, height: 360 });
  await page.goto("/app");
  await page.getByLabel("用户名", { exact: true }).fill("admin");
  await page.getByLabel("密码", { exact: true }).fill("admin123");
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await expect(page.getByRole("heading", { name: "实验动物笼位管理与计费系统", exact: true })).toBeVisible();

  await expect.poll(() => page.evaluate(chartRuntimeWasRequested)).toBe(false);

  await page.locator(".ant-dashboard-trend").scrollIntoViewIfNeeded();
  await expect.poll(() => page.evaluate(chartRuntimeWasRequested)).toBe(true);
});

test("dashboard chart cards do not introduce horizontal overflow at supported viewports", async ({ page }) => {
  await page.goto("/app");
  await page.getByLabel("用户名", { exact: true }).fill("admin");
  await page.getByLabel("密码", { exact: true }).fill("admin123");
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await expect(page.getByRole("heading", { name: "实验动物笼位管理与计费系统", exact: true })).toBeVisible();

  for (const viewport of [
    { width: 1280, height: 900 },
    { width: 1180, height: 820 },
    { width: 760, height: 900 },
    { width: 844, height: 390 },
  ]) {
    await page.setViewportSize(viewport);
    await expect(page.locator(".ant-dashboard-trend")).toBeVisible();
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth))
      .toBe(true);
  }
});

test("dashboard 304 refresh does not update or render stable real G2 plots", async ({ page }, info) => {
  await installDashboardPlotProbe(page);
  await page.setViewportSize({ width: 1440, height: 1400 });
  let requests = 0;
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/api/dashboard/overview*", async (route) => {
    requests += 1;
    if (requests === 1) {
      await route.fulfill({ json: overview(), headers: { ETag: '"fixed-overview"' } });
      return;
    }
    expect(route.request().headers()["if-none-match"]).toBe('"fixed-overview"');
    await gate;
    await route.fulfill({ status: 304, body: "", headers: { ETag: '"fixed-overview"' } });
  });
  await login(page);
  await page.locator(".ant-dashboard-room-area").scrollIntoViewIfNeeded();
  await expect.poll(async () => (await readDashboardPlotCalls(page)).creates).toBe(3);
  const before = await readDashboardPlotCalls(page);
  await page.clock.setFixedTime(new Date(Date.now() + 60_000));
  await page.evaluate(() => window.dispatchEvent(new Event("offline")));
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  await expect(page.getByText("正在更新，暂显示上次结果", { exact: true })).toBeVisible();
  expect(await readDashboardPlotCalls(page)).toEqual(before);
  release();
  await expect(page.getByText("正在更新，暂显示上次结果", { exact: true })).toBeHidden();
  expect(requests).toBe(2);
  expect(await readDashboardPlotCalls(page)).toEqual(before);
  await info.attach("real-g2-calls-before-after-304", {
    body: JSON.stringify({ before, after: await readDashboardPlotCalls(page), requests }),
    contentType: "application/json",
  });
});

test("initial empty charts create no G2 instances and populated charts survive later empty months", async ({
  page,
}, info) => {
  await installDashboardPlotProbe(page);
  await page.setViewportSize({ width: 1440, height: 1400 });
  await page.route("**/api/dashboard/overview*", (route) => {
    const month = new URL(route.request().url()).searchParams.get("month") || "2026-09";
    return route.fulfill({ json: overview(month, month === "2026-08") });
  });
  await login(page);
  await page.locator(".ant-dashboard-room-area").scrollIntoViewIfNeeded();
  await expect(page.getByText("当前统计范围暂无接收记录", { exact: true })).toBeVisible();
  await expect(page.getByText("当前统计范围暂无品系统计", { exact: true })).toBeVisible();
  await expect(page.getByText("当前统计范围暂无笼位统计", { exact: true })).toBeVisible();
  expect(await readDashboardPlotCalls(page)).toEqual({ creates: 0, updates: 0, renders: 0, destroys: 0 });
  expect(await page.evaluate(chartRuntimeWasRequested)).toBe(false);
  const geometry = await page
    .locator(".ant-dashboard-chart-frame")
    .evaluateAll((elements) => elements.map((element) => element.getBoundingClientRect().height));
  expect(geometry).toEqual([180, 280, 220]);
  await chooseMonth(page, "08");
  await page.locator(".ant-dashboard-room-area").scrollIntoViewIfNeeded();
  await expect.poll(async () => (await readDashboardPlotCalls(page)).creates).toBe(3);
  const populated = await readDashboardPlotCalls(page);
  await chooseMonth(page, "09");
  await expect(page.getByText("当前统计范围暂无接收记录", { exact: true })).toBeVisible();
  expect((await readDashboardPlotCalls(page)).creates).toBe(populated.creates);
  expect((await readDashboardPlotCalls(page)).destroys).toBe(0);
  await chooseMonth(page, "08");
  await expect(page.getByText("当前统计范围暂无接收记录", { exact: true })).toBeHidden();
  const restored = await readDashboardPlotCalls(page);
  expect(restored.creates).toBe(3);
  expect(restored.destroys).toBe(0);
  await info.attach("real-g2-empty-positive-empty-positive", {
    body: JSON.stringify({ geometry, populated, restored }),
    contentType: "application/json",
  });
});
