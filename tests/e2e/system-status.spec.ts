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
  await page.setViewportSize({ width: 1218, height: 644 });
  await login(page);
  await openSettingsView(page, "关于系统");

  await expect(page.getByRole("heading", { name: "系统状态", exact: true, level: 1 })).toBeVisible();
  await expect(page.locator(".system-pulse-tile").getByText("缓存命中率", { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "数据缓存", exact: true, level: 2 })).toBeVisible();
  await expect(page.getByRole("heading", { name: "HTTP 请求", exact: true, level: 2 })).toBeVisible();
  await expect(page.getByRole("heading", { name: "SQLite", exact: true, level: 2 })).toBeVisible();
  await expect(page.getByRole("heading", { name: "PDF 生成", exact: true, level: 2 })).toBeVisible();
  await expect(page.getByRole("heading", { name: "最近 24 小时性能记录", exact: true, level: 2 })).toBeVisible();
  await expect(page.getByText("PDF 队列", { exact: true })).toBeVisible();
  await expect(page.getByLabel("PDF 缓存容量占用")).toBeVisible();
  await expect(page.getByText(/自本次启动以来累计/)).toBeVisible();

  const diagnosticLayout = await page.evaluate(() => {
    const grid = document.querySelector<HTMLElement>(".system-diagnostics-grid");
    const titles = Array.from(document.querySelectorAll<HTMLElement>(".system-diagnostic-card h2"));
    return {
      columns: grid ? getComputedStyle(grid).gridTemplateColumns.split(" ").length : 0,
      titles: titles.map((title) => ({
        fontSize: getComputedStyle(title).fontSize,
        lineHeight: Number.parseFloat(getComputedStyle(title).lineHeight),
        height: title.getBoundingClientRect().height,
      })),
    };
  });
  expect(diagnosticLayout.columns).toBe(2);
  expect(diagnosticLayout.titles).toHaveLength(4);
  expect(diagnosticLayout.titles.every((title) => title.fontSize === "18px")).toBe(true);
  expect(diagnosticLayout.titles.every((title) => title.height <= title.lineHeight + 1)).toBe(true);

  const refreshed = page.waitForResponse(
    (response) => response.url().includes("/api/system/environment") && response.status() === 200,
  );
  await page.getByRole("button", { name: "刷新状态", exact: true }).click();
  await refreshed;
  await expect(page.getByRole("button", { name: "刷新状态", exact: true })).toBeEnabled();

  for (const viewport of [
    { width: 1180, height: 760 },
    { width: 760, height: 760 },
    { width: 667, height: 375 },
  ]) {
    await page.setViewportSize(viewport);
    await expect(page.getByRole("heading", { name: "最近 24 小时性能记录", exact: true, level: 2 })).toBeVisible();
    const historyLayout = await page.locator(".system-history-summary").evaluate((element) => ({
      columns: getComputedStyle(element).gridTemplateColumns.split(" ").length,
      overflow: element.scrollWidth > element.clientWidth,
    }));
    expect(historyLayout.columns).toBe(viewport.width <= 480 ? 1 : 2);
    expect(historyLayout.overflow).toBe(false);
  }
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
  let performanceRequests = 0;
  page.on("request", (request) => {
    if (
      request.url().includes("/api/system/environment") ||
      request.url().includes("/api/system/performance-history")
    ) {
      performanceRequests += 1;
    }
  });
  await login(page, username, "e2e-password");
  await openSettingsView(page, "关于系统");

  await expect(page.getByRole("heading", { name: "系统状态", exact: true, level: 1 })).toBeVisible();
  await expect(page.getByText("运行指标由管理员维护", { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "当前服务进程", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "刷新状态", exact: true })).toHaveCount(0);
  expect(performanceRequests).toBe(0);

  await page.getByRole("button", { name: "退出登录", exact: true }).click();
  await login(page);
  expect((await page.request.delete(`/api/users/${created.user.id}`)).ok()).toBeTruthy();
});
