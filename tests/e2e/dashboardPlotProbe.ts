import type { Page } from "@playwright/test";

export type DashboardPlotCalls = { creates: number; updates: number; renders: number; destroys: number };
type ProbeWindow = Window & { __dashboardPlotCalls?: DashboardPlotCalls };

/** Count real plots lifecycle calls in test-served dependency bytes, without changing the app or G2 behavior. */
export async function installDashboardPlotProbe(page: Page) {
  await page.addInitScript(() => {
    Object.defineProperty(window, "__dashboardPlotCalls", {
      configurable: true,
      value: { creates: 0, updates: 0, renders: 0, destroys: 0 },
    });
  });
  await page.route(/\/node_modules\/.*\/(?:makeChartComp[^/?]*|useChart)\.js(?:\?.*)?$/, async (route) => {
    const response = await route.fetch();
    let body = await response.text();
    const changes = [
      [
        "var chartInstance = new ChartClass",
        "globalThis.__dashboardPlotCalls.creates++; var chartInstance = new ChartClass",
      ],
      ["chart.current.update(config);", "globalThis.__dashboardPlotCalls.updates++; chart.current.update(config);"],
      ["chart.current.render();", "globalThis.__dashboardPlotCalls.renders++; chart.current.render();"],
      ["chartInstance.render();", "globalThis.__dashboardPlotCalls.renders++; chartInstance.render();"],
      ["chart.current.destroy();", "globalThis.__dashboardPlotCalls.destroys++; chart.current.destroy();"],
    ];
    for (const [before, after] of changes) {
      if (body.split(before).length !== 2) throw new Error(`Unexpected installed plots lifecycle source: ${before}`);
      body = body.replace(before, after);
    }
    await route.fulfill({ response, body });
  });
}

export function readDashboardPlotCalls(page: Page) {
  return page.evaluate(() => {
    const calls = (window as ProbeWindow).__dashboardPlotCalls;
    if (!calls) throw new Error("Dashboard plot probe was not installed");
    return { ...calls };
  });
}
