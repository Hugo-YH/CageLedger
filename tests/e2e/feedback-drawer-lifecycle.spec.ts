import type { Page, Route } from "@playwright/test";
import { expect, test } from "./fixtures";

async function openFeedback(page: Page) {
  await page.goto("/app");
  await page.getByLabel("用户名", { exact: true }).fill("admin");
  await page.getByLabel("密码", { exact: true }).fill("admin123");
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await page.getByRole("menuitem", { name: /帮助与反馈/ }).click();
  await expect(page.getByRole("heading", { name: "帮助与反馈", exact: true })).toBeVisible();
}

test("feedback drawer retains draft and focus across viewports and live motion changes", async ({ page }, info) => {
  const health = await (await page.request.get("/api/health")).json();
  expect(health.database).toContain("cageledger-e2e-");
  await info.attach("isolated-database", {
    body: JSON.stringify({ database: health.database }),
    contentType: "application/json",
  });
  await page.setViewportSize({ width: 1440, height: 900 });
  await openFeedback(page);
  const trigger = page.getByRole("button", { name: "提交反馈", exact: true });
  await trigger.focus();
  await trigger.press("Enter");
  const drawer = page.getByRole("dialog", { name: "提交反馈", exact: true });
  const title = drawer.getByLabel("标题", { exact: true });
  await title.fill("长标题草稿".repeat(20));
  await title.focus();
  const original = await title.elementHandle();
  for (const [width, height] of [
    [1440, 900],
    [1180, 800],
    [760, 900],
    [844, 390],
  ]) {
    await page.setViewportSize({ width, height });
    await title.focus();
    for (const reducedMotion of ["reduce", "no-preference"] as const) {
      await page.emulateMedia({ reducedMotion });
      await expect(title).toBeFocused();
      await expect(title).toHaveValue("长标题草稿".repeat(20));
      expect(await title.evaluate((element, node) => element === node, original)).toBe(true);
    }
    const bounds = await drawer.boundingBox();
    expect(bounds!.x).toBeGreaterThanOrEqual(0);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width + 1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    await page.screenshot({ path: info.outputPath(`feedback-drawer-draft-${width}x${height}.png`) });
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  await drawer.getByRole("button", { name: "取消", exact: true }).click();
  await expect(drawer).toHaveCount(0);
  await expect(page.locator(".ant-drawer-mask:visible")).toHaveCount(0);
  await expect(trigger).toBeFocused();
  await trigger.click();
  await expect(drawer.getByLabel("标题", { exact: true })).toHaveValue("");
  await drawer.getByRole("button", { name: "取消", exact: true }).click();
  await expect(drawer).toHaveCount(0);
});

test("feedback detail closes during loading and can retry an error without reopening late", async ({ page }, info) => {
  await openFeedback(page);
  const title = `详情长标题-${"测试".repeat(60)}-${Date.now()}`;
  const created = await page.request.post("/api/feedback", {
    data: {
      requestId: crypto.randomUUID(),
      title,
      kind: "bug",
      module: "反馈",
      description: "详情内容",
      environment: {},
    },
  });
  expect(created.ok(), await created.text()).toBe(true);
  const item = (await created.json()).item;
  const response = await page.request.get(`/api/feedback/${item.id}`);
  const detail = await response.json();
  let held: Route | undefined;
  let attempt = 0;
  await page.route(`**/api/feedback/${item.id}`, async (route) => {
    attempt += 1;
    if (attempt === 1) {
      held = route;
      return;
    }
    if (attempt >= 2 && attempt <= 4) {
      await route.fulfill({ status: 503, json: { error: "测试详情错误" } });
      return;
    }
    await route.fulfill({ json: detail });
  });
  await page.getByRole("button", { name: "刷新", exact: true }).click();
  const trigger = page.getByRole("button", { name: `查看反馈 #${item.number}：${title}`, exact: true });
  const titleText = trigger.locator(".feedback-title-text");
  await expect(titleText).toHaveText(title);
  const metrics = await titleText.evaluate((element) => ({
    height: element.getBoundingClientRect().height,
    lineHeight: parseFloat(getComputedStyle(element).lineHeight),
    scrollHeight: element.scrollHeight,
  }));
  expect(metrics.height).toBeLessThanOrEqual(metrics.lineHeight * 2 + 1);
  expect(metrics.scrollHeight).toBeGreaterThan(metrics.height + 1);
  await trigger.hover();
  await expect(page.getByRole("tooltip").filter({ hasText: title })).toBeVisible();
  await page.screenshot({ path: info.outputPath("feedback-list-long-title-tooltip.png") });
  await trigger.focus();
  await expect(trigger).toBeFocused();
  await trigger.press("Enter");
  await expect.poll(() => Boolean(held)).toBe(true);
  const drawer = page.getByRole("dialog", { name: "反馈详情", exact: true });
  await expect(drawer).toBeVisible();
  await info.attach("feedback-detail-loading", { body: await page.screenshot(), contentType: "image/png" });
  await drawer.getByRole("button", { name: "关闭", exact: true }).click();
  await expect(drawer).toHaveCount(0);
  await expect(page.locator(".ant-drawer-mask:visible")).toHaveCount(0);
  await expect(trigger).toBeFocused();
  await held!.fulfill({ json: detail }).catch(() => {});
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await trigger.click();
  await expect(page.getByText("反馈详情加载失败", { exact: true })).toBeVisible({ timeout: 15000 });
  await page.screenshot({ path: info.outputPath("feedback-detail-error.png") });
  await page.getByRole("button", { name: "重试", exact: true }).click();
  const loaded = page.getByRole("dialog", { name: `#${item.number} ${title}`, exact: true });
  await expect(loaded).toBeVisible();
  await expect(loaded.getByText("详情内容", { exact: true })).toBeVisible();
  for (const [width, height] of [
    [1440, 900],
    [1180, 800],
    [760, 900],
    [844, 390],
  ]) {
    await page.setViewportSize({ width, height });
    const bounds = await loaded.boundingBox();
    expect(bounds!.x).toBeGreaterThanOrEqual(0);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width + 1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    await page.screenshot({ path: info.outputPath(`feedback-detail-long-title-${width}x${height}.png`) });
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  await loaded.getByRole("button", { name: "关闭", exact: true }).click();
  await expect(loaded).toHaveCount(0);
  await expect(page.locator(".ant-drawer-mask:visible")).toHaveCount(0);
  await expect(trigger).toBeFocused();
});

test("feedback submission locks controls while pending and recovers after failure", async ({ page }, info) => {
  await openFeedback(page);
  let held: Route | undefined;
  const requests: unknown[] = [];
  await page.route("**/api/feedback", async (route) => {
    if (route.request().method() === "POST") {
      held = route;
      requests.push(route.request().postDataJSON());
      return;
    }
    await route.fallback();
  });
  const trigger = page.getByRole("button", { name: "提交反馈", exact: true });
  await trigger.click();
  const drawer = page.getByRole("dialog", { name: "提交反馈", exact: true });
  await drawer.getByLabel("标题", { exact: true }).fill("测试提交");
  await drawer.getByLabel("涉及模块", { exact: true }).fill("反馈");
  await drawer.getByLabel("问题描述", { exact: true }).fill("测试内容");
  await drawer.getByRole("button", { name: "提交", exact: true }).click();
  await expect.poll(() => Boolean(held)).toBe(true);
  await expect(drawer.getByLabel("标题", { exact: true })).toBeDisabled();
  await expect(drawer.getByRole("button", { name: "取消", exact: true })).toBeDisabled();
  await expect(drawer.getByRole("button", { name: "提交", exact: true })).toBeDisabled();
  await page.keyboard.press("Escape");
  await expect(drawer).toBeVisible();
  await page.screenshot({ path: info.outputPath("feedback-submit-pending.png") });
  await held!.fulfill({ status: 503, json: { error: "测试提交失败" } });
  await expect(drawer.getByText("测试提交失败", { exact: true })).toBeVisible();
  await expect(drawer.getByLabel("标题", { exact: true })).toBeDisabled();
  await expect(drawer.getByRole("button", { name: "提交", exact: true })).toBeEnabled();
  await expect(drawer.getByRole("button", { name: "取消", exact: true })).toBeEnabled();
  await page.screenshot({ path: info.outputPath("feedback-submit-error.png") });
  await drawer.getByRole("button", { name: "提交", exact: true }).click();
  await expect.poll(() => requests.length).toBe(2);
  expect(requests[1]).toEqual(requests[0]);
  await held!.fulfill({ status: 400, json: { error: "测试明确失败" } });
  await expect(drawer.getByText("测试明确失败", { exact: true })).toBeVisible();
  await expect(drawer.getByLabel("标题", { exact: true })).toBeEnabled();
  await expect(drawer.getByLabel("标题", { exact: true })).toHaveValue("测试提交");
  await drawer.getByRole("button", { name: "取消", exact: true }).click();
  await expect(drawer).toHaveCount(0);
});
