import type { Page } from "@playwright/test";
import { APP_VERSION } from "../../src/react/version";
import type { SystemUpdateStatus } from "../../src/contracts/administration";

import { expect, openSettingsView, test } from "./fixtures";

async function login(page: Page, username = "admin", password = "admin123") {
  await page.goto("/app");
  await page.getByLabel("用户名", { exact: true }).fill(username);
  await page.getByLabel("密码", { exact: true }).fill(password);
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await expect(page.getByRole("button", { name: "退出登录", exact: true })).toBeVisible();
}

test("system documentation actions load the local docs and release history", async ({ page }, testInfo) => {
  await login(page);
  for (const [label, path, heading] of [
    ["项目文档", "/docs/", "CageLedger"],
    ["更新记录", "/docs/releases/", "更新日志"],
  ]) {
    await openSettingsView(page, "关于系统");
    await page.getByRole("group", { name: "系统信息操作", exact: true }).getByRole("button", { name: /更多/ }).click();
    for (const title of ["项目文档", "更新记录"]) {
      await expect(
        page.getByRole("menuitem", { name: title, exact: true }).locator(".ant-dropdown-menu-item-icon svg"),
      ).toBeVisible();
    }
    await page.getByRole("menuitem", { name: label, exact: true }).click();
    await expect(page).toHaveURL(new URL(path, testInfo.project.use.baseURL).href);
    await expect(page.getByRole("heading", { name: new RegExp(`^${heading}`), level: 1 })).toBeVisible();
    await expect(page.locator("#VPContent")).not.toBeEmpty();
    await testInfo.attach(label, { body: await page.screenshot(), contentType: "image/png" });
    await page.getByRole("link", { name: "进入系统", exact: true }).click();
    await expect(page.getByRole("button", { name: "退出登录", exact: true })).toBeVisible();
  }
});

test("administrator can inspect and refresh process metrics", async ({ page }, info) => {
  await page.setViewportSize({ width: 1218, height: 644 });
  await login(page);
  await openSettingsView(page, "关于系统");

  await expect(page.getByRole("heading", { name: "系统状态", exact: true, level: 2 })).toBeVisible();
  await expect(page.getByRole("group", { name: "系统信息操作", exact: true })).toContainText("系统状态");
  await expect(page.locator(".system-pulse-tile").getByText("缓存命中率", { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "数据缓存", exact: true, level: 3 })).toBeVisible();
  await expect(page.getByRole("heading", { name: "HTTP 请求", exact: true, level: 3 })).toBeVisible();
  await expect(page.getByRole("heading", { name: "SQLite", exact: true, level: 3 })).toBeVisible();
  await expect(page.getByRole("heading", { name: "PDF 生成", exact: true, level: 3 })).toBeVisible();
  await expect(page.getByRole("heading", { name: "请求分布", exact: true, level: 3 })).toBeVisible();
  await expect(page.getByRole("heading", { name: "最近 24 小时性能记录", exact: true, level: 3 })).toBeVisible();
  await expect(page.getByRole("table", { name: "HTTP 请求分布" })).toBeVisible();
  await expect(page.getByText("PDF 队列", { exact: true })).toBeVisible();
  await expect(page.getByLabel("PDF 缓存容量占用")).toBeVisible();
  const processHelp = page.getByRole("button", { name: "当前服务进程说明", exact: true });
  await processHelp.click();
  await expect(page.getByText(/自本次启动以来累计/)).toBeVisible();
  await processHelp.press("Escape");
  await expect(processHelp).toHaveAttribute("aria-expanded", "false");

  const diagnosticLayout = await page.evaluate(() => {
    const grid = document.querySelector<HTMLElement>(".system-diagnostics-grid");
    const titles = Array.from(document.querySelectorAll<HTMLElement>(".system-diagnostic-card h3"));
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
  expect(diagnosticLayout.titles.every((title) => title.fontSize === "16px")).toBe(true);
  expect(diagnosticLayout.titles.every((title) => title.height <= title.lineHeight + 1)).toBe(true);

  const refreshed = page.waitForResponse(
    (response) => response.url().includes("/api/system/environment") && response.status() === 200,
  );
  await page.getByRole("button", { name: "刷新状态", exact: true }).click();
  await refreshed;
  await expect(page.getByRole("button", { name: "刷新状态", exact: true })).toBeEnabled();

  let updateFailed = true;
  let updateReads = 0;
  await page.route("**/api/system/update-check", (route) => {
    updateReads += 1;
    return updateFailed
      ? route.fulfill({ status: 503, json: { error: "测试更新服务暂不可用" } })
      : route.fulfill({
          json: {
            currentVersion: APP_VERSION,
            latestVersion: APP_VERSION,
            updateAvailable: false,
            latestUrl: `https://git.cellnucle.us/hugo/cageledger/releases/tag/v${APP_VERSION}`,
          } satisfies SystemUpdateStatus,
        });
  });
  expect(updateReads).toBe(0);
  await page.getByRole("button", { name: "检查更新", exact: true }).click();
  const updateError = page.getByRole("alert").filter({ hasText: "检查更新失败" });
  await expect(updateError).toContainText("测试更新服务暂不可用");
  await expect(updateError).not.toContainText("当前已是最新版本");
  expect(updateReads).toBe(1);
  await page.screenshot({ path: info.outputPath("system-update-error.png"), animations: "disabled" });
  updateFailed = false;
  await page.getByRole("button", { name: "检查更新", exact: true }).click();
  await expect(page.getByRole("alert").filter({ hasText: "当前已是最新版本" })).toContainText(
    `最新发布版 ${APP_VERSION}`,
  );
  expect(updateReads).toBe(2);

  for (const viewport of [
    { width: 1180, height: 760 },
    { width: 760, height: 760 },
    { width: 667, height: 375 },
  ]) {
    await page.setViewportSize(viewport);
    await expect(page.getByRole("heading", { name: "最近 24 小时性能记录", exact: true, level: 3 })).toBeVisible();
    await expect(page.getByRole("table", { name: "HTTP 请求分布" })).toBeVisible();
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

  await expect(page.getByRole("heading", { name: "系统状态", exact: true, level: 2 })).toBeVisible();
  await expect(page.getByText("运行指标由管理员维护", { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "当前服务进程", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "刷新状态", exact: true })).toHaveCount(0);
  expect(performanceRequests).toBe(0);

  await page.getByRole("button", { name: "退出登录", exact: true }).click();
  await login(page);
  expect((await page.request.delete(`/api/users/${created.user.id}`)).ok()).toBeTruthy();
});
