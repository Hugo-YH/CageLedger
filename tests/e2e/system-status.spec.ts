import type { Page } from "@playwright/test";

import { expect, openSettingsView, test } from "./fixtures";

async function login(page: Page, username = "admin", password = "admin123") {
  await page.goto("/app");
  await page.getByLabel("用户名", { exact: true }).fill(username);
  await page.getByLabel("密码", { exact: true }).fill(password);
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await expect(page.getByRole("button", { name: "退出登录", exact: true })).toBeVisible();
}

test("administrator can inspect and refresh process metrics", async ({ page }) => {
  await login(page);
  await openSettingsView(page, "关于系统");

  await expect(page.getByRole("heading", { name: "系统状态", exact: true, level: 1 })).toBeVisible();
  await expect(page.getByText("缓存命中率", { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "数据缓存", exact: true, level: 2 })).toBeVisible();
  await expect(page.getByRole("heading", { name: "HTTP 请求", exact: true, level: 2 })).toBeVisible();
  await expect(page.getByRole("heading", { name: "SQLite", exact: true, level: 2 })).toBeVisible();
  await expect(page.getByText(/自本次启动以来累计/)).toBeVisible();

  const refreshed = page.waitForResponse(
    (response) => response.url().includes("/api/system/environment") && response.status() === 200,
  );
  await page.getByRole("button", { name: "刷新状态", exact: true }).click();
  await refreshed;
  await expect(page.getByRole("button", { name: "刷新状态", exact: true })).toBeEnabled();
});

test("room administrator does not request or see process metrics", async ({ page }) => {
  await login(page);
  const username = `e2e_status_room_${Date.now()}`;
  const createResponse = await page.request.post("/api/users", {
    data: {
      username,
      displayName: "E2E 状态房管",
      password: "e2e-password",
      role: "room_admin",
      roomIds: [],
    },
  });
  expect(createResponse.ok()).toBeTruthy();
  const created = (await createResponse.json()) as { user: { id: string } };

  await page.getByRole("button", { name: "退出登录", exact: true }).click();
  let environmentRequests = 0;
  page.on("request", (request) => {
    if (request.url().includes("/api/system/environment")) environmentRequests += 1;
  });
  await login(page, username, "e2e-password");
  await openSettingsView(page, "关于系统");

  await expect(page.getByRole("heading", { name: "系统状态", exact: true, level: 1 })).toBeVisible();
  await expect(page.getByText("运行指标由管理员维护", { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "当前服务进程", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "刷新状态", exact: true })).toHaveCount(0);
  expect(environmentRequests).toBe(0);

  await page.getByRole("button", { name: "退出登录", exact: true }).click();
  await login(page);
  expect((await page.request.delete(`/api/users/${created.user.id}`)).ok()).toBeTruthy();
});
