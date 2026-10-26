import { resolve } from "node:path";
import type { Page } from "@playwright/test";

import type { IntakeBatch } from "../../src/contracts/intake";
import { expect, openNavigationEntry, test } from "./fixtures";

function sampleRows(): IntakeBatch[] {
  return Array.from({ length: 12 }, (_, index) => ({
    rawMessage: "统计验收",
    purchaseOrderNo: "",
    supplier: "验收供应商",
    species: "mouse",
    strainRaw: "BALB/c",
    strainStandard: "BALB/c",
    sex: "雌性/雄性",
    roomMatched: true,
    husbandryDays: 30,
    endDate: "2026-11-09",
    project: "统计验收项目",
    receiverName: "验收",
    vetPhone: "",
    notes: "",
    suggestedAnimalsPerCage: 5,
    suggestedCardCount: 2,
    confirmedCardCount: 0,
    remainingCardCount: 2,
    receipts: [],
    cards: [],
    updatedAt: "2026-10-26T00:00:00Z",
    id: `statistics-${index}`,
    batchNo: `STAT-${index}`,
    iacuc: `Z2099${String(index).padStart(3, "0")}`,
    intakeDate: [5, 11].includes(index) ? "2026-10-11" : "2026-10-10",
    roomName: [2, 3].includes(index) ? "8015" : "8014",
    finalCardCount: ({ 0: 10, 1: 5, 2: 6, 3: 4, 5: 3, 10: 2 } as Record<number, number>)[index] || 50,
    intakePurpose: [4, 11].includes(index) ? "direct_sampling" : "housing",
    quantity: index === 11 ? 4 : 8,
    pi: "批次旧项目负责人",
    owner: "批次实验负责人",
    status: index === 1 ? "received" : "pending_print",
  }));
}

async function prepare(page: Page, rows = sampleRows()) {
  const login = await page.request.post("/api/auth/login", { data: { username: "admin", password: "admin123" } });
  expect(login.ok()).toBeTruthy();
  const csv = [
    "动物伦理编号,动物实验名称,项目负责人,实验负责人,项目来源",
    ...rows.map(
      (row, index) =>
        `${row.iacuc},统计验收项目,${[2, 5, 10].includes(index) ? "负责人乙" : [3, 11].includes(index) ? "负责人丙" : "负责人甲"},汇总实验负责人,验收经费`,
    ),
  ].join("\n");
  const uploaded = await page.request.post("/api/iacuc-index/upload", {
    multipart: { file: { name: "statistics.csv", mimeType: "text/csv", buffer: Buffer.from(csv) } },
  });
  expect(uploaded.ok(), await uploaded.text()).toBeTruthy();
  await page.route("**/api/intake-batches?**", (route) => {
    const params = new URL(route.request().url()).searchParams;
    const offset = Number(params.get("offset") || 0);
    const limit = Number(params.get("limit") || 10);
    return route.fulfill({
      json: {
        items: rows.slice(offset, offset + limit),
        page: { total: rows.length, offset, limit, hasMore: offset + limit < rows.length },
      },
    });
  });
  await page.goto("/app");
  await openNavigationEntry(page, "笼卡管理", "待接收批次");
  return rows;
}

test("statistics includes cross-page selection and copies authoritative date-room-PI totals", async ({ page }) => {
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  await prepare(page);
  const trigger = page.getByRole("button", { name: "统计", exact: true });
  await expect(trigger).toBeDisabled();
  for (const index of [0, 1, 2, 3, 4, 5])
    await page.getByRole("checkbox", { name: `选择 STAT-${index}`, exact: true }).check();
  await page.locator(".ant-pagination-next").click();
  for (const index of [10, 11]) await page.getByRole("checkbox", { name: `选择 STAT-${index}`, exact: true }).check();
  await trigger.click();
  const dialog = page.getByRole("dialog", { name: "接收批次统计", exact: true });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("button", { name: "复制统计结果", exact: true })).toBeEnabled();
  await expect(dialog.locator(".intake-statistics-metric").nth(0)).toContainText("30");
  await expect(dialog.locator(".intake-statistics-metric").nth(1)).toContainText("8");
  await expect(dialog.locator(".intake-statistics-metric").nth(2)).toContainText("12");
  const firstRoom = dialog.getByRole("region", { name: "2026年10月10日 8014", exact: true });
  await expect(firstRoom).toContainText("17 笼");
  await expect(firstRoom.locator("li")).toHaveCount(2);
  await expect(firstRoom.locator("li").filter({ hasText: "负责人甲" })).toContainText("15 笼");
  await expect(dialog).not.toContainText("批次旧项目负责人");
  await dialog.getByRole("button", { name: "复制统计结果", exact: true }).click();
  await expect(page.getByText("统计结果已复制", { exact: true })).toBeVisible();
  const text = await page.evaluate(() => navigator.clipboard.readText());
  expect(text).toContain("已选 8 批｜饲养 30 笼");
  expect(text).toContain("2026年10月10日　27 笼");
  expect(text).toContain("2026年10月11日　3 笼");
  expect(text).toContain("直接取材 2 批｜12 只（不计笼数）");
  expect(text).toContain("- 负责人甲　15 笼");
  expect(text).not.toContain("\t");
  expect(text).not.toContain("批次旧项目负责人");
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(trigger).toBeFocused();
  await expect(page.getByText("已选 8 项", { exact: true })).toBeVisible();
});

test("statistics preserves unknown records and supports retry after a project lookup failure", async ({ page }) => {
  const rows = sampleRows().slice(0, 3);
  rows[0] = { ...rows[0], intakeDate: "", roomName: "", finalCardCount: 0, iacuc: "" };
  await prepare(page, rows);
  let fail = true;
  await page.route("**/api/iacuc-index?**", async (route) => {
    if (fail) await route.fulfill({ status: 503, json: { error: "项目汇总表暂时不可用" } });
    else await route.continue();
  });
  for (const index of [0, 1, 2]) await page.getByRole("checkbox", { name: `选择 STAT-${index}`, exact: true }).check();
  await page.getByRole("button", { name: "统计", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "接收批次统计", exact: true });
  await expect(dialog.getByText("有 3 批信息待确认", { exact: true })).toBeVisible();
  await expect(dialog).toContainText("接收日期待确认");
  await expect(dialog).toContainText("另有 1 批笼数待确认");
  await expect(dialog).not.toContainText("批次旧项目负责人");
  fail = false;
  await dialog.getByRole("button", { name: "重新查询", exact: true }).click();
  await expect(dialog.getByText("有 1 批信息待确认", { exact: true })).toBeVisible();
  await dialog.getByText("查看待确认明细（1 批）", { exact: true }).click();
  await expect(dialog).toContainText("IACUC 未填写");
  await expect(dialog).toContainText("最终笼卡张数未确定，笼数待确认");
  await page.evaluate(() => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: () => Promise.reject(new Error("denied")) },
    });
    document.execCommand = () => false;
  });
  await dialog.getByRole("button", { name: "复制统计结果", exact: true }).click();
  await expect(page.getByText("复制失败，请允许浏览器访问剪贴板后重试。", { exact: true })).toBeVisible();
});

test("statistics report keeps totals and actions readable across themes and four viewport sizes", async ({
  page,
}, testInfo) => {
  const rows = sampleRows().slice(0, 6);
  await prepare(page, rows);
  for (let index = 0; index < rows.length; index++)
    await page.getByRole("checkbox", { name: `选择 STAT-${index}`, exact: true }).check();
  await page.getByRole("button", { name: "统计", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "接收批次统计", exact: true });
  const copy = dialog.getByRole("button", { name: "复制统计结果", exact: true });
  await expect(copy).toBeEnabled();
  const evidence: unknown[] = [];
  for (const [width, height, scheme] of [
    [1440, 1000, "light"],
    [1180, 820, "dark"],
    [760, 900, "light"],
    [844, 390, "dark"],
  ] as const) {
    await page.setViewportSize({ width, height });
    await page.emulateMedia({ colorScheme: scheme, reducedMotion: "reduce" });
    await expect(copy).toBeInViewport();
    const data = await dialog.evaluate((element) => {
      const body = element.querySelector<HTMLElement>(".intake-statistics")!;
      const overview = element.querySelector<HTMLElement>(".intake-statistics-overview")!;
      const style = getComputedStyle(overview);
      const box = element.getBoundingClientRect();
      return {
        left: box.left,
        right: box.right,
        bottom: box.bottom,
        viewportWidth: innerWidth,
        viewportHeight: innerHeight,
        overflow: body.scrollWidth > body.clientWidth,
        columns: style.gridTemplateColumns,
        gap: style.gap,
        minWidth: style.minWidth,
        position: style.position,
        zIndex: style.zIndex,
        display: style.display,
      };
    });
    expect(data.left).toBeGreaterThanOrEqual(0);
    expect(data.right).toBeLessThanOrEqual(width);
    expect(data.overflow).toBe(false);
    evidence.push({ width, height, scheme, ...data });
    const screenshot = await page.screenshot({ fullPage: true });
    await testInfo.attach(`statistics-${width}-${scheme}`, { body: screenshot, contentType: "image/png" });
    if (process.env.CAGELEDGER_E2E_OUTPUT_DIR)
      await page.screenshot({
        path: resolve(process.env.CAGELEDGER_E2E_OUTPUT_DIR, `statistics-${width}-${scheme}.png`),
        fullPage: true,
      });
  }
  await testInfo.attach("layout-evidence", {
    body: JSON.stringify(evidence, null, 2),
    contentType: "application/json",
  });
});

test("selected intake toolbar stays above fixed columns during vertical and horizontal scrolling", async ({
  page,
}, info) => {
  await page.setViewportSize({ width: 1180, height: 820 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await prepare(page);
  await page.getByRole("checkbox", { name: "选择 STAT-0", exact: true }).check();
  const toolbar = page.getByRole("group", { name: "待接收批次批量操作", exact: true });
  await expect(toolbar).toHaveAttribute("data-sticky", "true");
  await page.mouse.move(800, 550);
  await page.mouse.wheel(0, 350);
  await expect.poll(() => toolbar.evaluate((element) => element.getBoundingClientRect().top)).toBeLessThan(40);
  const table = page.locator(".intake-batch-table .ant-table-content");
  await table.hover();
  await page.mouse.wheel(300, 0);
  await expect.poll(() => table.evaluate((element) => element.scrollLeft)).toBeGreaterThan(0);
  const layers = await toolbar.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    const fixed = document.querySelector(".intake-batch-table tr[data-row-key] td:first-child")!;
    return {
      toolbarZ: Number(getComputedStyle(element).zIndex),
      fixedZ: Number(getComputedStyle(fixed).zIndex),
      covered: [rect.top + 18, rect.bottom - 18].map((y) => ({
        y,
        isToolbar: element.contains(document.elementFromPoint(rect.left + 48, y)),
      })),
    };
  });
  expect(layers.toolbarZ).toBeGreaterThan(layers.fixedZ);
  expect(layers.covered.every((point) => point.isToolbar)).toBe(true);
  await info.attach("sticky-layering", { body: JSON.stringify(layers), contentType: "application/json" });
  await toolbar.getByRole("button", { name: "统计", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "接收批次统计", exact: true });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("button", { name: "复制统计结果", exact: true })).toBeEnabled();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(toolbar.getByRole("button", { name: "统计", exact: true })).toBeFocused();
});
