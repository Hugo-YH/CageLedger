import { captureUiAudit } from "./uiAudit";
import type { Route } from "@playwright/test";
import { ensureTestInfrastructure, expect, openSettingsView, test } from "./fixtures";

test.beforeEach(async ({ page }) => {
  await page.goto("/app");
  await page.getByLabel("用户名", { exact: true }).fill("admin");
  await page.getByLabel("密码", { exact: true }).fill("admin123");
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await expect(page.getByRole("button", { name: "退出登录" })).toBeVisible();
});

test("account forms keep their own labels and show create, edit and delete failures", async ({ page }, testInfo) => {
  const users = ["甲", "乙"].map((name, index) => ({
    id: `mock-${index}`,
    username: `account-${index}`,
    displayName: name,
    role: "room_admin",
    roomIds: [],
    updatedAt: "1",
  }));
  let pending: Route | undefined;
  let creates = 0;
  await page.route("**/api/users", (route) => {
    if (route.request().method() === "POST") {
      creates += 1;
      pending = route;
    } else return route.fulfill({ json: { users } });
  });
  await page.route("**/api/users/mock-*", (route) =>
    route.fulfill({
      status: 403,
      json: { error: route.request().method() === "DELETE" ? "账号无法删除" : "账号无法保存" },
    }),
  );
  await openSettingsView(page, "账号管理");
  for (const name of ["甲", "乙"]) await page.getByRole("button", { name: new RegExp(`${name} account-`) }).click();
  const fields = page.locator(".user-fields-react");
  await expect(fields).toHaveCount(3);
  const ids = await fields.locator("input[id]").evaluateAll((inputs) => inputs.map((input) => input.id));
  expect(new Set(ids).size).toBe(ids.length);
  const create = page.locator(".settings-side-panel");
  await create.getByLabel("登录名", { exact: true }).fill("new-account");
  await create.getByLabel("显示姓名", { exact: true }).fill("新账号");
  await create.getByLabel("初始密码", { exact: true }).fill("test-password");
  await create.getByRole("button", { name: "创建账号" }).click();
  await expect.poll(() => creates).toBe(1);
  await expect(create.getByRole("button", { name: "创建账号" })).toHaveClass(/ant-btn-loading/);
  await pending?.fulfill({ status: 409, json: { error: "登录名已存在" } });
  await expect(create.getByRole("alert")).toContainText("登录名已存在");
  await expect(create.getByLabel("登录名", { exact: true })).toHaveValue("new-account");
  const editor = page.locator(".settings-user-collapse .ant-collapse-item").filter({ hasText: "account-0" });
  await editor.getByLabel("显示姓名", { exact: true }).fill("甲的未保存草稿");
  await editor.getByRole("button", { name: "保存账号" }).click();
  await expect(editor.getByRole("alert")).toContainText("账号无法保存");
  await expect(editor.getByLabel("显示姓名", { exact: true })).toHaveValue("甲的未保存草稿");
  await editor.getByRole("button", { name: "删除账号" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: "确认删除" }).click();
  await expect(dialog.getByRole("alert")).toContainText("账号无法删除");
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "取消", exact: true }).click();
  await expect(editor).toBeVisible();
  await captureUiAudit(page, testInfo, "account-errors");
});

test("infrastructure save and delete failures stay in the open dialog", async ({ page }, testInfo) => {
  await ensureTestInfrastructure(page);
  await openSettingsView(page, "房间管理");
  let requests = 0;
  await page.route("**/api/infrastructure", (route) => {
    requests += 1;
    return route.fulfill({ status: 409, json: { error: "基础设施冲突，请重新核对" } });
  });
  await page.getByRole("button", { name: "新增饲养间", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("饲养间名称", { exact: true }).fill("未保存的测试房间");
  await dialog.getByRole("button", { name: "保存饲养间", exact: true }).click();
  await expect(dialog.getByRole("alert")).toContainText("基础设施冲突，请重新核对");
  await expect(dialog.getByLabel("饲养间名称", { exact: true })).toHaveValue("未保存的测试房间");
  await captureUiAudit(page, testInfo, "room-editor-error", dialog);
  await dialog.getByRole("button", { name: "取消", exact: true }).click();
  const rack = page.locator(".settings-rack-row").first();
  await rack.getByRole("button", { name: "删除", exact: true }).click();
  await dialog.getByRole("button", { name: "确认删除" }).click();
  await expect(dialog.getByRole("alert")).toContainText("基础设施冲突，请重新核对");
  expect(requests).toBe(2);
  await dialog.getByRole("button", { name: "取消", exact: true }).click();
  await expect(rack).toBeVisible();
});
