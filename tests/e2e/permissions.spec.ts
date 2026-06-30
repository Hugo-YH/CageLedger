import { ensureTestInfrastructure, expect, openSettingsView, test } from "./fixtures";

test("admin can create infrastructure and manage a room account", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("用户名", { exact: true }).fill("admin");
  await page.getByLabel("密码", { exact: true }).fill("admin123");
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await expect(page.getByRole("heading", { name: "实验动物笼位管理与计费系统", exact: true })).toBeVisible();
  await ensureTestInfrastructure(page);
  await openSettingsView(page, "房间管理");
  const roomName = `E2E 测试饲养间 ${Date.now()}`;
  await page.getByRole("button", { name: "新增饲养间", exact: true }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCSS("position", "relative");
  await expect(page.locator(".modal-backdrop")).toHaveCSS("position", "fixed");
  await page.getByLabel("饲养间名称", { exact: true }).fill(roomName);
  await page.getByLabel("区域", { exact: true }).fill("E2E 区域");
  await page.getByRole("button", { name: "保存饲养间", exact: true }).click();
  await expect(page.getByText(roomName, { exact: true })).toBeVisible();
  await openSettingsView(page, "账号管理");
  await page.getByLabel("登录名", { exact: true }).fill("e2e_room_admin");
  await page.getByLabel("显示姓名", { exact: true }).fill("E2E 房间管理员");
  await page.getByLabel("初始密码", { exact: true }).fill("e2e-password");
  await page.getByLabel(roomName, { exact: true }).check();
  await page.getByRole("button", { name: "创建账号", exact: true }).click();
  const userCard = page.locator(".user-card").filter({ hasText: "E2E 房间管理员" });
  await expect(userCard).toBeVisible();
  await userCard.getByRole("button", { name: "删除", exact: true }).click();
  await page.getByRole("button", { name: "确认删除", exact: true }).click();
  await expect(userCard).toHaveCount(0);
});

test("room administrator keeps the server-side permission boundary", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("用户名", { exact: true }).fill("admin");
  await page.getByLabel("密码", { exact: true }).fill("admin123");
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await expect(page.getByRole("heading", { name: "实验动物笼位管理与计费系统", exact: true })).toBeVisible();
  await ensureTestInfrastructure(page);
  const username = `e2e_room_${Date.now()}`;
  const createResponse = await page.request.post("/api/users", {
    data: {
      username,
      displayName: "E2E 权限管理员",
      password: "e2e-password",
      role: "room_admin",
      roomIds: ["room-e2e-8014"],
    },
  });
  expect(createResponse.ok()).toBeTruthy();
  const created = (await createResponse.json()) as { user: { id: string } };
  await page.getByRole("button", { name: "退出", exact: true }).click();
  await page.getByLabel("用户名", { exact: true }).fill(username);
  await page.getByLabel("密码", { exact: true }).fill("e2e-password");
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await expect(page.getByText("房间管理员 · 1 个饲养间", { exact: true })).toBeVisible();
  await openSettingsView(page, "房间管理");
  await expect(page.getByRole("button", { name: "新增饲养间", exact: true })).toHaveCount(0);
  const usersResponse = await page.request.get("/api/users");
  expect(usersResponse.status()).toBe(403);
  await page.getByRole("button", { name: "退出", exact: true }).click();
  await page.getByLabel("用户名", { exact: true }).fill("admin");
  await page.getByLabel("密码", { exact: true }).fill("admin123");
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await expect(page.getByText("管理员 · 全部饲养间", { exact: true })).toBeVisible();
  expect((await page.request.delete(`/api/users/${created.user.id}`)).ok()).toBeTruthy();
});
