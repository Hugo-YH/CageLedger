import {
  ensureTestInfrastructure,
  expect,
  openBillingNavigation,
  openIntakeEntry,
  openQuantityEntry,
  openSettingsNavigation,
  test,
} from "./fixtures";

test("intake workspace remains operable at the mobile breakpoint", async ({ page }) => {
  await page.setViewportSize({ width: 760, height: 900 });
  await page.goto("/");
  await page.getByLabel("用户名", { exact: true }).fill("admin");
  await page.getByLabel("密码", { exact: true }).fill("admin123");
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await expect(page.getByRole("heading", { name: "实验动物笼位管理与计费系统", exact: true })).toBeVisible();
  await ensureTestInfrastructure(page);
  await openIntakeEntry(page);
  await expect(page.getByRole("heading", { name: "预约消息识别", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "保存待接收批次", exact: true })).toBeVisible();
  await expect(page.getByLabel("预约消息")).toBeVisible();
  await page.locator("nav.nav").getByRole("button", { name: "笼位管理", exact: true }).click();
  await expect(page.getByRole("heading", { name: "动态笼位图", exact: true, level: 1 })).toBeVisible();
  await expect(page.getByRole("combobox", { name: "房间", exact: true })).toBeVisible();
  await openQuantityEntry(page);
  await expect(page.getByRole("heading", { name: "数量统计表（录入）", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "保存统计表", exact: true })).toBeVisible();
});

test("mobile navigation keeps submenus and account actions reachable", async ({ page }) => {
  for (const viewport of [
    { width: 390, height: 844 },
    { width: 430, height: 932 },
  ]) {
    await page.setViewportSize(viewport);
    await page.goto("/");
    await page.getByLabel("用户名", { exact: true }).fill("admin");
    await page.getByLabel("密码", { exact: true }).fill("admin123");
    await page.getByRole("button", { name: "登录", exact: true }).click();
    await expect(page.getByRole("heading", { name: "实验动物笼位管理与计费系统", exact: true })).toBeVisible();

    await page.locator("nav.nav").getByRole("button", { name: "笼卡管理", exact: true }).click();
    await expect(page.locator("#nav-intake")).toBeVisible();
    await expect(page.getByRole("button", { name: /^预约消息识别/ })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.locator("#nav-intake")).toBeHidden();

    const settingsMenu = await openSettingsNavigation(page);
    await expect(settingsMenu).toBeVisible();
    await expect(page.getByRole("button", { name: "刷新页面", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "退出登录", exact: true })).toBeVisible();

    await page.getByRole("button", { name: "退出登录", exact: true }).click();
    await expect(page.getByRole("button", { name: "登录", exact: true })).toBeVisible();
  }
});

test("tablet navigation keeps account actions inside the settings menu", async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 768 });
  await page.goto("/");
  await page.getByLabel("用户名", { exact: true }).fill("admin");
  await page.getByLabel("密码", { exact: true }).fill("admin123");
  await page.getByRole("button", { name: "登录", exact: true }).click();

  const settingsMenu = await openSettingsNavigation(page);
  await expect(page.locator(".sidebar-account")).toBeHidden();
  await expect(page.getByRole("button", { name: "刷新页面", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "退出登录", exact: true })).toBeVisible();

  const bounds = await settingsMenu.boundingBox();
  expect(bounds?.x).toBeGreaterThanOrEqual(0);
  expect((bounds?.x || 0) + (bounds?.width || 0)).toBeLessThanOrEqual(1024);
  await page.getByRole("button", { name: "退出登录", exact: true }).click();
  await expect(page.getByRole("button", { name: "登录", exact: true })).toBeVisible();
});

test("landscape phone opens submenus after a desktop navigation collapse", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 820 });
  await page.goto("/");
  await page.getByLabel("用户名", { exact: true }).fill("admin");
  await page.getByLabel("密码", { exact: true }).fill("admin123");
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await page.getByRole("button", { name: "隐藏导航栏", exact: true }).click();

  await page.setViewportSize({ width: 844, height: 390 });
  const billingMenu = await openBillingNavigation(page);
  await expect(billingMenu).toBeVisible();
  await expect(billingMenu.getByRole("button", { name: /^数量统计表（录入）/ })).toBeVisible();
});
