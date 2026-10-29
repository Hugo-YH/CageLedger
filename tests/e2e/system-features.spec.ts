import type { APIRequestContext, Page, TestInfo } from "@playwright/test";
import { APP_VERSION } from "../../src/react/version";
import { expect, openNavigationEntry, openSettingsView, test } from "./fixtures";

type FeatureKey = "intake" | "quarantine" | "cages" | "animal" | "billing" | "technical-services" | "settlement";
type FeatureResponse = { item: { enabled: Record<FeatureKey, boolean>; updatedAt: string | null } };

const features: Array<{ key: FeatureKey; name: string }> = [
  { key: "intake", name: "笼卡管理" },
  { key: "quarantine", name: "检疫管理" },
  { key: "cages", name: "笼位管理" },
  { key: "animal", name: "动物管理" },
  { key: "billing", name: "饲养费管理" },
  { key: "technical-services", name: "技术服务费管理" },
  { key: "settlement", name: "结算管理" },
];
const allEnabled = Object.fromEntries(features.map(({ key }) => [key, true])) as Record<FeatureKey, boolean>;

async function loginAsAdmin(page: Page) {
  expect((await page.request.post("/api/auth/login", { data: { username: "admin", password: "admin123" } })).ok()).toBe(
    true,
  );
}

async function readFeatures(request: APIRequestContext) {
  const response = await request.get("/api/system/features");
  expect(response.ok(), await response.text()).toBe(true);
  return (await response.json()) as FeatureResponse;
}

async function restoreAllFeatures(request: APIRequestContext) {
  const current = await readFeatures(request);
  const response = await request.put("/api/system/features", {
    data: { enabled: allEnabled, expectedUpdatedAt: current.item.updatedAt },
  });
  expect(response.ok(), await response.text()).toBe(true);
}

async function openFeatures(page: Page) {
  if (await page.evaluate(() => window.matchMedia("(max-width: 767px)").matches)) {
    await page.getByRole("tab", { name: "更多", exact: true }).click();
    await page.locator(".ant-mobile-navigation-sheet").getByText("系统功能", { exact: true }).click();
  } else {
    await openSettingsView(page, "系统功能");
  }
  await expect(page.getByRole("heading", { name: "系统功能", exact: true })).toBeVisible();
}

async function setFeature(page: Page, name: string, checked: boolean) {
  const control = page.getByRole("switch", { name, exact: true });
  if ((await control.getAttribute("aria-checked")) !== String(checked)) await control.click();
}

async function saveFeatures(page: Page) {
  const saved = page.waitForResponse(
    (response) => new URL(response.url()).pathname === "/api/system/features" && response.request().method() === "PUT",
  );
  await page.getByRole("button", { name: "保存设置", exact: true }).click();
  expect((await saved).ok()).toBe(true);
  await expect(page.getByText("系统功能设置已保存", { exact: true }).last()).toBeVisible();
}

async function assertFeatureGroupsHidden(page: Page, info: TestInfo) {
  const isMobile = await page.evaluate(() => window.matchMedia("(max-width: 767px)").matches);
  if (isMobile) {
    await page.getByRole("tab", { name: "更多", exact: true }).click();
    const sheet = page.locator(".ant-mobile-navigation-sheet");
    await expect(sheet).toBeVisible();
    for (const { name } of features) await expect(sheet.getByText(name, { exact: true })).toHaveCount(0);
    await expect(page.getByRole("tab", { name: "笼位", exact: true })).toHaveCount(0);
    await expect(page.getByRole("tab", { name: "动物", exact: true })).toHaveCount(0);
  } else {
    const menu = page.locator(".ant-main-menu");
    for (const { name } of features) await expect(menu.getByRole("menuitem", { name, exact: true })).toHaveCount(0);
  }
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({
    path: info.outputPath(`system-features-hidden-${isMobile ? "mobile" : "desktop"}.png`),
    animations: "disabled",
  });
}

test.describe("global system feature visibility", () => {
  test.describe.configure({ mode: "serial" });

  test.beforeEach(async ({ page }) => {
    await loginAsAdmin(page);
    await restoreAllFeatures(page.request);
  });

  test.afterEach(async ({ page }) => {
    await restoreAllFeatures(page.request);
  });

  test("defaults to seven enabled modules, saves an administrator change, and writes an audit event", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 760, height: 900 });
    await page.goto("/app");
    await openFeatures(page);
    for (const { name } of features) {
      const control = page.getByRole("switch", { name, exact: true });
      await expect(control).toHaveAttribute("aria-checked", "true");
    }

    const quarantine = page.getByRole("switch", { name: /检疫管理$/ });
    await page.locator('label[for="system-feature-quarantine"]').click();
    await expect(quarantine).toHaveAttribute("aria-checked", "false");
    await quarantine.focus();
    await page.keyboard.press("Space");
    await expect(quarantine).toHaveAttribute("aria-checked", "true");
    await page.keyboard.press("Space");
    await expect(quarantine).toHaveAttribute("aria-checked", "false");
    await saveFeatures(page);
    await page.setViewportSize({ width: 1440, height: 900 });
    await expect(page.locator(".ant-main-menu").getByRole("menuitem", { name: /检疫管理$/ })).toHaveCount(0);

    const audit = await page.request.get("/api/audit-events?limit=100&offset=0");
    expect(audit.ok()).toBe(true);
    const records = await audit.json();
    expect(JSON.stringify(records)).toContain("system_features.updated");
    expect(JSON.stringify(records)).toContain("检疫管理");
    expect(JSON.stringify(records)).toContain("系统管理员");
  });

  test("hides all seven groups from desktop and mobile navigation, while system settings can restore them", async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/app");
    await openFeatures(page);
    for (const { name } of features) await setFeature(page, name, false);
    await saveFeatures(page);
    await page.getByRole("menuitem", { name: /总览$/ }).click();
    const dashboard = page.locator(".dashboard-view");
    await expect(dashboard).toBeVisible();
    await expect(dashboard.locator(".ant-dashboard-task.is-hidden")).toHaveCount(3);
    await expect(dashboard.locator(".ant-dashboard-task").getByRole("button")).toHaveCount(0);
    for (const label of ["待接收批次", "动物实验项目", "饲养费金额"])
      await expect(dashboard.getByText(label, { exact: true })).toBeVisible();

    for (const viewport of [
      { width: 1440, height: 900 },
      { width: 1180, height: 900 },
      { width: 760, height: 900 },
      { width: 844, height: 390 },
    ]) {
      await page.setViewportSize(viewport);
      await assertFeatureGroupsHidden(page, testInfo);
      if (await page.locator(".ant-mobile-navigation-sheet").isVisible())
        await page.getByRole("button", { name: "关闭", exact: true }).click();
    }

    await openFeatures(page);
    for (const { name } of features) await setFeature(page, name, true);
    await saveFeatures(page);
    await page.setViewportSize({ width: 1440, height: 900 });
    await expect(page.locator(".ant-main-menu").getByRole("menuitem", { name: /笼卡管理$/ })).toBeVisible();
  });

  test("a hidden persisted view returns to overview after refresh and does not stop existing APIs", async ({
    page,
  }) => {
    await page.goto("/app");
    await openNavigationEntry(page, "饲养费管理", "录入数量统计表");
    await expect(page.getByRole("heading", { name: "录入数量统计表", exact: true })).toBeVisible();
    await openFeatures(page);
    await setFeature(page, "饲养费管理", false);
    await saveFeatures(page);

    await page.evaluate(() =>
      localStorage.setItem("cageledger.ui.v2", JSON.stringify({ activeView: "billing-quantity-entry" })),
    );
    await page.reload();
    await expect(page.getByRole("heading", { name: "实验动物笼位管理与计费系统", exact: true })).toBeVisible();
    await expect(page.locator(".ant-main-menu").getByRole("menuitem", { name: "饲养费管理", exact: true })).toHaveCount(
      0,
    );
    expect((await page.request.get("/api/quantity-sheets?limit=10&offset=0")).ok()).toBe(true);
  });

  test("hiding fee entry modules keeps the shared settlement history readable and removes settlement shortcuts from technical services", async ({
    page,
  }) => {
    await page.goto("/app");
    await openFeatures(page);
    await setFeature(page, "饲养费管理", false);
    await setFeature(page, "技术服务费管理", false);
    await saveFeatures(page);
    await expect(page.locator(".ant-main-menu").getByRole("menuitem", { name: /结算管理$/ })).toBeVisible();
    expect((await page.request.get("/api/settlement-candidates?limit=10&offset=0")).ok()).toBe(true);
    expect((await page.request.get("/api/billing-workflows?limit=10&offset=0")).ok()).toBe(true);

    await openFeatures(page);
    await setFeature(page, "饲养费管理", true);
    await setFeature(page, "技术服务费管理", true);
    await setFeature(page, "结算管理", false);
    await saveFeatures(page);
    await openNavigationEntry(page, "技术服务费管理", "录入技术服务明细");
    await expect(page.getByRole("button", { name: "单据跟踪", exact: true })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "汇总导出", exact: true })).toHaveCount(0);
  });

  test("non-administrators can read configuration but cannot open or overwrite it", async ({
    page,
    playwright,
    browser,
  }) => {
    const username = `system-features-${test.info().retry}-${Date.now()}`;
    const created = await page.request.post("/api/users", {
      data: {
        username,
        password: "system-features-e2e",
        displayName: "功能开关普通用户",
        role: "room_admin",
        roomIds: [],
      },
    });
    expect(created.ok(), await created.text()).toBe(true);
    const api = await playwright.request.newContext({ baseURL: test.info().project.use.baseURL });
    const context = await browser.newContext();
    try {
      expect((await api.post("/api/auth/login", { data: { username, password: "system-features-e2e" } })).ok()).toBe(
        true,
      );
      expect((await api.get("/api/system/features")).ok()).toBe(true);
      expect(
        (
          await api.put("/api/system/features", {
            data: { enabled: allEnabled, expectedUpdatedAt: null },
          })
        ).status(),
      ).toBe(403);

      const regular = await context.newPage();
      await regular.route("**/api/release-announcements**", (route) => {
        if (route.request().method() !== "GET") return route.fallback();
        const version = route.request().url().split("/").at(-1) || "";
        return route.fulfill({ json: { version, acknowledged: true, acknowledgedVersions: [APP_VERSION] } });
      });
      await regular.goto("/app");
      await regular.getByLabel("用户名", { exact: true }).fill(username);
      await regular.getByLabel("密码", { exact: true }).fill("system-features-e2e");
      await regular.getByRole("button", { name: "登录", exact: true }).click();
      await regular.getByRole("menuitem", { name: /系统设置$/ }).click();
      await expect(regular.getByRole("menuitem", { name: /系统功能$/ })).toHaveCount(0);
    } finally {
      await api.dispose();
      await context.close();
    }
  });

  test("loads hidden feature flags with the session without a second feature request", async ({ page }) => {
    const current = await readFeatures(page.request);
    expect(
      (
        await page.request.put("/api/system/features", {
          data: { enabled: { ...current.item.enabled, quarantine: false }, expectedUpdatedAt: current.item.updatedAt },
        })
      ).ok(),
    ).toBe(true);
    const requests: string[] = [];
    page.on("request", (request) => requests.push(request.url()));
    await page.goto("/app");
    await expect(page.getByRole("menuitem", { name: /笼卡管理$/ })).toBeVisible();
    await expect(page.getByRole("menuitem", { name: /检疫管理$/ })).toHaveCount(0);
    expect(requests.some((url) => url.includes("/api/auth/me?include=features"))).toBe(true);
    expect(requests.some((url) => new URL(url).pathname === "/api/system/features")).toBe(false);
  });

  test("shows a retryable loading error without treating it as all features enabled", async ({ page }) => {
    await page.route("**/api/auth/me?include=features", async (route) => {
      const response = await route.fetch();
      const session = await response.json();
      delete session.features;
      await route.fulfill({ response, json: session });
    });
    await page.route("**/api/system/features", (route) =>
      route.fulfill({ status: 503, json: { error: "暂时不可用" } }),
    );
    await page.goto("/app");
    await expect(page.getByText("系统功能加载失败", { exact: true })).toBeVisible();
    await expect(page.getByRole("menuitem", { name: /笼卡管理$/ })).toHaveCount(0);
  });
});
