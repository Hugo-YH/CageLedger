import type { Route } from "@playwright/test";
import { expect, openIntakeEntry, openQuantityEntry, test } from "./fixtures";

test.beforeEach(async ({ page }) => {
  await page.goto("/app");
  await page.getByLabel("用户名", { exact: true }).fill("admin");
  await page.getByLabel("密码", { exact: true }).fill("admin123");
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await expect(page.getByRole("button", { name: "退出登录" })).toBeVisible();
});

test("the intake entry does not load its hidden batch list", async ({ page }) => {
  const batchRequests: string[] = [];
  page.on("request", (request) => {
    if (new URL(request.url()).pathname === "/api/intake-batches") batchRequests.push(request.url());
  });
  await openIntakeEntry(page);
  await expect(page.getByRole("heading", { name: "接收笼卡", exact: true })).toBeVisible();
  expect(batchRequests).toEqual([]);
});

test("late IACUC blur results cannot overwrite a new code or a new draft", async ({ page }) => {
  const requests = new Map<string, Route>();
  await page.route("**/api/iacuc-index?*", (route) => {
    const code = new URL(route.request().url()).searchParams.get("q") || "";
    requests.set(code, route);
  });
  await openQuantityEntry(page);
  const code = page.getByLabel("IACUC 编号", { exact: true });
  const project = page.getByRole("textbox", { name: "项目名称", exact: true });
  await code.fill("Z2026011");
  await code.press("Tab");
  await expect.poll(() => requests.has("Z2026011")).toBe(true);
  await code.fill("Z2026012");
  await requests.get("Z2026011")?.fulfill({ json: { items: [{ iacuc: "Z2026011", project: "旧项目" }] } });
  await expect(code).toHaveValue("Z2026012");
  await expect(project).not.toHaveValue("旧项目");
  await expect.poll(() => requests.has("Z2026012")).toBe(true);
  await requests.get("Z2026012")?.fulfill({ json: { items: [{ iacuc: "Z2026012", project: "当前项目" }] } });
  await expect(project).toHaveValue("当前项目");

  await code.fill("Z2026013");
  await code.press("Tab");
  await expect.poll(() => requests.has("Z2026013")).toBe(true);
  await page.getByRole("button", { name: "新建", exact: true }).click();
  await requests.get("Z2026013")?.fulfill({ json: { items: [{ iacuc: "Z2026013", project: "已丢弃项目" }] } });
  await expect(code).toHaveValue("");
  await expect(project).toHaveValue("");
});

test("IACUC lookup errors give feedback and the same field can retry", async ({ page }, testInfo) => {
  let recovered = false;
  await page.route("**/api/iacuc-index?*", async (route) => {
    if (!recovered) {
      await route.fulfill({ status: 403, json: { error: "没有权限读取伦理信息" } });
    } else {
      await route.fulfill({ json: { items: [{ iacuc: "Z2026021", project: "恢复后的项目" }] } });
    }
  });
  await openQuantityEntry(page);
  const code = page.getByLabel("IACUC 编号", { exact: true });
  await code.fill("Z2026021");
  await code.press("Tab");
  const error = page.getByRole("alert").filter({ hasText: "IACUC 信息匹配失败：没有权限读取伦理信息" });
  await expect(error).toBeVisible();
  await page.getByRole("button", { name: /^计费扩展选项/ }).click();
  await page.getByRole("button", { name: "新增区间", exact: true }).click();
  await page.getByLabel("收费说明", { exact: true }).fill("特殊饲料与长说明 " + "X".repeat(100));
  for (const viewport of [
    { width: 1440, height: 900 },
    { width: 1200, height: 900 },
    { width: 1180, height: 820 },
    { width: 992, height: 820 },
    { width: 768, height: 900 },
    { width: 760, height: 900 },
    { width: 390, height: 844 },
    { width: 844, height: 390 },
  ]) {
    await page.setViewportSize(viewport);
    await expect(error).toBeVisible();
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await expect
      .poll(() =>
        page.locator(".quantity-sheet-fields").evaluate((form) => {
          const bounds = form.getBoundingClientRect();
          return Array.from(
            form.querySelectorAll<HTMLElement>(
              "input:not([type=hidden]), .ant-select, .ant-input-number, .quantity-options-toggle",
            ),
          )
            .filter((control) => control.offsetWidth > 0 && getComputedStyle(control).visibility !== "hidden")
            .filter((control) => {
              const rect = control.getBoundingClientRect();
              return rect.left < bounds.left - 1 || rect.right > bounds.right + 1;
            })
            .map((control) => control.getAttribute("aria-label") || control.className);
        }),
      )
      .toEqual([]);
    for (const control of [
      page.locator(".quantity-sheet-fields .ant-picker").first(),
      page.locator(".quantity-room-select"),
      code,
      page.getByLabel("登记人员", { exact: true }),
    ]) {
      await expect(control).toHaveCSS("height", "32px");
    }
    for (const [section, target] of [
      ["fields", code],
      ["billing-options", page.getByLabel("收费说明", { exact: true })],
    ] as const) {
      await target.scrollIntoViewIfNeeded();
      const name = `quantity-error-${section}-${viewport.width}x${viewport.height}`;
      const screenshot = testInfo.outputPath(`${name}.png`);
      await page.screenshot({ path: screenshot, fullPage: true, animations: "disabled" });
      await testInfo.attach(name, { path: screenshot, contentType: "image/png" });
    }
  }
  recovered = true;
  await code.focus();
  await code.press("Tab");
  await expect(page.getByRole("textbox", { name: "项目名称", exact: true })).toHaveValue("恢复后的项目");
  await expect(error).toBeHidden();
});
