import { expect, test } from "./fixtures";

function chartRuntimeWasRequested() {
  return performance
    .getEntriesByType("resource")
    .some((entry) => /@ant-design[/_-]plots|makeChartComp/.test(entry.name));
}

test("dashboard requests the chart runtime only after a chart enters the viewport", async ({ page }) => {
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
