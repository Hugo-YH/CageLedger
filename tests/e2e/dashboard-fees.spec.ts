import type { PiOverview } from "../../src/react/api/dashboardOverview";
import type { Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "./fixtures";

const zeroItems = Array.from({ length: 12 }, (_, index) => ({
  pi: `统计负责人${String(index + 1).padStart(2, "0")}`,
  amount: 0,
  iacucCount: index + 1,
}));

test("feeding fee shortcut shows the full selected-month amount and opens settlements", async ({ page }, info) => {
  await page.route("**/api/dashboard/overview*", (route) => {
    const month = new URL(route.request().url()).searchParams.get("month") || "2026-09";
    return route.fulfill({
      json: {
        ...overview(month, []),
        feedingFeeTotal: { amount: month === "2026-09" ? 358962.12 : 0.01, amountState: "ready" },
      },
    });
  });
  await login(page);
  const shortcut = page.getByRole("button", { name: /查看饲养费金额，.*358,962\.12/ });
  await expect(shortcut).toBeVisible();
  await expect(shortcut.locator(".ant-badge")).toHaveCount(0);
  const geometry = [];
  for (const [width, height] of [
    [1265, 642],
    [1180, 820],
    [760, 900],
    [844, 390],
  ]) {
    await page.setViewportSize({ width, height });
    const measured = await shortcut.evaluate((root) => {
      const content = root.querySelector<HTMLElement>(".ant-dashboard-task-content")!;
      const amount = root.querySelector<HTMLElement>(".ant-dashboard-task-amount")!;
      const heading = root.querySelector<HTMLElement>(".ant-dashboard-task-heading")!;
      return {
        display: getComputedStyle(content).display,
        amount: amount.textContent,
        contentOverflow: content.scrollWidth > content.clientWidth + 1,
        amountOverflow: amount.scrollWidth > amount.clientWidth + 1,
        headingOverflow: heading.scrollWidth > heading.clientWidth + 1,
        pageOverflow: document.documentElement.scrollWidth > innerWidth + 1,
      };
    });
    expect(measured.display).toBe("grid");
    expect(measured.amount).toMatch(/358,962\.12/);
    expect(
      measured.contentOverflow || measured.amountOverflow || measured.headingOverflow || measured.pageOverflow,
    ).toBe(false);
    geometry.push({ width, height, ...measured });
    await info.attach(`feeding-fee-${width}`, { body: await shortcut.screenshot(), contentType: "image/png" });
  }
  await info.attach("feeding-fee-geometry", { body: JSON.stringify(geometry), contentType: "application/json" });
  await page.getByRole("combobox", { name: "选择统计月份", exact: true }).click();
  await page.getByTitle("2026 年 08 月", { exact: true }).click();
  const changed = page.getByRole("button", { name: /查看饲养费金额，.*0\.01/ });
  await expect(changed).toBeVisible();
  await changed.focus();
  await changed.press("Enter");
  await expect(page.getByRole("heading", { name: "结算列表", exact: true })).toBeVisible();
});

test("feeding fee shortcut distinguishes real zero, unavailable totals and old responses", async ({ page }) => {
  let total: { amount: number | null; amountState: "ready" | "pending" | "error" } | undefined = {
    amount: 0,
    amountState: "ready",
  };
  await page.route("**/api/dashboard/overview*", (route) =>
    route.fulfill({ json: { ...overview("2026-09", []), feedingFeeTotal: total } }),
  );
  await login(page);
  await expect(page.getByRole("button", { name: /查看饲养费金额，.*0\.00/ })).toBeVisible();
  for (const [state, label] of [
    ["pending", "待核算"],
    ["error", "待核查"],
    [undefined, "—"],
  ] as const) {
    total = state ? { amount: null, amountState: state } : undefined;
    await page.reload();
    const shortcut = page.getByRole("button", { name: `查看饲养费金额，${label}`, exact: true });
    await expect(shortcut).toBeVisible();
    await expect(shortcut).not.toContainText("0.00");
  }
});

test("project shortcut uses the selected month's saved ethics count and opens saved sheets", async ({ page }) => {
  await page.route("**/api/dashboard/overview*", (route) => {
    const month = new URL(route.request().url()).searchParams.get("month") || "2026-09";
    return route.fulfill({
      json: { ...overview(month, []), quantitySheetIacucCount: month === "2026-09" ? 209 : 173 },
    });
  });
  await login(page);
  const shortcut = page.getByRole("button", { name: "查看动物实验项目，当前 209 项", exact: true });
  await expect(shortcut).toBeVisible();
  await page.getByRole("combobox", { name: "选择统计月份", exact: true }).click();
  await page.getByTitle("2026 年 08 月", { exact: true }).click();
  const previous = page.getByRole("button", { name: "查看动物实验项目，当前 173 项", exact: true });
  await expect(previous).toBeVisible();
  await previous.focus();
  await previous.press("Enter");
  await expect(page.getByRole("heading", { name: "已保存数量统计表", exact: true })).toBeVisible();
});

test("fee summary searches every PI, paginates zero amounts and resets on month change", async ({ page }) => {
  let requests = 0;
  await page.route("**/api/dashboard/overview*", (route) => {
    requests += 1;
    const month = new URL(route.request().url()).searchParams.get("month") || "2026-09";
    return route.fulfill({ json: overview(month, month === "2026-08" ? zeroItems.slice(0, 3) : zeroItems) });
  });
  await login(page);
  const summary = page.getByRole("region", { name: "负责人饲养费统计", exact: true });
  await expect(summary).toContainText("共 12 位项目负责人");
  await expect(summary).toContainText("当前统计金额均为 0.00 元");
  await expect(summary.locator(".ant-progress")).toHaveCount(0);
  const rows = summary.locator("tbody tr[data-row-key]");
  await expect(rows).toHaveCount(5);
  await expect(rows.first()).toContainText("统计负责人01");
  const baselineRequests = requests;
  await summary.locator(".ant-pagination-next").click();
  await expect(rows.first()).toContainText("统计负责人06");
  const search = summary.getByRole("searchbox", { name: "搜索项目负责人", exact: true });
  await search.fill("统计负责人12");
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText("统计负责人12");
  await expect(summary.locator(".ant-pagination-item-active")).toHaveText("1");
  await search.fill("没有匹配的负责人");
  await expect(summary).toContainText("未找到匹配的项目负责人");
  await search.fill("");
  await expect(rows).toHaveCount(5);
  await summary.locator(".ant-pagination-next").click();
  await expect(rows.first()).toContainText("统计负责人06");
  expect(requests).toBe(baselineRequests);
  await page.getByRole("combobox", { name: "选择统计月份", exact: true }).click();
  await page.getByTitle("2026 年 08 月", { exact: true }).click();
  await expect(summary).toContainText("共 3 位项目负责人");
  await expect(rows).toHaveCount(3);
  await expect(rows.first()).toContainText("统计负责人01");
  await expect(search).toHaveValue("");
});

test("fee summary keeps cent amounts, long names and numeric alignment across viewports", async ({ page }, info) => {
  const items = [
    { pi: "金额核对课题组负责人姓名较长的展示样例", amount: 12345.67, iacucCount: 12 },
    { pi: "小额负责人", amount: 0.01, iacucCount: 2 },
    { pi: "零额负责人", amount: 0, iacucCount: 1 },
  ];
  await page.route("**/api/dashboard/overview*", (route) => route.fulfill({ json: overview("2026-09", items) }));
  await login(page);
  const summary = page.getByRole("region", { name: "负责人饲养费统计", exact: true });
  await expect(summary.getByText(/12,345\.67/)).toBeVisible();
  await expect(summary.getByText(/0\.01/)).toBeVisible();
  await expect(summary.getByText(/0\.00/)).toBeVisible();
  await expect(summary).not.toContainText("当前统计金额均为");
  const evidence = [];
  for (const [width, height] of [
    [1265, 642],
    [1180, 820],
    [760, 900],
    [390, 844],
    [844, 390],
  ]) {
    await page.setViewportSize({ width, height });
    for (const colorScheme of ["light", "dark"] as const) {
      await page.emulateMedia({ colorScheme });
      await expect(page.locator("html")).toHaveAttribute("data-theme", colorScheme);
      await summary.scrollIntoViewIfNeeded();
      const geometry = await summary.evaluate((root) => {
        const table = root.querySelector<HTMLElement>(".ant-table-content")!;
        const cells = [...root.querySelector("tbody tr[data-row-key]")!.querySelectorAll<HTMLElement>("td")];
        return {
          pageOverflow: document.documentElement.scrollWidth > innerWidth + 1,
          tableOverflow: table.scrollWidth > table.clientWidth + 1,
          tableWidth: table.clientWidth,
          aligns: cells.map((cell) => getComputedStyle(cell).textAlign),
          amount: cells.at(-1)?.textContent,
          cellOverflow: cells.at(-1)!.scrollWidth > cells.at(-1)!.clientWidth + 1,
        };
      });
      expect(geometry.pageOverflow).toBe(false);
      expect(geometry.tableOverflow).toBe(false);
      expect(geometry.cellOverflow).toBe(false);
      expect(geometry.aligns).toEqual(["left", "right", "right"]);
      evidence.push({ width, height, colorScheme, geometry });
      await info.attach(`fee-summary-${width}-${colorScheme}`, {
        body: await summary.screenshot(),
        contentType: "image/png",
      });
    }
  }
  const accessibility = await new AxeBuilder({ page }).include(".ant-dashboard-pi-summary").analyze();
  expect(accessibility.violations.filter((item) => ["serious", "critical"].includes(item.impact || ""))).toEqual([]);
  await info.attach("fee-summary-geometry", { body: JSON.stringify(evidence), contentType: "application/json" });
});

test("an empty fee summary identifies missing statistics without showing a zero ranking", async ({ page }) => {
  await page.route("**/api/dashboard/overview*", (route) => route.fulfill({ json: overview("2026-09", []) }));
  await login(page);
  const summary = page.getByRole("region", { name: "负责人饲养费统计", exact: true });
  await expect(summary).toContainText("暂无项目负责人统计");
  await expect(summary).not.toContainText("当前统计金额均为");
  await expect(summary.locator("tbody tr[data-row-key]")).toHaveCount(0);
});

test("unavailable fee amounts never appear as real zero", async ({ page }) => {
  const items: PiOverview[] = [
    { pi: "真实零元负责人", amount: 0, amountState: "ready", iacucCount: 1 },
    { pi: "未缓存金额负责人", amount: 0, amountState: "pending", iacucCount: 2 },
    { pi: "计算失败负责人", amount: 0, amountState: "error", amountError: "统计条件待核查", iacucCount: 3 },
  ];
  await page.route("**/api/dashboard/overview*", (route) => route.fulfill({ json: overview("2026-09", items) }));
  await login(page);
  const summary = page.getByRole("region", { name: "负责人饲养费统计", exact: true });
  const pending = summary.getByRole("row").filter({ hasText: "未缓存金额负责人" });
  const error = summary.getByRole("row").filter({ hasText: "计算失败负责人" });
  await expect(pending).toContainText("待核算");
  await expect(error).toContainText("待核查");
  await expect(pending).not.toContainText("0.00");
  await expect(error).not.toContainText("0.00");
  await expect(summary.getByRole("row").filter({ hasText: "真实零元负责人" })).toContainText("0.00");
  await expect(summary).not.toContainText("当前统计金额均为");
  await expect(summary).toContainText("2 位负责人金额待核算或核查");
});

function overview(month: string, pi: PiOverview[]) {
  return {
    month,
    availableMonths: ["2026-09", "2026-08"],
    intake: { month, batches: 0, animals: 0, trendUnit: "day", trend: [], strains: [], species: [] },
    rooms: [],
    pi,
  };
}

async function login(page: Page) {
  await page.goto("/app");
  await page.getByLabel("用户名", { exact: true }).fill("admin");
  await page.getByLabel("密码", { exact: true }).fill("admin123");
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await expect(page.getByRole("heading", { name: "实验动物笼位管理与计费系统", exact: true })).toBeVisible();
}
