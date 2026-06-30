import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

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

test("core workspaces and confirmation dialogs retain accessible semantics", async ({ page }) => {
  await login(page);

  await page.getByRole("button", { name: "笼卡管理", exact: true }).click();
  await expect(page.getByRole("heading", { name: "笼卡管理", exact: true })).toBeVisible();
  await expectNoSeriousViolations(page);

  await page.getByRole("button", { name: "饲养费管理", exact: true }).click();
  await expect(page.getByRole("heading", { name: "饲养费管理", exact: true })).toBeVisible();
  await expectNoSeriousViolations(page);

  await page.getByRole("button", { name: "流程中心", exact: true }).click();
  await expect(page.getByRole("heading", { name: "流程中心", exact: true })).toBeVisible();
  await expectNoSeriousViolations(page);
});
