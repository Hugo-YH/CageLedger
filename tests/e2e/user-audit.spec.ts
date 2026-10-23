import { expect, openSettingsView, test } from "./fixtures";

test("account create, edit and delete appear in the cached operation log with the authenticated actor", async ({
  page,
}) => {
  await page.goto("/app");
  await page.getByLabel("用户名", { exact: true }).fill("admin");
  await page.getByLabel("密码", { exact: true }).fill("admin123");
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await expect(page.getByRole("button", { name: "退出登录" })).toBeVisible();
  await openSettingsView(page, "操作日志");
  await expect(page.getByRole("heading", { name: "操作记录", exact: true })).toBeVisible();

  const username = `audit-ui-${Date.now()}`;
  await openSettingsView(page, "账号管理");
  const create = page.locator(".settings-side-panel");
  await create.getByLabel("登录名", { exact: true }).fill(username);
  await create.getByLabel("显示姓名", { exact: true }).fill("审计测试账号");
  await create.getByLabel("初始密码", { exact: true }).fill("audit-initial-password");
  const createdResponse = page.waitForResponse(
    (r) => r.url().endsWith("/api/users") && r.request().method() === "POST",
  );
  await create.getByRole("button", { name: "创建账号", exact: true }).click();
  const created = await createdResponse;
  expect(created.status()).toBe(201);
  const { user } = await created.json();
  await expect(page.locator(".settings-user-collapse").getByText(username, { exact: true })).toBeVisible();
  await openSettingsView(page, "操作日志");
  await expect(page.getByRole("row").filter({ hasText: username }).filter({ hasText: "user.created" })).toBeVisible();

  await openSettingsView(page, "账号管理");
  let editor = page.locator(".settings-user-collapse .ant-collapse-item").filter({ hasText: username });
  await editor.locator(".ant-collapse-header").click();
  await editor.getByLabel("联系电话", { exact: true }).fill("12345");
  await editor.getByLabel("新密码（留空保持）", { exact: true }).fill("audit-new-password");
  const updatedResponse = page.waitForResponse(
    (r) => r.url().endsWith(`/api/users/${user.id}`) && r.request().method() === "PUT",
  );
  await editor.getByRole("button", { name: "保存账号", exact: true }).click();
  expect((await updatedResponse).status()).toBe(200);
  await expect(editor.getByRole("button", { name: "保存账号", exact: true })).toBeEnabled();
  const stale = await page.request.put(`/api/users/${user.id}`, {
    data: { phone: "stale", expectedUpdatedAt: user.updatedAt },
  });
  expect(stale.status()).toBe(409);
  await openSettingsView(page, "操作日志");
  const updatedLog = page.getByRole("row").filter({ hasText: username }).filter({ hasText: "user.updated" });
  await expect(updatedLog).toContainText("联系电话、重置密码");

  await openSettingsView(page, "账号管理");
  editor = page.locator(".settings-user-collapse .ant-collapse-item").filter({ hasText: username });
  await editor.locator(".ant-collapse-header").click();
  await editor.getByRole("button", { name: "删除账号", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "确认删除", exact: true }).click();
  await expect(editor).toHaveCount(0);
  await openSettingsView(page, "操作日志");
  await expect(page.getByRole("row").filter({ hasText: username }).filter({ hasText: "user.deleted" })).toBeVisible();
  const logs = (await (await page.request.get("/api/audit-events?limit=100&offset=0")).json()).items;
  const events = logs.filter((entry: { entityId: string }) => entry.entityId === user.id);
  expect(events.map((entry: { action: string }) => entry.action).sort()).toEqual([
    "user.created",
    "user.deleted",
    "user.updated",
  ]);
  for (const event of events) expect(event.actorUsername).toBe("admin");
  expect(JSON.stringify(events)).not.toContain("audit-initial-password");
  expect(JSON.stringify(events)).not.toContain("audit-new-password");
  expect(JSON.stringify(events)).not.toContain("password_hash");
});
