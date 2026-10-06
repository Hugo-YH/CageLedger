import type { Page } from "@playwright/test";
import { writeFile } from "node:fs/promises";
import { expect, openBillingNavigation, openWorkflowCenter, test } from "./fixtures";

function contrastFromLayers(layers: Array<{ color: string; background: string; opacity: string }>) {
  const numbers = (color: string) => (color.match(/[0-9.]+/g) || []).map(Number);
  const foreground = numbers(layers[0].color);
  const background = numbers(layers.find((layer) => layer.background !== "rgba(0, 0, 0, 0)")!.background);
  const alpha = (foreground[3] ?? 1) * layers.reduce((value, layer) => value * Number(layer.opacity), 1);
  const effective = foreground.slice(0, 3).map((value, index) => value * alpha + background[index] * (1 - alpha));
  const luminance = (rgb: number[]) =>
    rgb.slice(0, 3).reduce((total, value, index) => {
      const channel = value / 255;
      return (
        total +
        (channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4) * [0.2126, 0.7152, 0.0722][index]
      );
    }, 0);
  const values = [luminance(effective), luminance(background)];
  return (Math.max(...values) + 0.05) / (Math.min(...values) + 0.05);
}

async function mockCandidates(page: Page) {
  const items = Array.from({ length: 12 }, (_, index) => ({
    id: `safe-candidate-${index}`,
    month: "2026-09",
    pi: `合成结算负责人 ${String(index + 1).padStart(2, "0")}`,
    iacucs: ["TEST-2026-001", "TEST-2026-002", "TEST-2026-003"],
    manager: "合成登记员",
    totalAmount: 1234.56 + index * 100,
    hasWorkflow: false,
    workflowStatus: "statement_sent",
  }));
  let lastQuery = new URLSearchParams();
  await page.route("**/api/billing-settlement-candidates?*", (route) => {
    const params = new URL(route.request().url()).searchParams;
    lastQuery = params;
    const filters = JSON.parse(params.get("columnFilters") || "{}") as Record<string, string[]>;
    const filtered = items.filter((item) => !filters.pi?.length || filters.pi.includes(item.pi));
    if (params.get("sortKey") === "pi") {
      filtered.sort((a, b) => a.pi.localeCompare(b.pi) * (params.get("sortDir") === "desc" ? -1 : 1));
    }
    const limit = Number(params.get("limit") || 10);
    const offset = Number(params.get("offset") || 0);
    return route.fulfill({
      json: {
        items: filtered.slice(offset, offset + limit),
        page: { total: filtered.length, limit, offset },
        filterOptions: {},
      },
    });
  });
  await page.route("**/api/filter-options?*", (route) =>
    route.fulfill({ json: { items: items.map((item) => ({ value: item.pi, label: item.pi, count: 1 })) } }),
  );
  await page.route("**/api/billing-workflows?*", (route) =>
    route.fulfill({ json: { items, page: { total: 12, limit: 10, offset: 0 } } }),
  );
  return { items, lastQuery: () => lastQuery };
}

async function openSettlement(page: Page) {
  await openBillingNavigation(page);
  await page.getByRole("menuitem", { name: /结算管理/ }).click();
  await expect(page.getByRole("heading", { name: "结算管理", exact: true })).toBeVisible();
}

test.beforeEach(async ({ page }) => {
  await page.goto("/app");
  await page.getByLabel("用户名", { exact: true }).fill("admin");
  await page.getByLabel("密码", { exact: true }).fill("admin123");
  await page.getByRole("button", { name: "登录", exact: true }).click();
});

test("settlement desktop restores context and discards selections across navigation", async ({ page }) => {
  const data = await mockCandidates(page);
  await openSettlement(page);
  const panel = page.getByRole("region", { name: "结算管理列表", exact: true });
  await page.getByText("紧凑", { exact: true }).click();
  await page.getByRole("button", { name: "项目负责人姓名，点击切换排序", exact: true }).click();
  await page.getByLabel("每页显示条数").click();
  await page.keyboard.press("ArrowUp");
  await page.keyboard.press("Enter");
  await page.locator(".ant-pagination-next").click();
  const checkbox = page.getByRole("checkbox", { name: "选择 合成结算负责人 06 2026-09 结算项", exact: true });
  await checkbox.check();
  await page.getByRole("menuitem", { name: /总览/ }).click();
  await openSettlement(page);
  await expect(checkbox).not.toBeChecked();
  await expect(page.locator(".ant-pagination-item-active")).toHaveText("2");
  await expect(page.locator(".ant-pagination-options")).toContainText("5 条/页");
  await expect(page.getByRole("radio", { name: "紧凑", exact: true })).toBeChecked();
  expect(data.lastQuery().get("sortKey")).toBe("pi");
  expect(data.lastQuery().get("sortDir")).toBe("asc");
  await page.getByRole("button", { name: "筛选项目负责人姓名", exact: true }).click();
  const filter = page.locator(".table-filter-panel:visible");
  await filter.getByRole("checkbox", { name: /合成结算负责人 12/ }).click();
  await filter.getByRole("button", { name: "应用", exact: true }).click();
  await expect(page.getByLabel("已应用筛选")).toContainText("负责人：合成结算负责人 12");
  await page.getByRole("menuitem", { name: /总览/ }).click();
  await openSettlement(page);
  await expect(page.getByLabel("已应用筛选")).toContainText("负责人：合成结算负责人 12");
  await expect(page.locator(".ant-pagination-item-active")).toHaveText("1");
  await page.getByRole("button", { name: "清除全部筛选", exact: true }).click();
  await expect(panel.locator(".ant-table-tbody > tr[data-row-key]")).toHaveCount(5);
});

test("settlement desktop partial batch failure retains only failures for confirmed retry", async ({ page }) => {
  const data = await mockCandidates(page);
  const writes: string[] = [];
  await page.route("**/api/billing-statements/generate-by-pi", (route) => {
    const body = route.request().postDataJSON() as { pi: string };
    writes.push(body.pi);
    if (body.pi === data.items[1].pi && writes.filter((pi) => pi === body.pi).length === 1) {
      return route.fulfill({ status: 409, json: { error: "合成冲突，请核对后重试" } });
    }
    return route.fulfill({ json: { statement: { pi: body.pi, month: "2026-09", totalAmount: 1234.56 }, lines: [] } });
  });
  await openSettlement(page);
  const first = page.getByRole("checkbox", { name: `选择 ${data.items[0].pi} 2026-09 结算项`, exact: true });
  const second = page.getByRole("checkbox", { name: `选择 ${data.items[1].pi} 2026-09 结算项`, exact: true });
  await first.check();
  await second.check();
  await page.getByRole("button", { name: "批量发起结算", exact: true }).click();
  const confirm = page.getByRole("dialog", { name: "批量发起结算流程", exact: true });
  await confirm.getByRole("button", { name: "发起 2 个流程", exact: true }).click();
  await expect(page.getByText(/已发起 1 个结算流程；1 个未完成/)).toBeVisible();
  await expect(page.getByText(/合成冲突，请核对后重试/)).toBeVisible();
  await expect(confirm).toBeHidden();
  await expect(first).not.toBeChecked();
  await expect(second).toBeChecked();
  expect(writes).toEqual([data.items[0].pi, data.items[1].pi]);
  await page.getByRole("button", { name: "发起结算流程", exact: true }).click();
  await confirm.getByRole("button", { name: "取消", exact: true }).click();
  await expect(confirm).toBeHidden();
  expect(writes).toHaveLength(2);
  await page.getByRole("button", { name: "发起结算流程", exact: true }).click();
  // Ant can retain the leaving loading icon in the accessible name after reuse.
  const retry = confirm.getByRole("button", { name: /发起 1 个流程$/ });
  await expect(retry).not.toHaveClass(/ant-btn-loading/);
  await retry.click();
  await expect(page.getByText("已发起 1 个结算流程，可到单据跟踪继续处理。", { exact: true })).toBeVisible();
  expect(writes).toEqual([data.items[0].pi, data.items[1].pi, data.items[1].pi]);
  await expect(second).not.toBeChecked();
});

for (const width of [1180, 1440]) {
  for (const theme of ["light", "dark"] as const) {
    test(`desktop tables expose all columns through horizontal scrolling ${width} ${theme}`, async ({ page }, info) => {
      await page.setViewportSize({ width, height: 900 });
      await page.emulateMedia({ colorScheme: theme, reducedMotion: "reduce" });
      await mockCandidates(page);
      const evidence = [];
      for (const view of ["settlement", "workflow"] as const) {
        if (view === "settlement") await openSettlement(page);
        else await openWorkflowCenter(page);
        const panel = page.getByRole("region", {
          name: view === "settlement" ? "结算管理列表" : "结算流程列表",
          exact: true,
        });
        await expect(panel.locator(".ant-table-tbody > tr[data-row-key]").first()).toBeVisible();
        const geometry = await panel.evaluate((element) => {
          const content = element.querySelector<HTMLElement>(".ant-table-content")!;
          content.scrollLeft = content.scrollWidth - content.clientWidth;
          const headers = [...element.querySelectorAll<HTMLElement>("thead th")];
          const amount = headers.find((header) => header.innerText.includes("金额"))!;
          const actions = headers.find((header) => header.innerText === "操作")!;
          const text = document.querySelector<HTMLElement>("[aria-label='已应用筛选'] .ant-typography")!;
          const icon = element.querySelector<HTMLElement>(".filterable-column-title button:last-child .anticon")!;
          const colors = (target: HTMLElement) => {
            const layers = [];
            for (let node: HTMLElement | null = target; node; node = node.parentElement) {
              const style = getComputedStyle(node);
              layers.push({ color: style.color, background: style.backgroundColor, opacity: style.opacity });
            }
            return layers;
          };
          return {
            viewport: innerWidth,
            pageWidth: document.documentElement.scrollWidth,
            scrollWidth: content.scrollWidth,
            clientWidth: content.clientWidth,
            scrollLeft: content.scrollLeft,
            amount: amount.getBoundingClientRect().toJSON(),
            actions: actions.getBoundingClientRect().toJSON(),
            table: content.getBoundingClientRect().toJSON(),
            secondaryText: colors(text),
            filterIcon: colors(icon),
          };
        });
        expect(geometry.pageWidth).toBeLessThanOrEqual(width);
        expect(geometry.amount.left).toBeGreaterThanOrEqual(geometry.table.left - 1);
        expect(geometry.amount.right).toBeLessThanOrEqual(geometry.actions.left + 1);
        expect(geometry.actions.right).toBeLessThanOrEqual(geometry.table.right + 1);
        expect(geometry.actions.left).toBeGreaterThanOrEqual(geometry.table.left);
        const secondaryContrast = contrastFromLayers(geometry.secondaryText);
        const filterContrast = contrastFromLayers(geometry.filterIcon);
        expect(secondaryContrast).toBeGreaterThanOrEqual(4.5);
        expect(filterContrast).toBeGreaterThanOrEqual(3);
        evidence.push({ view, width, theme, ...geometry, secondaryContrast, filterContrast });
      }
      const path = info.outputPath("table-geometry-and-colors.json");
      await writeFile(path, JSON.stringify(evidence, null, 2));
      await info.attach("table geometry and computed colors", { path, contentType: "application/json" });
    });
  }
}
