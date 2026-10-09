import { expect, test } from "./fixtures";
import type { Page } from "@playwright/test";
import type { FeedbackSubmission } from "../../src/contracts/feedback";

async function login(page: Page) {
  await page.goto("/app");
  await page.getByLabel("用户名", { exact: true }).fill("admin");
  await page.getByLabel("密码", { exact: true }).fill("admin123");
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await expect(page.getByRole("menuitem", { name: /帮助与反馈/ })).toBeVisible();
  await page.getByRole("menuitem", { name: /帮助与反馈/ }).click();
}

async function fillDraft(page: Page, title: string) {
  await page.getByLabel("标题", { exact: true }).fill(title);
  await page.getByLabel("涉及模块", { exact: true }).fill("反馈");
  await page.getByLabel("问题描述", { exact: true }).fill("诊断摘要回归测试");
}

test("diagnostics preview matches stored feedback and remains usable at all supported widths", async ({
  page,
}, testInfo) => {
  await login(page);
  await page.route("**/api/feedback?**", (route) =>
    route.fulfill({
      status: 500,
      headers: { "X-Request-ID": "0123456789abcdef" },
      json: { error: "PRIVATE_RESPONSE_PASSWORD" },
    }),
  );
  await page.getByRole("button", { name: "刷新", exact: true }).click();
  await expect(page.getByText("PRIVATE_RESPONSE_PASSWORD", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "提交反馈", exact: true }).click();
  const drawer = page.getByRole("dialog", { name: "提交反馈", exact: true });
  const checkbox = drawer.getByRole("checkbox", { name: "提交反馈时附带诊断信息" });
  await expect(checkbox).toBeChecked();
  await drawer.getByRole("button", { name: "预览诊断信息" }).click();
  const preview = drawer.getByRole("region", { name: "诊断信息预览" });
  await expect(preview).toContainText("请求编号 0123456789abcdef");
  await expect(preview).not.toContainText("PRIVATE_RESPONSE_PASSWORD");
  for (const viewport of [
    { width: 1440, height: 900 },
    { width: 1180, height: 800 },
    { width: 760, height: 900 },
    { width: 844, height: 390 },
  ]) {
    await page.setViewportSize(viewport);
    await expect(checkbox).toBeVisible();
    expect(await drawer.evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBeTruthy();
    const controls = drawer.locator("input.ant-input,.ant-select,.feedback-diagnostics .ant-btn");
    const expectedHeights = viewport.width < 768 ? ["40px", "40px", "40px", "44px", "44px"] : Array(5).fill("32px");
    // Wait for the shared mobile theme and its height transition to settle.
    await expect
      .poll(() => controls.evaluateAll((elements) => elements.map((element) => getComputedStyle(element).height)))
      .toEqual(expectedHeights);
    await checkbox.scrollIntoViewIfNeeded();
    await expect(checkbox).toBeInViewport();
    await testInfo.attach(`feedback-controls-${viewport.width}.json`, {
      body: JSON.stringify({ viewport, heights: expectedHeights }),
      contentType: "application/json",
    });
    await page.screenshot({ path: testInfo.outputPath(`feedback-diagnostics-${viewport.width}.png`), fullPage: true });
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  const title = `诊断摘要 ${Date.now()}`;
  await fillDraft(page, title);
  const posted = page.waitForRequest(
    (request) => request.method() === "POST" && new URL(request.url()).pathname === "/api/feedback",
  );
  await drawer.getByRole("button", { name: "提交", exact: true }).click();
  const body = (await posted).postDataJSON() as FeedbackSubmission;
  expect(
    body.diagnostics?.events.some((event) => event.kind === "request" && event.requestId === "0123456789abcdef"),
  ).toBeTruthy();
  expect(JSON.stringify(body.diagnostics)).not.toContain("PRIVATE_RESPONSE_PASSWORD");
  const detail = page.getByRole("dialog").filter({ hasText: title });
  await detail.getByText("随反馈提交的诊断信息", { exact: true }).click();
  await expect(detail.getByRole("region", { name: "诊断信息预览" })).toContainText("请求编号 0123456789abcdef");
  await page.unroute("**/api/feedback?**");
  const listed = await page.request.get(`/api/feedback?keyword=${encodeURIComponent(title)}`);
  const item = (await listed.json()).items[0];
  expect(item.environment).not.toHaveProperty("diagnostics");
  const stored = await page.request.get(`/api/feedback/${item.id}`);
  expect((await stored.json()).diagnostics).toEqual(body.diagnostics);
});

test("opting out omits diagnostics and a fresh feedback restores the default", async ({ page }) => {
  await login(page);
  await page.getByRole("button", { name: "提交反馈", exact: true }).click();
  let drawer = page.getByRole("dialog", { name: "提交反馈", exact: true });
  await drawer.getByRole("checkbox", { name: "提交反馈时附带诊断信息" }).uncheck();
  await fillDraft(page, `不附带诊断 ${Date.now()}`);
  const posted = page.waitForRequest(
    (request) => request.method() === "POST" && new URL(request.url()).pathname === "/api/feedback",
  );
  await drawer.getByRole("button", { name: "提交", exact: true }).click();
  expect((await posted).postDataJSON()).not.toHaveProperty("diagnostics");
  await page.getByRole("dialog").getByRole("button", { name: "关闭", exact: true }).click();
  await page.getByRole("button", { name: "提交反馈", exact: true }).click();
  drawer = page.getByRole("dialog", { name: "提交反馈", exact: true });
  await expect(drawer.getByRole("checkbox", { name: "提交反馈时附带诊断信息" })).toBeChecked();
});

test("a lost response retries the original diagnostic payload without another record", async ({ page }) => {
  await login(page);
  const submissions: FeedbackSubmission[] = [];
  await page.route("**/api/feedback", async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    submissions.push(route.request().postDataJSON());
    if (submissions.length === 1) {
      await route.fetch();
      return route.fulfill({ status: 502, json: { error: "上游未返回提交结果" } });
    }
    return route.continue();
  });
  await page.getByRole("button", { name: "提交反馈", exact: true }).click();
  const drawer = page.getByRole("dialog", { name: "提交反馈", exact: true });
  const title = `响应丢失诊断 ${Date.now()}`;
  await fillDraft(page, title);
  await drawer.getByRole("button", { name: "提交", exact: true }).click();
  await expect(drawer.getByRole("checkbox", { name: "提交反馈时附带诊断信息" })).toBeDisabled();
  await expect(drawer.getByRole("button", { name: "提交", exact: true })).toBeEnabled();
  await drawer.getByRole("button", { name: "提交", exact: true }).click();
  await expect(page.getByRole("dialog").filter({ hasText: title })).toBeVisible();
  expect(submissions).toHaveLength(2);
  expect(submissions[1]).toEqual(submissions[0]);
  const records = await page.request.get(`/api/feedback?keyword=${encodeURIComponent(title)}`);
  expect((await records.json()).total).toBe(1);
});
