import { ensureTestInfrastructure, expect, openIntakeEntry, openQuantityEntry, test } from "./fixtures";

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
