import type { Page, TestInfo } from "@playwright/test";

import { expect, openQuantityEntry, test } from "./fixtures";

test("quantity workspace keeps its desktop and mobile layout contract", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/");
  await page.getByLabel("用户名", { exact: true }).fill("admin");
  await page.getByLabel("密码", { exact: true }).fill("admin123");
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await openQuantityEntry(page);

  const editor = page.locator(".quantity-entry-panel");
  const entryTable = page.locator(".quantity-entry-table");
  await expect(page.getByRole("heading", { name: "数量统计表（录入）", exact: true })).toBeVisible();
  await expect(editor).toBeVisible();
  await expect(entryTable).toBeVisible();
  await expect(entryTable.locator("thead th")).toHaveCount(10);
  await expect(page.locator(".quantity-entry-wrap")).toHaveCSS("max-height", "none");
  await attachViewport(page, testInfo, "quantity-1280");

  await page.setViewportSize({ width: 1180, height: 820 });
  await expect(editor).toBeVisible();
  await expect(page.getByRole("button", { name: "保存统计表", exact: true })).toBeVisible();
  await attachViewport(page, testInfo, "quantity-1180");

  await page.setViewportSize({ width: 760, height: 900 });
  await expect(page.getByRole("button", { name: "保存统计表", exact: true })).toBeVisible();
  await expect(page.locator(".quantity-entry-wrap")).toHaveCSS("overflow-x", "auto");
  await attachViewport(page, testInfo, "quantity-760");
});

async function attachViewport(page: Page, testInfo: TestInfo, name: string) {
  await testInfo.attach(name, {
    body: await page.screenshot({ fullPage: true }),
    contentType: "image/png",
  });
}
