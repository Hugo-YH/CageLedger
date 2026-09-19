import { expect, openNavigationEntry, openQuantityEntry, test } from "./fixtures";
import type { Locator, Page, TestInfo } from "@playwright/test";
import { writeFile } from "node:fs/promises";

const desktopViewports = [
  { name: "wide desktop", width: 1440, height: 900 },
  { name: "compact desktop", width: 1180, height: 900 },
] as const;

const publicCageCard = {
  qrId: "DESKTOP-SAFE",
  batchNo: "桌面兼容性静态笼卡",
  cageCode: "E2E-01",
  roomName: "兼容性测试房间",
  rackName: "测试笼架 01",
  slotCode: "A-01",
  iacuc: "E2E-IACUC-001",
  project: "桌面兼容性测试项目",
  pi: "测试负责人",
  owner: "测试实验员",
  speciesLabel: "小鼠",
  animalCount: 4,
  statusLabel: "已入驻",
};

async function login(page: Page) {
  await page.goto("/app");
  const username = page.getByLabel("用户名", { exact: true });
  await expect(username).toBeFocused();
  await username.fill("admin");
  await page.getByLabel("密码", { exact: true }).fill("admin123");
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await expect(page.getByRole("button", { name: "退出登录", exact: true })).toBeVisible();
  await waitForDashboardChartReady(page);
}

async function expectNoHorizontalOverflow(page: Page) {
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
}

async function waitForDashboardChartReady(page: Page) {
  const trend = page.locator(".ant-dashboard-trend");
  await expect(trend).toBeVisible();
  await expect(trend.locator(".ant-dashboard-chart-loading")).toHaveCount(0);
}

async function captureDesktopEvidence(page: Page, target: Locator, testInfo: TestInfo, name: string) {
  const screenshot = testInfo.outputPath(`${name}.png`);
  await page.screenshot({ path: screenshot, animations: "disabled" });
  await testInfo.attach(`${name}-screenshot`, { path: screenshot, contentType: "image/png" });
  const computedStyle = testInfo.outputPath(`${name}-computed-style.json`);
  const evidence = JSON.stringify(
    await target.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return {
        rect: rect.toJSON(),
        display: style.display,
        position: style.position,
        width: style.width,
        minWidth: style.minWidth,
        overflowX: style.overflowX,
        dataSticky: element.getAttribute("data-sticky"),
        documentWidth: document.documentElement.scrollWidth,
        viewportWidth: innerWidth,
        activeElement: document.activeElement?.getAttribute("aria-label") ?? document.activeElement?.tagName,
      };
    }),
    null,
    2,
  );
  await writeFile(computedStyle, evidence);
  await testInfo.attach(`${name}-computed-style`, {
    path: computedStyle,
    contentType: "application/json",
  });
}

for (const viewport of desktopViewports) {
  test(`desktop compatibility: public and login surfaces stay operable at ${viewport.name}`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize(viewport);
    await page.emulateMedia({ colorScheme: "light", reducedMotion: "reduce" });

    await page.goto("/");
    await expect(page.locator('[data-feature="project-home"]')).toBeVisible();
    const enter = page.getByRole("link", { name: /进入系统/ }).first();
    await expect(enter).toBeInViewport();
    await enter.focus();
    await expect(enter).toBeFocused();
    await expectNoHorizontalOverflow(page);

    await enter.press("Enter");
    await expect(page).toHaveURL(/\/app$/);
    await expect(page.getByLabel("用户名", { exact: true })).toBeFocused();
    await login(page);
    await expect(page.locator('[data-ui="workspace"]')).toBeVisible();
    await expectNoHorizontalOverflow(page);

    await page.route("**/api/public/cage-card/DESKTOP-SAFE", (route) =>
      route.fulfill({ json: { item: publicCageCard } }),
    );
    await page.goto("/c/DESKTOP-SAFE");
    await expect(page.getByRole("heading", { name: publicCageCard.batchNo, exact: true })).toBeVisible();
    await expect(page.getByText("已入驻", { exact: true })).toBeVisible();
    await expect(page.getByText("4 只", { exact: true })).toBeVisible();
    await expect(page.locator(".public-scan-card")).toBeInViewport();
    await expectNoHorizontalOverflow(page);
    await captureDesktopEvidence(page, page.locator(".public-scan-card"), testInfo, `public-scan-${viewport.width}`);
  });
}

test("desktop compatibility: quantity draft and focus survive system theme and motion changes, and sticky restores after a short desktop viewport", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 1180, height: 900 });
  await page.emulateMedia({ colorScheme: "light", reducedMotion: "no-preference" });
  await login(page);
  await openQuantityEntry(page);

  const project = page.getByRole("textbox", { name: "项目名称", exact: true });
  const toolbar = page.locator(".quantity-entry-toolbar");
  await project.fill("桌面主题切换后保留的数量表草稿");
  await project.focus();
  await expect(project).toBeFocused();
  await expect(toolbar).toHaveCSS("position", "sticky");

  for (const [colorScheme, reducedMotion] of [
    ["dark", "reduce"],
    ["light", "no-preference"],
  ] as const) {
    await page.emulateMedia({ colorScheme, reducedMotion });
    await expect(page.locator("html")).toHaveAttribute("data-theme", colorScheme);
    await expect(project).toHaveValue("桌面主题切换后保留的数量表草稿");
    await expect(project).toBeFocused();
    await page.keyboard.press("End");
    await expect(project).toBeFocused();
  }

  await page.setViewportSize({ width: 1180, height: 500 });
  await expect(toolbar).toHaveCSS("position", "relative");
  await expect(project).toHaveValue("桌面主题切换后保留的数量表草稿");
  await expect(project).toBeFocused();

  await page.setViewportSize({ width: 1180, height: 900 });
  await expect(toolbar).toHaveCSS("position", "sticky");
  await expect(project).toHaveValue("桌面主题切换后保留的数量表草稿");
  await expect(project).toBeFocused();
  await expectNoHorizontalOverflow(page);
  await captureDesktopEvidence(page, toolbar, testInfo, "quantity-toolbar-restored");
});

test("desktop compatibility: manual scanner query shows a static result and retries a transient failure", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await login(page);
  await openNavigationEntry(page, "笼卡管理", "二维码扫描");

  let retryAttempts = 0;
  await page.route("**/api/public/cage-card/DESKTOP-RETRY", (route) => {
    retryAttempts += 1;
    if (retryAttempts === 1) {
      return route.fulfill({ status: 503, json: { error: "桌面兼容性临时查询失败" } });
    }
    return route.fulfill({ json: { item: { ...publicCageCard, qrId: "DESKTOP-RETRY", batchNo: "重试后的静态笼卡" } } });
  });
  await page.route("**/api/public/cage-card/DESKTOP-OK", (route) =>
    route.fulfill({ json: { item: { ...publicCageCard, qrId: "DESKTOP-OK", batchNo: "手动查询静态笼卡" } } }),
  );

  const code = page.getByLabel("笼卡识别码", { exact: true });
  const resultTitle = page.locator(".scanner-result-card .ant-card-head-title");
  await expect(code).toBeFocused();
  await code.fill("desktop-ok");
  await page.getByRole("button", { name: "查询", exact: true }).click();
  await expect(resultTitle).toHaveText("手动查询静态笼卡");
  await expect(code).toHaveValue("desktop-ok");

  await code.fill("desktop-retry");
  await page.getByRole("button", { name: "查询", exact: true }).click();
  await expect(page.getByText("查询失败", { exact: true })).toBeVisible();
  await expect(code).toHaveValue("desktop-retry");
  const retry = page.getByRole("button", { name: "重新查询", exact: true });
  await retry.focus();
  await expect(retry).toBeFocused();
  await retry.press("Enter");
  await expect(resultTitle).toHaveText("重试后的静态笼卡");
  expect(retryAttempts).toBe(2);
  await expectNoHorizontalOverflow(page);
  await captureDesktopEvidence(page, page.locator(".scanner-card"), testInfo, "manual-scanner-retry");
});
