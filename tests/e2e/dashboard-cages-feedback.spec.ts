import { ensureTestInfrastructure, expect, openNavigationEntry, test } from "./fixtures";
import { captureUiAudit } from "./uiAudit";
import type { Page } from "@playwright/test";

async function login(page: Page) {
  await page.goto("/app");
  await page.getByLabel("用户名", { exact: true }).fill("admin");
  await page.getByLabel("密码", { exact: true }).fill("admin123");
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await expect(page.getByLabel("用户名", { exact: true })).toBeHidden();
}

function overview(month = "2026-08") {
  return {
    month,
    availableMonths: ["2026-08", "2026-07"],
    intake: {
      month,
      batches: 3,
      animals: 20,
      trendUnit: "day",
      trend: [{ day: 1, batches: 3, animals: 20 }],
      strains: [],
      species: [],
    },
    rooms: [],
    pi: [],
  };
}

test("dashboard month refresh preserves controls, identifies retained data, and recovers after failure", async ({
  page,
}, testInfo) => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => (release = resolve));
  let fail = true;
  let julyRequests = 0;
  await page.route("**/api/dashboard/overview*", async (route) => {
    const month = new URL(route.request().url()).searchParams.get("month");
    if (month === "2026-07") {
      julyRequests++;
      await gate;
      if (fail) {
        await route.fulfill({ status: 503, json: { error: "暂时不可用" } });
        return;
      }
    }
    await route.fulfill({ json: overview(month || undefined) });
  });
  await login(page);
  const select = page.getByRole("combobox", { name: "选择统计月份" });
  await expect(select).toBeVisible();
  await select.click();
  await page.getByTitle("2026 年 07 月", { exact: true }).click();
  await expect(select).toBeVisible();
  await expect(select).toBeFocused();
  await expect(page.getByText("当前统计月份：2026-08", { exact: true })).toBeVisible();
  await expect(page.getByText("正在更新，暂显示上次结果", { exact: true })).toBeVisible();
  await expect(page.getByRole("status", { name: "运营总览正在加载" })).toBeHidden();
  expect(julyRequests).toBe(1);
  release();
  await expect(page.getByText("运营数据更新失败，暂显示上次结果", { exact: true })).toBeVisible({ timeout: 15000 });
  await expect(select).toBeVisible();
  await captureUiAudit(page, testInfo, "dashboard-refresh-error", page.locator(".dashboard-view"));
  fail = false;
  await page.getByRole("button", { name: "重试", exact: true }).click();
  await expect(page.getByText("当前统计月份：2026-07", { exact: true })).toBeVisible();
  await expect(page.getByText("运营数据更新失败，暂显示上次结果", { exact: true })).toBeHidden();
});

test("dashboard cold skeleton fits narrow screens and reduced motion", async ({ page }, testInfo) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  let release!: () => void;
  const gate = new Promise<void>((resolve) => (release = resolve));
  await page.route("**/api/dashboard/overview*", async (route) => {
    await gate;
    await route.fulfill({ json: overview() });
  });
  await login(page);
  const skeleton = page.getByRole("status", { name: "运营总览正在加载" });
  await expect(skeleton).toBeVisible();
  await captureUiAudit(page, testInfo, "dashboard-cold", skeleton);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const size = await skeleton.evaluate((root) => {
    const title = root.querySelector(".workspace-title-line .ant-skeleton-input")!;
    return {
      width: title.getBoundingClientRect().width,
      right: title.getBoundingClientRect().right,
      viewport: innerWidth,
      animation: getComputedStyle(title, "::after").animationName,
    };
  });
  expect(size.width).toBeGreaterThan(100);
  expect(size.right).toBeLessThanOrEqual(size.viewport);
  expect(size.animation).toBe("none");
  await testInfo.attach("dashboard-cold-mobile-style", { body: JSON.stringify(size), contentType: "application/json" });
  await page.screenshot({ path: testInfo.outputPath("dashboard-cold-mobile.png") });
  release();
  await expect(page.getByRole("combobox", { name: "选择统计月份" })).toBeVisible();
});

test("cage request failures provide retry and retain an open editor during background failure", async ({
  page,
}, testInfo) => {
  await login(page);
  await ensureTestInfrastructure(page);
  let fail = true;
  let gate: Promise<void> = Promise.resolve();
  let release!: () => void;
  await page.route("**/api/bootstrap?scope=room&*", async (route) => {
    await gate;
    if (fail) await route.fulfill({ status: 503, json: { error: "暂时不可用" } });
    else await route.fallback();
  });
  await openNavigationEntry(page, "笼位管理", "笼位管理");
  await expect(page.getByText("笼位信息加载失败", { exact: true })).toBeVisible({ timeout: 15000 });
  await expect(page.getByText("当前房间尚未创建笼架", { exact: true })).toBeHidden();
  fail = false;
  await page.getByRole("button", { name: "重新加载", exact: true }).click();
  const slot = page.locator(".react-rack-scroll .slot").first();
  await expect(slot).toBeVisible();
  fail = true;
  gate = new Promise<void>((resolve) => (release = resolve));
  await page.clock.setFixedTime(new Date(Date.now() + 60_000));
  await page.evaluate(() => window.dispatchEvent(new Event("offline")));
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  await expect(page.getByText("正在更新，暂显示上次结果", { exact: true })).toBeVisible();
  await slot.click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  const field = dialog.getByRole("textbox").first();
  await field.fill("保留中的草稿");
  release();
  await expect(page.getByText("笼位信息更新失败，暂显示上次结果", { exact: true })).toBeVisible({ timeout: 15000 });
  await expect(dialog).toBeVisible();
  await expect(field).toHaveValue("保留中的草稿");
  await captureUiAudit(page, testInfo, "cage-refresh-editor", dialog);
});
