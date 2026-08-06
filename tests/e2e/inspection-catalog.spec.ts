import { expect, openNavigationEntry, test } from "./fixtures";
import type { Page } from "@playwright/test";

async function login(page: Page, username: string, password: string) {
  await page.goto("/app");
  await page.getByLabel("用户名", { exact: true }).fill(username);
  await page.getByLabel("密码", { exact: true }).fill(password);
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await page.waitForLoadState("networkidle");
}

async function openStandards(page: Page) {
  await openNavigationEntry(page, "动物管理", "巡检标准");
  await expect(page.locator(".inspection-standards-panel")).toBeVisible();
}

test("admin edits the catalog, saves a draft and publishes a new version", async ({ page }) => {
  await login(page, "admin", "admin123");
  await openStandards(page);
  await expect(page.locator(".inspection-standard-list")).toContainText("125 个巡检条目");

  await page.getByRole("button", { name: "编辑目录" }).click();
  await expect(page.locator(".inspection-editor-panel")).toBeVisible();
  const treeNode = page
    .locator(".inspection-editor-tree .ant-tree-treenode:visible")
    .getByText("呼吸急促", { exact: true })
    .first();
  await treeNode.click();
  await expect(page.locator(".inspection-node-drawer")).toBeVisible();
  const nameInput = page.locator(".inspection-node-drawer #name");
  await nameInput.fill("呼吸急促（E2E 发布）");
  await page.getByRole("button", { name: /保存修改/ }).click();
  await expect(page.locator(".inspection-editor-tree .inspection-tree-change:visible")).toHaveCount(1);

  await page.locator(".inspection-editor-panel button").filter({ hasText: "保存草稿" }).click();
  await expect(page.locator(".inspection-editor-status .ant-tag").first()).toHaveText("草稿已保存");

  await page.locator(".inspection-editor-panel button").filter({ hasText: "返回" }).click();
  await expect(page.locator(".inspection-draft-banner")).toBeVisible();
  await page.getByRole("button", { name: "继续编辑" }).click();
  await expect(page.locator(".inspection-editor-panel")).toBeVisible();

  await page.locator(".inspection-editor-panel button").filter({ hasText: "发布" }).click();
  await expect(page.locator(".inspection-publish-modal")).toBeVisible();
  await expect(page.locator(".inspection-publish-diff-item")).toHaveCount(1);
  await page.getByRole("button", { name: "确认发布", exact: true }).click();
  await expect(page.locator(".inspection-standards-panel")).toBeVisible();
  await expect(page.locator(".inspection-catalog-summary")).toContainText("manual-");
  await expect(page.locator(".inspection-draft-banner")).toHaveCount(0);
  await expect(page.locator(".inspection-standard-list")).toContainText("125 个巡检条目");
});

test("room administrator only sees the read-only standards page", async ({ page }) => {
  await login(page, "admin", "admin123");
  const username = `e2e_room_${Date.now()}`;
  const createResponse = await page.request.post("/api/users", {
    data: { username, displayName: "E2E 巡检房管", password: "e2e-password", role: "room_admin", roomIds: [] },
  });
  expect(createResponse.ok()).toBeTruthy();
  const created = (await createResponse.json()) as { user: { id: string } };

  await page.getByRole("button", { name: "退出登录", exact: true }).click();
  await login(page, username, "e2e-password");
  await openStandards(page);
  await expect(page.getByRole("button", { name: "编辑目录" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "版本历史" })).toHaveCount(0);

  await page.getByRole("button", { name: "退出登录", exact: true }).click();
  await login(page, "admin", "admin123");
  const deleteResponse = await page.request.delete(`/api/users/${created.user.id}`);
  expect(deleteResponse.ok()).toBeTruthy();
});

test("admin can review the version history", async ({ page }) => {
  await login(page, "admin", "admin123");
  await openStandards(page);
  await page.getByRole("button", { name: "版本历史" }).click();
  await expect(page.locator(".inspection-version-modal")).toBeVisible();
  await expect(page.locator(".inspection-version-row").first()).toContainText("当前生效");
  await expect(page.locator(".inspection-version-row").first()).toContainText("233 条巡检内容");
  const rowCount = await page.locator(".inspection-version-row").count();
  expect(rowCount).toBeGreaterThanOrEqual(2);
  const historyRow = page.locator(".inspection-version-row").filter({ hasNotText: "当前生效" }).first();
  await historyRow.getByRole("button", { name: /回滚/ }).click();
  await page.getByRole("button", { name: "确认回滚", exact: true }).click();
  await expect(page.locator(".inspection-standards-panel")).toBeVisible();
  await expect(page.locator(".inspection-catalog-summary")).toContainText("manual-");
  await expect(page.locator(".inspection-version-modal")).toBeHidden();
});
