import type { Page, Route } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import type { SettlementCandidate } from "../../src/contracts/billing";
import { expect, openNavigationEntry, openQuantityEntry, test } from "./fixtures";

test.use({ actionTimeout: 10_000 });

async function login(page: Page) {
  await page.goto("/app");
  await page.getByLabel("用户名", { exact: true }).fill("admin");
  await page.getByLabel("密码", { exact: true }).fill("admin123");
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await expect(page.getByRole("heading", { name: "实验动物笼位管理与计费系统", exact: true })).toBeVisible();
}

async function filterColumn(page: Page, label: string, value: string) {
  await page.getByRole("button", { name: "筛选" + label, exact: true }).click();
  const options = page.getByRole("group", { name: "筛选" + label + "选项", exact: true });
  await options.getByRole("button", { name: "清空", exact: true }).click();
  await options.getByRole("checkbox", { name: value, exact: false }).click();
  await options.getByRole("button", { name: "应用", exact: true }).click();
  await expect(options).toBeHidden();
}

test("batch selection explains mixed fees, full-filter loading, paging and clearing", async ({ page }) => {
  const items: SettlementCandidate[] = Array.from({ length: 12 }, (_, index) => ({
    id: "ux46-candidate-" + index,
    month: "2096-04",
    pi: "范围负责人 " + String(index + 1).padStart(2, "0"),
    feeType: index === 0 ? undefined : index < 8 ? "feeding" : "technical_service",
    iacucs: ["UX46"],
    manager: "范围登记员",
    totalAmount: 30,
    hasWorkflow: false,
  }));
  let held: { route: Route; items: SettlementCandidate[] } | undefined;
  let holdAll = true;
  await page.route("**/api/settlement-candidates?*", async (route) => {
    const query = new URL(route.request().url()).searchParams;
    const filters = JSON.parse(query.get("columnFilters") || "{}") as Record<string, string[]>;
    const selected = items.filter(
      (item) => !filters.feeType?.length || filters.feeType.includes(item.feeType || "feeding"),
    );
    const limit = Number(query.get("limit"));
    const offset = Number(query.get("offset"));
    if (holdAll && limit === 100) {
      held = { route, items: selected };
      return;
    }
    await route.fulfill({
      json: { items: selected.slice(offset, offset + limit), page: { total: selected.length, limit, offset } },
    });
  });
  await page.route("**/api/settlement-candidates/filter-options?*", (route) =>
    route.fulfill({
      json: {
        items: [
          { value: "feeding", label: "饲养费", count: 8 },
          { value: "technical_service", label: "技术服务费", count: 4 },
        ],
      },
    }),
  );
  await login(page);
  await openNavigationEntry(page, "结算管理", "结算列表");
  const toolbar = page.getByRole("group", { name: "结算批量操作", exact: true });
  const all = page.getByRole("checkbox", { name: "全选当前筛选结果结算项", exact: true });
  await all.click();
  await expect(toolbar).toContainText("正在读取筛选结果");
  await expect(toolbar.getByRole("button", { name: "导出 PDF", exact: true })).toBeDisabled();
  await expect.poll(() => Boolean(held)).toBe(true);
  holdAll = false;
  await held!.route.fulfill({ json: { items: held!.items, page: { total: 12, limit: 100, offset: 0 } } });
  await expect(toolbar).toContainText("已选 12 项：饲养费 8 项、技术服务费 4 项");
  await page.locator(".ant-pagination-next").click();
  await expect(page.locator(".ant-pagination-item-active")).toHaveText("2");
  await expect(toolbar).toContainText("已选 12 项：饲养费 8 项、技术服务费 4 项");
  await toolbar.getByRole("button", { name: "清空选择", exact: true }).click();
  await expect(all).not.toBeChecked();
  await expect(toolbar).not.toContainText("已选 12 项");
  await all.click();
  await expect(toolbar).toContainText("已选 12 项");
  await filterColumn(page, "费用类型", "技术服务费");
  await expect(toolbar).not.toContainText("已选 12 项");
  await expect(page.locator(".ant-pagination-item-active")).toHaveText("1");
  await all.click();
  await expect(toolbar).toContainText("已选 4 项：饲养费 0 项、技术服务费 4 项");
});

test("service date cards retain drafts and focus, add-row motion and saved-row feedback", async ({ page }, info) => {
  test.setTimeout(120_000);
  await login(page);
  const iacuc = "Z2096401";
  const uploaded = await page.request.post("/api/iacuc-index/upload", {
    multipart: {
      file: {
        name: "ux46-service.csv",
        mimeType: "text/csv",
        buffer: Buffer.from(
          "动物伦理编号,动物实验名称,项目负责人,实验负责人,项目来源\n" +
            iacuc +
            ",手机录入核对项目,UX46负责人,UX46实验负责人,UX46经费\n",
        ),
      },
    },
  });
  expect(uploaded.ok(), await uploaded.text()).toBeTruthy();
  await page.evaluate(() => {
    (window as Window & { ux46Animations?: string[] }).ux46Animations = [];
    document.addEventListener("animationstart", (event) => {
      if (event.animationName.startsWith("technical-service-"))
        (window as Window & { ux46Animations?: string[] }).ux46Animations?.push(event.animationName);
    });
  });
  let savedId = "";
  try {
    await openNavigationEntry(page, "技术服务费管理", "录入技术服务明细");
    await page.locator("#service-month").fill("2096-04");
    await page.locator("#service-month").press("Enter");
    await page.locator("#service-iacuc").fill(iacuc);
    await page.locator("#service-iacuc").blur();
    await expect(page.getByRole("region", { name: "IACUC项目信息", exact: true })).toContainText("UX46负责人");
    await page.locator("#service-item").click();
    await page.locator("#service-item").fill("大动物滴眼");
    await page.locator("#service-item").press("Enter");
    await expect(page.getByText("30.00 元／眼", { exact: true })).toBeVisible();
    for (const [index, [day, quantity]] of [
      [1, 2],
      [2, 2],
      [3, 4],
      [10, 2],
    ].entries()) {
      if (index) {
        await page.getByRole("button", { name: "添加服务日期", exact: true }).click();
        await expect(page.getByLabel("服务日期 " + (index + 1), { exact: true })).toBeFocused();
      }
      const date = page.getByLabel("服务日期 " + (index + 1), { exact: true });
      await date.fill("2096-04-" + String(day).padStart(2, "0"));
      await date.press("Enter");
      await page.getByLabel("计费数量 " + (index + 1), { exact: true }).fill(String(quantity));
      await expect(date).toHaveValue("2096-04-" + String(day).padStart(2, "0"));
      await expect(page.getByRole("region", { name: "技术服务费用核对", exact: true })).toContainText(
        index + 1 + "个服务日",
      );
    }
    await expect
      .poll(() =>
        page.evaluate(() =>
          (window as Window & { ux46Animations?: string[] }).ux46Animations?.includes("technical-service-row-added"),
        ),
      )
      .toBe(true);
    const quantity = page.getByLabel("计费数量 3", { exact: true });
    await quantity.focus();
    await page.keyboard.press("Escape");
    const originalInput = await quantity.elementHandle();
    for (const [width, height] of [
      [1440, 900],
      [1180, 900],
      [760, 900],
      [390, 844],
      [844, 390],
    ]) {
      await page.setViewportSize({ width, height });
      await expect(quantity).toHaveValue("4");
      await expect(quantity).toBeFocused();
      expect(await quantity.evaluate((element, original) => element === original, originalInput)).toBe(true);
      await quantity.scrollIntoViewIfNeeded();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBeTruthy();
      if (width <= 767 || height <= 480) {
        const geometry = await page.locator(".technical-service-date-table").evaluate((element) => {
          const body = element.querySelector<HTMLElement>(".ant-table-content")!;
          const date = element.querySelector<HTMLElement>('[aria-label="服务日期 1"]')!;
          const amount = element.querySelector(".technical-service-amount-cell")!.getBoundingClientRect();
          const action = element.querySelector(".technical-service-date-action")!.getBoundingClientRect();
          return {
            overflow: body.scrollWidth > body.clientWidth + 1,
            inputWidth: date.getBoundingClientRect().width,
            secondaryRowAlignment: Math.abs(amount.top + amount.height / 2 - action.top - action.height / 2),
          };
        });
        expect(geometry.overflow).toBe(false);
        expect(geometry.inputWidth).toBeGreaterThanOrEqual(115);
        expect(geometry.secondaryRowAlignment).toBeLessThanOrEqual(1);
      }
      await info.attach("service-date-layout-" + width, { body: await page.screenshot(), contentType: "image/png" });
    }
    const axe = await new AxeBuilder({ page }).include(".technical-service-layout").analyze();
    expect(axe.violations.filter((item) => ["serious", "critical"].includes(item.impact || ""))).toEqual([]);
    await page.emulateMedia({ reducedMotion: "reduce", colorScheme: "dark" });
    await expect(quantity).toBeFocused();
    await expect(quantity).toHaveValue("4");
    await expect(page.getByRole("region", { name: "技术服务费用核对", exact: true })).toContainText("4个服务日");
    await page.getByRole("button", { name: "添加服务日期", exact: true }).click();
    await expect(page.getByLabel("服务日期 5", { exact: true })).toBeFocused();
    await expect(page.locator(".technical-service-row-added")).toHaveCount(0);
    await page.getByRole("button", { name: "移除第5行", exact: true }).click();
    await expect(page.getByLabel("服务日期 4", { exact: true })).toBeFocused();
    const totals = page.getByRole("region", { name: "技术服务费用核对", exact: true });
    await expect(totals).toContainText("4个服务日");
    await expect(totals).toContainText("10眼");
    await expect(totals).toContainText("300.00元");
    let releaseFailure: (() => void) | undefined;
    let sawSave: (() => void) | undefined;
    const blocked = new Promise<void>((resolve) => {
      releaseFailure = resolve;
    });
    const started = new Promise<void>((resolve) => {
      sawSave = resolve;
    });
    await page.route(
      "**/api/technical-services/sheets",
      async (route) => {
        sawSave?.();
        await blocked;
        await route.fulfill({ status: 503, json: { error: "窄屏保存暂不可用，请重试" } });
      },
      { times: 1 },
    );
    await page.getByRole("button", { name: "保存技术服务明细", exact: true }).click();
    await started;
    await expect(page.getByRole("button", { name: "添加服务日期", exact: true })).toBeDisabled();
    await expect(quantity).toBeDisabled();
    releaseFailure?.();
    await expect(page.getByText("窄屏保存暂不可用，请重试", { exact: true })).toBeVisible();
    await expect(quantity).toHaveValue("4");
    await expect(totals).toContainText("300.00元");
    const created = page.waitForResponse(
      (response) => response.url().endsWith("/api/technical-services/sheets") && response.request().method() === "POST",
    );
    await page.getByRole("button", { name: "保存技术服务明细", exact: true }).click();
    const response = await created;
    expect(response.ok(), await response.text()).toBeTruthy();
    savedId = ((await response.json()) as { item: { id: string } }).item.id;
    await expect(page.locator("#service-iacuc")).toHaveValue("");
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.emulateMedia({ reducedMotion: "no-preference", colorScheme: "light" });
    await openNavigationEntry(page, "技术服务费管理", "已保存技术服务明细");
    await filterColumn(page, "IACUC", iacuc);
    const row = page.getByRole("row").filter({ hasText: iacuc });
    await row.getByRole("button", { name: "编辑", exact: true }).click();
    const editor = page.getByRole("dialog", { name: "技术服务明细", exact: true });
    await editor.locator("#service-notes").fill("保存定位验证");
    await editor.getByRole("button", { name: "保存技术服务明细", exact: true }).click();
    await expect(editor).toBeHidden();
    await expect
      .poll(() =>
        page.evaluate(() =>
          (window as Window & { ux46Animations?: string[] }).ux46Animations?.includes("technical-service-row-saved"),
        ),
      )
      .toBe(true);
    await expect(row.getByRole("button", { name: "编辑", exact: true })).toBeFocused();
    await expect(page.getByRole("status").filter({ hasText: "技术服务明细已保存。" })).toBeVisible();
    const reread = await page.request.get("/api/technical-services/sheets/" + savedId);
    const item = (
      (await reread.json()) as { item: { serviceDayCount: number; totalQuantity: number; totalAmount: number } }
    ).item;
    expect(item).toMatchObject({ serviceDayCount: 4, totalQuantity: 10, totalAmount: 300 });
  } finally {
    if (savedId) {
      const response = await page.request.get("/api/technical-services/sheets/" + savedId);
      if (response.ok()) {
        const item = ((await response.json()) as { item: { updatedAt: string } }).item;
        const deleted = await page.request.delete("/api/technical-services/sheets/" + savedId, {
          data: { expectedUpdatedAt: item.updatedAt },
        });
        expect(deleted.ok(), await deleted.text()).toBeTruthy();
      }
    }
  }
});

test("billing options use Ant collapse, retain values and respect reduced motion", async ({ page }) => {
  await login(page);
  await openQuantityEntry(page);
  await page.evaluate(() => {
    (window as Window & { ux46Transitions?: string[] }).ux46Transitions = [];
    document.addEventListener("transitionrun", (event) => {
      if (event.propertyName === "height" && (event.target as Element).closest(".quantity-options-collapse"))
        (window as Window & { ux46Transitions?: string[] }).ux46Transitions?.push(
          getComputedStyle(event.target as Element).transitionDuration,
        );
    });
  });
  const toggle = page.getByRole("button", { name: /计费扩展选项/ });
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  await expect
    .poll(() =>
      page.evaluate(() =>
        (window as Window & { ux46Transitions?: string[] }).ux46Transitions?.some((duration) =>
          duration.includes("0.2s"),
        ),
      ),
    )
    .toBe(true);
  await page.getByRole("button", { name: "新增区间", exact: true }).click();
  const price = page.getByPlaceholder("收费单价");
  await price.fill("3.25");
  const original = await price.elementHandle();
  await toggle.focus();
  await toggle.press("Space");
  await expect(price).toBeHidden();
  await toggle.press("Enter");
  await expect(price).toHaveValue("3.25");
  expect(await price.evaluate((element, before) => element === before, original)).toBe(true);
  await price.focus();
  await page.emulateMedia({ reducedMotion: "reduce", colorScheme: "dark" });
  await expect(price).toBeFocused();
  await expect(price).toHaveValue("3.25");
  await toggle.click();
  await expect(price).toBeHidden();
  await toggle.click();
  await price.fill("3.75");
  await expect(price).toHaveValue("3.75");
  await expect(page.locator(".quantity-options-collapse")).toHaveCount(1);
});
