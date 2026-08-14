import type { Page, TestInfo } from "@playwright/test";

import { expect, openQuantityEntry, openSettingsView, test } from "./fixtures";

test("remote workspace data uses the shared Ant skeleton while loading", async ({ page }) => {
  let releaseDashboardRequest: () => void = () => undefined;
  const dashboardRequest = new Promise<void>((resolve) => {
    releaseDashboardRequest = resolve;
  });
  await page.route("**/api/dashboard/overview**", async (route) => {
    await dashboardRequest;
    await route.continue();
  });

  await page.goto("/app");
  await page.getByLabel("用户名", { exact: true }).fill("admin");
  await page.getByLabel("密码", { exact: true }).fill("admin123");
  await page.getByRole("button", { name: "登录", exact: true }).click();

  const skeleton = page.locator("[data-ui='page-skeleton']");
  await expect(skeleton).toBeVisible();
  await expect(skeleton).toHaveAttribute("aria-busy", "true");
  await expect(skeleton).toContainText("运营总览正在加载");

  releaseDashboardRequest();
  await expect(page.getByRole("heading", { name: "实验动物笼位管理与计费系统", exact: true })).toBeVisible();
});

test("quantity workspace keeps its desktop and mobile layout contract", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/app");
  await page.getByLabel("用户名", { exact: true }).fill("admin");
  await page.getByLabel("密码", { exact: true }).fill("admin123");
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await openQuantityEntry(page);

  const editor = page.locator(".quantity-entry-panel");
  const entryTable = page.locator(".quantity-entry-table");
  await expect(page.getByRole("heading", { name: "录入数量统计表", exact: true })).toBeVisible();
  await expect(editor).toBeVisible();
  await expect(entryTable).toBeVisible();
  await expect(entryTable.locator("thead th")).toHaveCount(10);
  await expect(entryTable.locator(".ant-input").first()).toBeVisible();
  await expect(entryTable.locator(".ant-select").first()).toHaveCount(1);
  await expect(page.locator(".quantity-entry-wrap")).toHaveCSS("max-height", "none");
  await attachViewport(page, testInfo, "quantity-1280");

  await page.setViewportSize({ width: 1180, height: 820 });
  await expect(editor).toBeVisible();
  await expect(page.getByRole("button", { name: "保存统计表", exact: true })).toBeVisible();
  await attachViewport(page, testInfo, "quantity-1180");

  await page.setViewportSize({ width: 760, height: 900 });
  await expect(page.getByRole("button", { name: "保存统计表", exact: true })).toBeVisible();
  await expect(page.locator(".quantity-entry-wrap")).toHaveCSS("overflow-x", "auto");
  await attachViewport(page, testInfo, "quantity-760");

  await page.setViewportSize({ width: 844, height: 390 });
  await expect(page.getByRole("button", { name: "保存统计表", exact: true })).toBeVisible();
  await attachViewport(page, testInfo, "quantity-landscape");
});

test("dashboard follows the system dark theme contract", async ({ page }, testInfo) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/app");
  await page.getByLabel("用户名", { exact: true }).fill("admin");
  await page.getByLabel("密码", { exact: true }).fill("admin123");
  await page.getByRole("button", { name: "登录", exact: true }).click();

  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await attachViewport(page, testInfo, "dashboard-dark-1280");
});

test("primary actions and selected navigation use the official Ant Design blue", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/app");
  await page.getByLabel("用户名", { exact: true }).fill("admin");
  await page.getByLabel("密码", { exact: true }).fill("admin123");
  await page.getByRole("button", { name: "登录", exact: true }).click();

  await expect(page.locator("html")).toHaveCSS("--primary", "#1677ff");
  await expect(page.locator("html")).toHaveCSS("--button-primary", "#1677ff");
  await page.getByRole("menuitem", { name: /笼位管理/ }).click();
  await expect(page.getByRole("main")).toContainText(/动态笼位图|尚未创建饲养间/);
});

test("certificate download card remains usable across supported viewports", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/app");
  await page.getByLabel("用户名", { exact: true }).fill("admin");
  await page.getByLabel("密码", { exact: true }).fill("admin123");
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await openSettingsView(page, "关于系统");

  const download = page.getByRole("link", { name: "下载 CageLedger 证书", exact: true });
  for (const viewport of [
    { name: "1280", width: 1280, height: 900 },
    { name: "1180", width: 1180, height: 820 },
    { name: "760", width: 760, height: 900 },
    { name: "landscape", width: 844, height: 390 },
  ]) {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await expect(download).toBeVisible();
    expect(
      await page.evaluate(() => ({
        clientWidth: document.documentElement.clientWidth,
        scrollWidth: document.documentElement.scrollWidth,
      })),
    ).toMatchObject({ clientWidth: viewport.width, scrollWidth: viewport.width });
    await attachViewport(page, testInfo, `certificate-${viewport.name}`);
  }
});

async function attachViewport(page: Page, testInfo: TestInfo, name: string) {
  await testInfo.attach(name, {
    body: await page.screenshot({ fullPage: true }),
    contentType: "image/png",
  });
}
