import { writeFile } from "node:fs/promises";
import type { Page, Route } from "@playwright/test";

import { expect, openWorkflowCenter, test } from "./fixtures";

async function login(page: Page) {
  await page.goto("/app");
  await page.getByLabel("用户名", { exact: true }).fill("admin");
  await page.getByLabel("密码", { exact: true }).fill("admin123");
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await expect(page.getByRole("button", { name: "退出登录" })).toBeVisible();
}

test("desktop workflow keeps rows and selection through paging, failed refresh and deliberate retry", async ({
  page,
}, info) => {
  await page.setViewportSize({ width: 1180, height: 800 });
  const items = Array.from({ length: 12 }, (_, index) => ({
    id: `loading-regression-${index + 1}`,
    pi: `异步回归示例负责人${String(index + 1).padStart(2, "0")}`,
    month: "2026-09",
    iacucs: [],
    totalAmount: 100 + index,
    workflowStatus: "statement_sent",
  }));
  let mode: "hold" | "ready" | "error" = "hold";
  let held: Route | undefined;
  let writes = 0;
  function response(route: Route) {
    const offset = Number(new URL(route.request().url()).searchParams.get("offset") || 0);
    return { items: items.slice(offset, offset + 10), page: { total: 12, limit: 10, offset } };
  }
  await page.route("**/api/billing-workflows?*", async (route) => {
    if (mode === "hold") {
      held = route;
      return;
    }
    await route.fulfill(
      mode === "error" ? { status: 503, json: { error: "服务暂不可用" } } : { json: response(route) },
    );
  });
  await page.route("**/api/billing-workflows/advance", (route) => {
    writes += 1;
    return route.fulfill({ json: { ok: true, item: items[10] } });
  });
  await login(page);
  await openWorkflowCenter(page);
  await expect.poll(() => Boolean(held)).toBe(true);
  await expect(page.locator('[data-ui="page-skeleton"]')).toBeVisible();
  mode = "ready";
  await held!.fulfill({ json: response(held!) });
  const previousRow = page.getByRole("row").filter({ hasText: items[0].pi });
  await expect(previousRow).toBeVisible();
  held = undefined;
  mode = "hold";
  await page.locator(".ant-pagination-next").click();
  await expect.poll(() => Boolean(held)).toBe(true);
  await expect(previousRow).toBeVisible();
  await expect(previousRow.getByRole("button", { name: "登记", exact: true })).toBeDisabled();
  await expect(previousRow.getByRole("button", { name: "锁定", exact: true })).toBeDisabled();
  await expect(page.locator('[data-ui="page-skeleton"]')).toHaveCount(0);
  await page.screenshot({ path: info.outputPath("paging-retained.png"), animations: "disabled" });
  mode = "ready";
  await held!.fulfill({ json: response(held!) });
  const row = page.getByRole("row").filter({ hasText: items[10].pi });
  await expect(row).toBeVisible();
  await row.getByRole("checkbox").click();
  await expect(row.getByRole("checkbox")).toBeChecked();
  const headerTop = () =>
    page.locator(".app-data-table thead").evaluate((element) => element.getBoundingClientRect().top);
  const before = await headerTop();
  held = undefined;
  mode = "hold";
  await row.getByRole("button", { name: "锁定", exact: true }).click();
  await page
    .getByRole("tooltip")
    .filter({ hasText: "锁定该结算流程" })
    .getByRole("button", { name: "锁定", exact: true })
    .click();
  await expect.poll(() => Boolean(held)).toBe(true);
  await expect(page.getByText("正在更新，暂显示上次结果", { exact: true })).toBeVisible();
  expect(await headerTop()).toBeCloseTo(before, 0);
  expect(writes).toBe(1);
  mode = "error";
  await held!.fulfill({ status: 503, json: { error: "服务暂不可用" } });
  const error = page.getByRole("alert").filter({ hasText: "结算流程加载失败" });
  await expect(error).toContainText("暂显示上次结果");
  await expect(row).toBeVisible();
  await expect(row.getByRole("checkbox")).toBeChecked();
  await expect(row.getByRole("button", { name: "登记", exact: true })).toBeDisabled();
  await expect(row.getByRole("button", { name: "撤回", exact: true })).toBeDisabled();
  await expect(row.getByRole("button", { name: "锁定", exact: true })).toBeDisabled();
  await page.screenshot({ path: info.outputPath("failed-refresh-retained.png"), animations: "disabled" });
  held = undefined;
  mode = "hold";
  await error.getByRole("button", { name: "重试", exact: true }).click();
  await expect.poll(() => Boolean(held)).toBe(true);
  await expect(row).toBeVisible();
  await expect(row.getByRole("button", { name: "登记", exact: true })).toBeDisabled();
  mode = "ready";
  await held!.fulfill({ json: response(held!) });
  await expect(error).toBeHidden();
  await expect(row.getByRole("button", { name: "登记", exact: true })).toBeEnabled();
  await expect(row.getByRole("checkbox")).toBeChecked();
  expect(writes).toBe(1);
  await writeFile(
    info.outputPath("refresh-geometry.json"),
    JSON.stringify({ topBefore: before, topAfter: await headerTop(), writes }, null, 2),
  );
});

test("desktop feedback first load has a table skeleton, recoverable failure and retry", async ({ page }, info) => {
  await page.setViewportSize({ width: 1180, height: 800 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  let mode: "hold" | "error" = "hold";
  let held: Route | undefined;
  await page.route("**/api/feedback?*", async (route) => {
    if (mode === "hold") {
      held = route;
      return;
    }
    await route.fulfill({ status: 503, json: { error: "反馈服务暂不可用" } });
  });
  await login(page);
  await page
    .locator(".ant-main-menu")
    .getByRole("menuitem", { name: /帮助与反馈/ })
    .click();
  await expect.poll(() => Boolean(held)).toBe(true);
  const skeleton = page.getByRole("status", { name: "反馈列表正在加载", exact: true });
  await expect(skeleton).toBeVisible();
  await expect(skeleton).toHaveAttribute("aria-busy", "true");
  const animationDurations = await skeleton
    .locator(".ant-skeleton-input")
    .evaluateAll((elements) =>
      elements.map((element) => parseFloat(getComputedStyle(element, "::after").animationDuration)),
    );
  expect(animationDurations.length).toBeGreaterThan(0);
  expect(animationDurations.every((duration) => duration <= 0.001)).toBe(true);
  await page.screenshot({ path: info.outputPath("feedback-first-load.png"), animations: "disabled" });
  mode = "error";
  await held!.fulfill({ status: 503, json: { error: "反馈服务暂不可用" } });
  const error = page.getByRole("alert").filter({ hasText: "反馈列表加载失败" });
  await expect(error).toBeVisible();
  await expect(skeleton).toBeHidden();
  mode = "hold";
  held = undefined;
  await error.getByRole("button", { name: "重试", exact: true }).click();
  await expect.poll(() => Boolean(held)).toBe(true);
  await expect(skeleton).toBeVisible();
  await held!.fulfill({ json: { items: [], total: 0 } });
  await expect(skeleton).toBeHidden();
  await expect(page.getByText("暂无反馈记录", { exact: true })).toBeVisible();
});
