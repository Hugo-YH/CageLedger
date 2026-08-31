import { expect, openNavigationEntry, openSettingsView, test } from "./fixtures";

test("Ant components follow system theme changes without navigation or reload", async ({ page }, testInfo) => {
  await page.emulateMedia({ colorScheme: "light" });
  await page.goto("/app");
  await page.getByLabel("用户名", { exact: true }).fill("admin");
  await page.getByLabel("密码", { exact: true }).fill("admin123");
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await openSettingsView(page, "关于系统");
  const button = page.getByRole("button", { name: "刷新状态", exact: true });
  const lightColor = await button.evaluate((element) => getComputedStyle(element).color);
  const lightBackground = await button.evaluate((element) => getComputedStyle(element).backgroundColor);
  await page.emulateMedia({ colorScheme: "dark" });
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect(button).not.toHaveCSS("color", lightColor);
  await expect(button).not.toHaveCSS("background-color", lightBackground);
  const themeScreenshot = testInfo.outputPath("system-theme-live-dark.png");
  await page.screenshot({ path: themeScreenshot, fullPage: true, animations: "disabled" });
  await testInfo.attach("system-theme-live-dark", {
    path: themeScreenshot,
    contentType: "image/png",
  });
  await page.getByRole("radiogroup", { name: "显示模式" }).getByText("浅色", { exact: true }).click();
  await expect(button).toHaveCSS("color", lightColor);
  await page.getByRole("radiogroup", { name: "显示模式" }).getByText("跟随系统", { exact: true }).click();
  await expect(button).not.toHaveCSS("color", lightColor);
  await page.emulateMedia({ colorScheme: "light" });
  await expect(button).toHaveCSS("color", lightColor);
});

test("denied browser storage does not prevent login or workspace navigation", async ({ page }) => {
  await page.addInitScript(() => {
    for (const key of ["localStorage", "sessionStorage"]) {
      Object.defineProperty(window, key, {
        configurable: true,
        get() {
          throw new DOMException("Storage access denied", "SecurityError");
        },
      });
    }
  });
  await page.goto("/app");
  await page.getByLabel("用户名", { exact: true }).fill("admin");
  await page.getByLabel("密码", { exact: true }).fill("admin123");
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await expect(page.getByRole("heading", { name: "实验动物笼位管理与计费系统", exact: true })).toBeVisible();
  await openNavigationEntry(page, "笼卡管理", "待接收批次");
  await expect(page.getByRole("region", { name: "待接收批次列表" })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("button", { name: "退出登录", exact: true })).toBeVisible();
});

test("business table resize persists without sorting requests and stays inside every viewport", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/app");
  await page.getByLabel("用户名", { exact: true }).fill("admin");
  await page.getByLabel("密码", { exact: true }).fill("admin123");
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await openNavigationEntry(page, "笼卡管理", "待接收批次");
  const region = page.getByRole("region", { name: "待接收批次列表" });
  await expect(region).toBeVisible();
  const slider = region.getByRole("slider").first();
  const initialWidth = Number(await slider.getAttribute("aria-valuenow"));
  let requests = 0;
  page.on("request", (request) => {
    if (new URL(request.url()).pathname === "/api/intake-batches") requests += 1;
  });
  await slider.focus();
  await slider.press("ArrowRight");
  await slider.press("Enter");
  await expect(slider).toHaveAttribute("aria-valuenow", String(initialWidth + 16));
  expect(requests).toBe(0);
  // Navigating away immediately also verifies the pending preference is flushed on unmount.
  await page.getByRole("menuitem", { name: /总览/ }).click();
  await openNavigationEntry(page, "笼卡管理", "待接收批次");
  await expect(slider).toHaveAttribute("aria-valuenow", String(initialWidth + 16));
  for (const viewport of [
    { width: 1440, height: 900 },
    { width: 1200, height: 900 },
    { width: 1180, height: 820 },
    { width: 992, height: 820 },
    { width: 768, height: 900 },
    { width: 760, height: 900 },
    { width: 390, height: 844 },
    { width: 844, height: 390 },
  ]) {
    await page.setViewportSize(viewport);
    await expect(region).toBeVisible();
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await expect(region.locator(".ant-table-content")).toHaveCSS("overflow-x", "auto");
    const screenshot = testInfo.outputPath(`intake-table-${viewport.width}x${viewport.height}.png`);
    await page.screenshot({ path: screenshot, fullPage: true, animations: "disabled" });
    await testInfo.attach(`intake-table-${viewport.width}x${viewport.height}`, {
      path: screenshot,
      contentType: "image/png",
    });
  }
});
