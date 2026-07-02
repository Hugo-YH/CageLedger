import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";

import { expect, openIntakeEntry, openQuantityEntry, openSettingsView, openWorkflowCenter, test } from "./fixtures";

test.beforeEach(async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
});

async function expectNoSeriousViolations(page: Page) {
  const result = await new AxeBuilder({ page }).analyze();
  const violations = result.violations.filter((item) => item.impact === "critical" || item.impact === "serious");
  expect(violations, violations.map((item) => `${item.id}: ${item.help}`).join("\n")).toEqual([]);
}

async function login(page: Page) {
  await page.goto("/");
  await page.getByLabel("用户名", { exact: true }).fill("admin");
  await page.getByLabel("密码", { exact: true }).fill("admin123");
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await expect(page.getByRole("heading", { name: "实验动物笼位管理与计费系统", exact: true })).toBeVisible();
}

test("login and dashboard have no serious accessibility violations", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("button", { name: "登录", exact: true })).toBeVisible();
  await expectNoSeriousViolations(page);
  await login(page);
  await expectNoSeriousViolations(page);
});

test("core workspaces and dialogs retain accessible semantics", async ({ page }) => {
  await login(page);

  await openIntakeEntry(page);
  await expect(page.getByRole("heading", { name: "接收与识别", exact: true })).toBeVisible();
  await expectNoSeriousViolations(page);

  await openQuantityEntry(page);
  await expect(page.getByRole("heading", { name: "数量统计表录入", exact: true })).toBeVisible();
  await expectNoSeriousViolations(page);

  await openWorkflowCenter(page);
  await expect(page.getByRole("heading", { name: "结算与报销台账", exact: true })).toBeVisible();
  await expectNoSeriousViolations(page);

  await openSettingsView(page, "房间管理");
  const openRoomEditor = page.getByRole("button", { name: "新增饲养间", exact: true });
  await openRoomEditor.click();
  const dialog = page.getByRole("dialog", { name: "新增饲养间" });
  await expect(dialog).toBeVisible();
  await expect(page.getByRole("button", { name: "关闭", exact: true })).toBeFocused();
  await expectNoSeriousViolations(page);
  await page.keyboard.press("Shift+Tab");
  await expect(page.getByRole("button", { name: "取消", exact: true })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(openRoomEditor).toBeFocused();
});
