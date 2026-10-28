import type { Page, Request } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

import {
  ensureTestInfrastructure,
  expect,
  openNavigationEntry,
  openSavedQuantitySheets,
  openWorkflowCenter,
  test,
} from "./fixtures";

const months = ["2026-10", "2026-09", "2025-10"];
const timestamps = ["2026-10-27T17:00:00.000Z", "2026-10-28T01:00:00.000Z"];
test.use({ timezoneId: "Asia/Shanghai" });

async function login(page: Page) {
  await page.goto("/app");
  await page.getByLabel("用户名", { exact: true }).fill("admin");
  await page.getByLabel("密码", { exact: true }).fill("admin123");
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await expect(page.getByRole("button", { name: "退出登录", exact: true })).toBeVisible();
}

function columnFilters(request: Request) {
  return JSON.parse(new URL(request.url()).searchParams.get("columnFilters") || "{}") as Record<string, string[]>;
}

async function openTree(page: Page, label: string) {
  await page.getByRole("button", { name: `筛选${label}`, exact: true }).click();
  const panel = page.getByRole("group", { name: `筛选${label}选项`, exact: true });
  await expect(panel.getByRole("tree", { name: `${label}日期筛选`, exact: true })).toBeVisible();
  return panel;
}

async function expandYear(panel: ReturnType<Page["getByRole"]>, year = "2026年") {
  const treeitem = panel.getByRole("treeitem", { name: new RegExp(`^${year}`) });
  if ((await treeitem.getAttribute("aria-expanded")) !== "true") await treeitem.locator(".ant-tree-switcher").click();
  await expect(treeitem).toHaveAttribute("aria-expanded", "true");
  await expect(panel.locator(".ant-tree-treenode-motion")).toHaveCount(0);
}

async function installDateOptionMocks(page: Page) {
  await page.route("**/api/filter-options?*", async (route) => {
    const column = new URL(route.request().url()).searchParams.get("column");
    await route.fulfill({
      json: {
        items: (column === "updatedAt" || column === "createdAt" ? timestamps : months).map((value) => ({
          value,
          label: value,
          count: 1,
        })),
      },
    });
  });
  await page.route("**/api/settlement-candidates/filter-options?*", (route) =>
    route.fulfill({ json: { items: months.map((value) => ({ value, label: value, count: 1 })) } }),
  );
  await page.route("**/api/technical-services/**/filter-options?*", (route) =>
    route.fulfill({ json: { items: months.map((value) => ({ value, label: value, count: 1 })) } }),
  );
  await page.route("**/api/feedback/filter-options?*", (route) =>
    route.fulfill({ json: { items: timestamps.map((value) => ({ value, label: value, count: 1 })) } }),
  );
}

test("intake date tree submits exact selected days and keeps pending dates distinct", async ({ page }) => {
  await login(page);
  await ensureTestInfrastructure(page);
  const stamp = Date.now();
  const ids = [`date-tree-${stamp}-a`, `date-tree-${stamp}-b`, `date-tree-${stamp}-c`, `date-tree-${stamp}-pending`];
  const dates = ["2026-10-28", "2026-10-29", "2025-10-28", ""];
  try {
    for (const [index, id] of ids.entries()) {
      const response = await page.request.post("/api/intake-batches", {
        data: {
          item: {
            id,
            receiverName: "系统管理员",
            status: "pending_print",
            batchNo: `DATE-TREE-${stamp}-${index}`,
            iacuc: "Z2026001",
            supplier: "日期树供应商",
            pi: "日期树负责人",
            owner: "日期树实验负责人",
            roomId: "room-e2e-8014",
            roomName: "8014",
            intakeDate: dates[index],
            endDate: dates[index],
            quantity: 1,
            suggestedCardCount: 1,
            finalCardCount: 1,
            species: "mouse",
            cards: [],
          },
        },
      });
      expect(response.ok()).toBe(true);
    }
    await openNavigationEntry(page, "笼卡管理", "待接收批次");
    const panel = await openTree(page, "接收日期");
    await expect(panel.getByRole("checkbox", { name: /2026年/ })).toBeVisible();
    await expandYear(panel);
    await panel.getByRole("checkbox", { name: /10月/ }).click();
    const monthly = page.waitForRequest(
      (request) =>
        new URL(request.url()).pathname === "/api/intake-batches" && columnFilters(request).intakeDate?.length === 2,
    );
    await panel.getByRole("button", { name: "应用", exact: true }).click();
    expect(columnFilters(await monthly).intakeDate).toEqual(["2026-10-28", "2026-10-29"]);
    await expect(page.locator("tr", { hasText: `DATE-TREE-${stamp}-0` })).toBeVisible();
    await expect(page.locator("tr", { hasText: `DATE-TREE-${stamp}-1` })).toBeVisible();
    await expect(page.locator("tr", { hasText: `DATE-TREE-${stamp}-2` })).toHaveCount(0);

    const dayPanel = await openTree(page, "接收日期");
    await dayPanel.getByRole("button", { name: "清空", exact: true }).click();
    await expandYear(dayPanel);
    await expandYear(dayPanel, "10月");
    await dayPanel.getByRole("checkbox", { name: /28日/ }).first().click();
    const daily = page.waitForRequest(
      (request) =>
        new URL(request.url()).pathname === "/api/intake-batches" &&
        columnFilters(request).intakeDate?.[0] === "2026-10-28",
    );
    await dayPanel.getByRole("button", { name: "应用", exact: true }).click();
    expect(columnFilters(await daily).intakeDate).toEqual(["2026-10-28"]);
    await expect(page.locator("tr", { hasText: `DATE-TREE-${stamp}-1` })).toHaveCount(0);

    const pendingPanel = await openTree(page, "接收日期");
    await pendingPanel.getByRole("button", { name: "清空", exact: true }).click();
    await pendingPanel.getByRole("checkbox", { name: /待定/ }).click();
    const pending = page.waitForRequest(
      (request) =>
        new URL(request.url()).pathname === "/api/intake-batches" && columnFilters(request).intakeDate?.[0] === "",
    );
    await pendingPanel.getByRole("button", { name: "应用", exact: true }).click();
    expect(columnFilters(await pending).intakeDate).toEqual([""]);
    await expect(page.locator("tr", { hasText: `DATE-TREE-${stamp}-3` })).toContainText("待定");
    await expect(page.locator("tr", { hasText: `DATE-TREE-${stamp}-0` })).toHaveCount(0);
  } finally {
    for (const id of ids) await page.request.delete(`/api/intake-batches/${id}`);
  }
});

test("month and datetime column trees use mock options and preserve source values", async ({ page }) => {
  test.setTimeout(60_000);
  await login(page);
  await ensureTestInfrastructure(page);
  await installDateOptionMocks(page);

  await openSavedQuantitySheets(page);
  const monthPanel = await openTree(page, "月份");
  await expandYear(monthPanel);
  await monthPanel.getByRole("checkbox", { name: /10月/ }).click();
  const quantityMonth = page.waitForRequest(
    (request) =>
      new URL(request.url()).pathname === "/api/quantity-sheets" && columnFilters(request).month?.[0] === "2026-10",
  );
  await monthPanel.getByRole("button", { name: "应用", exact: true }).click();
  expect(columnFilters(await quantityMonth).month).toEqual(["2026-10"]);

  const timePanel = await openTree(page, "更新时间");
  await expect(timePanel.getByRole("checkbox", { name: /2026年/ })).toBeVisible();
  await expandYear(timePanel);
  await expandYear(timePanel, "10月");
  await timePanel.getByRole("checkbox", { name: /^28日/ }).click();
  const quantityTime = page.waitForRequest(
    (request) =>
      new URL(request.url()).pathname === "/api/quantity-sheets" &&
      columnFilters(request).updatedAt?.includes(timestamps[0]),
  );
  await timePanel.getByRole("button", { name: "应用", exact: true }).click();
  expect(columnFilters(await quantityTime).updatedAt).toEqual(timestamps);

  await openNavigationEntry(page, "结算管理", "结算列表");
  const settlementPanel = await openTree(page, "结算月份");
  await expandYear(settlementPanel);
  await settlementPanel.getByRole("checkbox", { name: /10月/ }).click();
  const settlement = page.waitForRequest(
    (request) =>
      new URL(request.url()).pathname === "/api/settlement-candidates" &&
      columnFilters(request).month?.[0] === "2026-10",
  );
  await settlementPanel.getByRole("button", { name: "应用", exact: true }).click();
  expect(columnFilters(await settlement).month).toEqual(["2026-10"]);

  await openNavigationEntry(page, "技术服务费管理", "已保存技术服务明细");
  const servicePanel = await openTree(page, "月份");
  await expandYear(servicePanel);
  await servicePanel.getByRole("checkbox", { name: /10月/ }).click();
  const service = page.waitForRequest(
    (request) =>
      new URL(request.url()).pathname === "/api/technical-services/sheets" &&
      columnFilters(request).month?.[0] === "2026-10",
  );
  await servicePanel.getByRole("button", { name: "应用", exact: true }).click();
  expect(columnFilters(await service).month).toEqual(["2026-10"]);

  await openWorkflowCenter(page);
  const workflowPanel = await openTree(page, "结算月份");
  await expandYear(workflowPanel);
  await workflowPanel.getByRole("checkbox", { name: /10月/ }).click();
  const workflow = page.waitForRequest(
    (request) =>
      new URL(request.url()).pathname === "/api/billing-workflows" && columnFilters(request).month?.[0] === "2026-10",
  );
  await workflowPanel.getByRole("button", { name: "应用", exact: true }).click();
  expect(columnFilters(await workflow).month).toEqual(["2026-10"]);

  await page.getByRole("menuitem", { name: /帮助与反馈/ }).click();
  const feedbackPanel = await openTree(page, "提出时间");
  await expandYear(feedbackPanel);
  await expandYear(feedbackPanel, "10月");
  await feedbackPanel.getByRole("checkbox", { name: /^28日/ }).click();
  const feedback = page.waitForRequest(
    (request) =>
      new URL(request.url()).pathname === "/api/feedback" && columnFilters(request).createdAt?.includes(timestamps[0]),
  );
  await feedbackPanel.getByRole("button", { name: "应用", exact: true }).click();
  expect(columnFilters(await feedback).createdAt).toEqual(timestamps);
});

test("date filter tree stays contained and keyboard-operable across the supported viewports", async ({
  page,
}, testInfo) => {
  test.setTimeout(60_000);
  await login(page);
  await ensureTestInfrastructure(page);
  await page.route("**/api/filter-options?*", (route) =>
    route.fulfill({
      json: {
        items: [
          { value: "2026-10-28", label: "2026-10-28", count: 2 },
          { value: "2026-10-29", label: "2026-10-29", count: 1 },
        ],
      },
    }),
  );
  await openNavigationEntry(page, "笼卡管理", "待接收批次");
  for (const [width, height] of [
    [1440, 900],
    [1180, 900],
    [760, 900],
    [844, 390],
  ]) {
    await page.setViewportSize({ width, height });
    await page.emulateMedia({ reducedMotion: width === 844 ? "reduce" : "no-preference" });
    const trigger = page.getByRole("button", { name: "筛选接收日期", exact: true });
    const panel = await openTree(page, "接收日期");
    const tree = panel.getByRole("tree");
    await tree.focus();
    await page.keyboard.press("Home");
    await page.keyboard.press("ArrowLeft");
    await expect(panel.getByRole("treeitem", { name: /^2026年/ })).toHaveAttribute("aria-expanded", "false");
    await expect(panel.locator(".ant-tree-treenode-motion")).toHaveCount(0);
    await page.keyboard.press("ArrowRight");
    await expect(panel.getByRole("treeitem", { name: /^2026年/ })).toHaveAttribute("aria-expanded", "true");
    await page.keyboard.press("Space");
    await expect(panel.getByRole("checkbox", { name: /^2026年/ })).toBeChecked();
    await expect(panel.locator(".ant-tree-treenode-motion")).toHaveCount(0);
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("ArrowRight");
    await expect(panel.getByRole("treeitem", { name: /^10月/ })).toHaveAttribute("aria-expanded", "true");
    await expect(panel.locator(".ant-tree-treenode-motion")).toHaveCount(0);
    await expect(panel.getByRole("checkbox", { name: /^29日/ })).toBeChecked();
    const geometry = await panel.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      return {
        left: rect.left,
        right: rect.right,
        top: rect.top,
        bottom: rect.bottom,
        width: innerWidth,
        height: innerHeight,
        display: getComputedStyle(element).display,
        scrollWidth: element.scrollWidth,
        clientWidth: element.clientWidth,
      };
    });
    expect(geometry.left).toBeGreaterThanOrEqual(0);
    expect(geometry.right).toBeLessThanOrEqual(width);
    expect(geometry.top).toBeGreaterThanOrEqual(0);
    expect(geometry.bottom).toBeLessThanOrEqual(height);
    expect(geometry.scrollWidth).toBeLessThanOrEqual(geometry.clientWidth + 1);
    const checkboxOffset = await panel.getByRole("treeitem", { name: /^10月/ }).evaluate((element) => {
      const checkbox = element.querySelector(".ant-tree-checkbox")!.getBoundingClientRect();
      const title = element.querySelector(".table-date-filter-title")!.getBoundingClientRect();
      return Math.abs(checkbox.top + checkbox.height / 2 - title.top - title.height / 2);
    });
    expect(checkboxOffset).toBeLessThanOrEqual(1);
    await testInfo.attach(`date-filter-geometry-${width}`, {
      body: JSON.stringify(geometry),
      contentType: "application/json",
    });
    await testInfo.attach(`date-filter-${width}`, { body: await page.screenshot(), contentType: "image/png" });
    if (width === 1440) {
      const axe = await new AxeBuilder({ page }).include('[data-ui="data-table-filter"]').analyze();
      expect(axe.violations.filter((issue) => issue.impact === "serious" || issue.impact === "critical")).toEqual([]);
    }
    await page.keyboard.press("Escape");
    await expect(panel).toBeHidden();
    await expect(trigger).toBeFocused();
  }
});
