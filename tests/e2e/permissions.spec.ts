import { compatibilityCase } from "./compatibilityCases";
import { ensureTestInfrastructure, expect, openSettingsView, test } from "./fixtures";

test("admin can create infrastructure and manage a room account", async ({ page }) => {
  await page.goto("/app");
  await page.getByLabel("用户名", { exact: true }).fill("admin");
  await page.getByLabel("密码", { exact: true }).fill("admin123");
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await expect(page.getByRole("heading", { name: "实验动物笼位管理与计费系统", exact: true })).toBeVisible();
  await ensureTestInfrastructure(page);
  await openSettingsView(page, "房间管理");
  const roomName = `E2E 测试饲养间 ${Date.now()}`;
  await page.getByRole("button", { name: "新增饲养间", exact: true }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.getByLabel("饲养间名称", { exact: true }).fill(roomName);
  await page.getByLabel("区域", { exact: true }).fill("E2E 区域");
  await page.getByRole("button", { name: "保存饲养间", exact: true }).click();
  await expect(page.locator("#root").getByText(roomName, { exact: true })).toBeVisible();
  await openSettingsView(page, "账号管理");
  await page.getByLabel("登录名", { exact: true }).fill("e2e_room_admin");
  await page.getByLabel("显示姓名", { exact: true }).fill("E2E 房间管理员");
  await page.getByLabel("初始密码", { exact: true }).fill("e2e-password");
  await page.locator(".settings-room-access-group .ant-checkbox-wrapper").filter({ hasText: roomName }).click();
  await page.getByRole("button", { name: "创建账号", exact: true }).click();
  const userItem = page.locator(".settings-user-collapse .ant-collapse-item").filter({ hasText: "E2E 房间管理员" });
  await expect(userItem).toBeVisible();
  await userItem.locator(".ant-collapse-header").click();
  await userItem.getByRole("button", { name: "删除账号", exact: true }).click();
  await page.getByRole("button", { name: "确认删除", exact: true }).click();
  await expect(userItem).toHaveCount(0);
});

test(
  "room administrator keeps the server-side permission boundary",
  compatibilityCase("room-permissions"),
  async ({ page }) => {
    // Use the browser's authenticated transport for this boundary check. The
    // runner's shared Node HTTP pool can reuse a closing dev-proxy connection.
    async function browserRequest(method: string, path: string, data?: Record<string, unknown>) {
      return page.evaluate(
        async ({ method, path, data }) => {
          const response = await fetch(path, {
            method,
            headers: data ? { "Content-Type": "application/json" } : undefined,
            body: data ? JSON.stringify(data) : undefined,
          });
          return { ok: response.ok, status: response.status, body: (await response.json()) as unknown };
        },
        { method, path, data },
      );
    }
    await page.goto("/app");
    await page.getByLabel("用户名", { exact: true }).fill("admin");
    await page.getByLabel("密码", { exact: true }).fill("admin123");
    await page.getByRole("button", { name: "登录", exact: true }).click();
    await expect(page.getByRole("heading", { name: "实验动物笼位管理与计费系统", exact: true })).toBeVisible();
    const roomId = `room-permissions-${Date.now()}`;
    const room = await browserRequest("POST", "/api/rooms", {
      item: { id: roomId, name: roomId, area: "E2E", facility: "zhujiang" },
    });
    expect(room.status).toBe(201);
    const username = `e2e_room_${Date.now()}`;
    const createResponse = await browserRequest("POST", "/api/users", {
      username,
      displayName: "E2E 权限管理员",
      password: "e2e-password",
      role: "room_admin",
      roomIds: [roomId],
    });
    expect(createResponse.ok).toBeTruthy();
    const created = createResponse.body as { user: { id: string } };
    await page.getByRole("button", { name: "退出登录", exact: true }).click();
    await page.getByLabel("用户名", { exact: true }).fill(username);
    await page.getByLabel("密码", { exact: true }).fill("e2e-password");
    await page.getByRole("button", { name: "登录", exact: true }).click();
    await expect(page.getByText("房间管理员 · 1 个饲养间", { exact: true })).toBeVisible();
    await openSettingsView(page, "房间管理");
    await expect(page.getByRole("button", { name: "新增饲养间", exact: true })).toHaveCount(0);
    const usersResponse = await browserRequest("GET", "/api/users");
    expect(usersResponse.status).toBe(403);
    await page.getByRole("button", { name: "退出登录", exact: true }).click();
    await page.getByLabel("用户名", { exact: true }).fill("admin");
    await page.getByLabel("密码", { exact: true }).fill("admin123");
    await page.getByRole("button", { name: "登录", exact: true }).click();
    await expect(page.getByText("管理员 · 全部饲养间", { exact: true })).toBeVisible();
    expect((await browserRequest("DELETE", `/api/users/${created.user.id}`)).ok).toBeTruthy();
    expect((await browserRequest("DELETE", `/api/rooms/${roomId}`)).ok).toBeTruthy();
  },
);
