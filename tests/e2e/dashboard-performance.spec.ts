import type { DashboardOverviewResponse } from "../../src/react/api/dashboardOverview";
import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures";
import { installDashboardPlotProbe, readDashboardPlotCalls } from "./dashboardPlotProbe";
import { contrastFromLayers } from "./uiAudit";

type DashboardText = { color: string; opacity: string };
type DashboardTextWindow = Window & {
  readDashboardText?: (canvas: HTMLCanvasElement, mode: string) => Record<string, DashboardText>;
};

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

test("dashboard plots draw readable text after live theme changes", async ({ page }, info) => {
  await page.addInitScript(() => {
    const drawings = new WeakMap<HTMLCanvasElement, Map<string, DashboardText>>();
    // eslint-disable-next-line @typescript-eslint/unbound-method -- Forwarded with the original canvas context via apply.
    const fillText = CanvasRenderingContext2D.prototype.fillText;
    const swatch = document.createElement("span").style;
    CanvasRenderingContext2D.prototype.fillText = function (...args) {
      if (typeof this.fillStyle === "string" && this.canvas.closest(".ant-dashboard-section")) {
        let drawing = drawings.get(this.canvas);
        if (!drawing) {
          drawing = new Map();
          drawings.set(this.canvas, drawing);
        }
        swatch.color = this.fillStyle;
        drawing.set(`${document.documentElement.dataset.theme}:${args[0]}`, {
          color: swatch.color,
          opacity: String(this.globalAlpha),
        });
      }
      fillText.apply(this, args);
    };
    (window as DashboardTextWindow).readDashboardText = (canvas, mode) =>
      Object.fromEntries(
        [...(drawings.get(canvas) ?? [])]
          .filter(([key]) => key.startsWith(`${mode}:`))
          .map(([key, style]) => [key.slice(mode.length + 1), style]),
      );
  });
  await page.emulateMedia({ colorScheme: "light" });
  await page.setViewportSize({ width: 1440, height: 1400 });
  const data = overview();
  data.intake.trend.push({ day: 12, batches: 1, animals: 3 });
  data.intake.strains = [
    { strain: "合成品系甲", animals: 4 },
    { strain: "合成品系乙", animals: 1 },
  ];
  await page.route("**/api/dashboard/overview*", (route) => route.fulfill({ json: data }));
  await login(page);

  const plots = [
    { selector: ".ant-dashboard-pie canvas", labels: ["80%", "20%", "合成品系甲", "合成品系乙"] },
    { selector: ".ant-dashboard-trend canvas", labels: ["12"] },
    { selector: ".ant-dashboard-room-area canvas", labels: ["合成房间"] },
  ];
  await page.locator(".ant-dashboard-room-area").scrollIntoViewIfNeeded();
  for (const mode of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: mode });
    await expect(page.locator("html")).toHaveAttribute("data-theme", mode);
    for (const { selector, labels } of plots) {
      const canvas = page.locator(selector);
      await expect(canvas).toBeVisible();
      await expect
        .poll(
          async () => {
            const { drawing, background } = await canvas.evaluate(
              (element: HTMLCanvasElement, currentMode) => ({
                drawing: (window as DashboardTextWindow).readDashboardText?.(element, currentMode) ?? {},
                background: getComputedStyle(element.closest(".ant-dashboard-section")!).backgroundColor,
              }),
              mode,
            );
            return Math.min(
              ...labels.map((label) => (drawing[label] ? contrastFromLayers([{ ...drawing[label], background }]) : 0)),
            );
          },
          { message: `${mode} chart text contrast for ${labels.join(", ")}` },
        )
        .toBeGreaterThanOrEqual(4.5);
    }
  }
  await page
    .locator(".ant-dashboard-section")
    .filter({ hasText: "品系分布" })
    .screenshot({
      path: info.outputPath("dark-strain-distribution.png"),
      animations: "disabled",
    });
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
