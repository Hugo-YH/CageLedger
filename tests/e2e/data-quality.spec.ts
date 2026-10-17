import type { Locator, Page, TestInfo } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { expect, openSettingsView, test } from "./fixtures";
import { captureUiAudit } from "./uiAudit";
import type { DataQualityFinding, DataQualityScan } from "../../src/contracts/dataQuality";

const scan: DataQualityScan = {
  id: "archive-latest",
  scannedAt: "2026-10-15T04:00:00Z",
  detectorVersion: "historical-references-v1",
  latestBusinessAt: "2026-10-10T13:16:54Z",
  scope: "历史笼位、进驻来源、旧码别名及孤立应收引用；不代替完整业务核查",
  trigger: "upgrade",
  actorName: "系统升级核查",
  sourceSha256: "a".repeat(64),
  sourceSnapshot: { format: "sqlite-review-inputs-v1", tables: {} },
  findingCount: 25,
  needsReview: 16,
  retainedHistory: 9,
  categories: [],
};
const older: DataQualityScan = {
  ...scan,
  id: "archive-older",
  scannedAt: "2026-10-01T04:00:00Z",
  findingCount: 0,
  needsReview: 0,
  retainedHistory: 0,
};
const findings: DataQualityFinding[] = Array.from({ length: 25 }, (_, index) => ({
  id: `dq-${index}`,
  code: index % 2 ? "placement_missing_receipt" : "occupancy_missing_slot",
  codeLabel: index % 2 ? "进驻接收明细关联缺失" : "占用笼位关联缺失",
  summary: `待核对记录 ${index}`,
  reviewStatus: index % 3 ? "needs_review" : "retained_history",
  reviewStatusLabel: index % 3 ? "待核对" : "保留历史",
  entityType: "placement_tasks",
  entityTypeLabel: "进驻任务",
  entityId: `task-${index}`,
  referenceId: `missing-receipt-${index}`,
}));

async function login(page: Page) {
  expect((await page.request.post("/api/auth/login", { data: { username: "admin", password: "admin123" } })).ok()).toBe(
    true,
  );
}

async function checkLayout(page: Page, info: TestInfo, name: string, dialog?: Locator) {
  const original = page.viewportSize();
  for (const [width, height] of [
    [1440, 900],
    [1180, 900],
    [760, 900],
    [844, 390],
  ]) {
    await page.setViewportSize({ width, height });
    const target = dialog || page.locator(".data-quality-page");
    const touch = width < 768 || height < 500;
    await expect
      .poll(async () =>
        target.evaluate(
          (element, options) => {
            const rect = element.getBoundingClientRect();
            const label = options.modal ? "关闭" : "查看";
            const button = [...element.querySelectorAll<HTMLElement>("button")].find(
              (node) => node.textContent?.trim() === label,
            );
            const bounds = !options.modal || (rect.top >= -1 && rect.bottom <= innerHeight + 1);
            const expectedHeight = options.touch ? 44 : options.modal ? 32 : 24;
            const buttonReady = Boolean(
              button && Math.abs(button.getBoundingClientRect().height - expectedHeight) < 0.1,
            );
            const select = element.querySelector<HTMLElement>(".data-quality-scan-select");
            const selectReady =
              !select || Math.abs(select.getBoundingClientRect().height - (options.touch ? 40 : 32)) < 0.1;
            const body = element.querySelector<HTMLElement>(".modal-shell-body")?.getBoundingClientRect();
            return {
              bounds,
              bodyFits: !body || (body.top >= rect.top - 1 && body.bottom <= rect.bottom + 1),
              pageFits: document.documentElement.scrollWidth <= innerWidth,
              buttonReady,
              selectReady,
            };
          },
          { modal: Boolean(dialog), touch },
        ),
      )
      .toEqual({ bounds: true, bodyFits: true, pageFits: true, buttonReady: true, selectReady: true });
    const metrics = await target.evaluate((element) => {
      const body = element.querySelector<HTMLElement>(".modal-shell-body");
      const style = getComputedStyle(body || element);
      const rect = element.getBoundingClientRect();
      return {
        rect: rect.toJSON(),
        display: style.display,
        minWidth: style.minWidth,
        minHeight: style.minHeight,
        gap: style.gap,
        overflow: style.overflow,
        position: style.position,
        zIndex: style.zIndex,
        body: body
          ? { height: body.clientHeight, scrollHeight: body.scrollHeight, overflowY: getComputedStyle(body).overflowY }
          : null,
        controls: [...element.querySelectorAll<HTMLElement>(".ant-btn,.data-quality-scan-select")]
          .filter((node) => node.getBoundingClientRect().height > 0)
          .map((node) => ({
            text: node.getAttribute("aria-label") || node.textContent,
            height: getComputedStyle(node).height,
            font: getComputedStyle(node).fontSize,
          })),
      };
    });
    if (dialog) {
      expect(metrics.body?.height).toBeGreaterThan(40);
      expect(metrics.body?.overflowY).toBe("auto");
    }
    await info.attach(`${name}-${width}-computed-style`, {
      contentType: "application/json",
      body: JSON.stringify(metrics),
    });
    await page.screenshot({ path: info.outputPath(`${name}-${width}-settled.png`), animations: "disabled" });
  }
  if (original) await page.setViewportSize(original);
}

async function mockArchive(
  page: Page,
  options: { noArchive?: boolean; failDetail?: boolean; delay?: Promise<void> } = {},
) {
  const requests: string[] = [];
  await page.route("**/api/data-quality/**", async (route) => {
    expect(route.request().method()).toBe("GET");
    requests.push(route.request().url());
    const url = new URL(route.request().url());
    const parts = url.pathname.split("/");
    if (parts.length === 4) {
      if (options.delay) await options.delay;
      const offset = Number(url.searchParams.get("offset"));
      return route.fulfill({
        json: {
          items: options.noArchive ? [] : offset ? [older] : [scan],
          page: { limit: 20, offset, total: options.noArchive ? 0 : 21, hasMore: !offset && !options.noArchive },
        },
      });
    }
    const selectedScan = parts[4] === older.id ? older : scan;
    if (parts.length === 7) {
      if (options.failDetail) return route.fulfill({ status: 409, json: { error: "问题留档证据校验失败，无法展示" } });
      const item = findings.find((item) => item.id === parts[6])!;
      return route.fulfill({
        json: {
          scan: selectedScan,
          item,
          evidenceSha256: "b".repeat(64),
          evidence: {
            taskPayloadText: JSON.stringify({
              id: item.entityId,
              iacuc: "Z2026001",
              pi: "核查负责人",
              notes: "<script>window.untrustedArchive=true</script>",
            }),
            historicalReceiptSnapshots: [
              { auditEventId: "original-audit", receipt: { id: item.referenceId, notes: "接收历史证据" } },
            ],
          },
        },
      });
    }
    const filters = JSON.parse(url.searchParams.get("columnFilters") || "{}");
    const all = selectedScan === older ? [] : findings;
    const matches = (item: DataQualityFinding, exclude = "") =>
      Object.entries(filters).every(
        ([key, values]) =>
          key === exclude ||
          !(values as string[]).length ||
          (values as string[]).includes(String(item[key as keyof DataQualityFinding])),
      );
    const selected = all.filter((item) => matches(item));
    const offset = Number(url.searchParams.get("offset"));
    const limit = Number(url.searchParams.get("limit"));
    const filterOptions = Object.fromEntries(
      (["code", "reviewStatus"] as const).map((key) => [
        key,
        [...new Set(all.map((item) => item[key]))].map((value) => ({
          value,
          label: all.find((item) => item[key] === value)![key === "code" ? "codeLabel" : "reviewStatusLabel"],
          count: all.filter((item) => matches(item, key) && item[key] === value).length,
        })),
      ]),
    );
    return route.fulfill({
      json: {
        scan: selectedScan,
        items: selected.slice(offset, offset + limit),
        page: { limit, offset, total: selected.length, hasMore: offset + limit < selected.length },
        filterOptions,
      },
    });
  });
  return { requests, options };
}

test("data quality archive filters, details and older snapshots are read only across layouts", async ({
  page,
}, testInfo) => {
  await login(page);
  const fixture = await mockArchive(page);
  await page.goto("/app");
  await openSettingsView(page, "数据核查");
  await expect(page.getByRole("heading", { name: "数据核查", exact: true })).toBeVisible();
  await expect(page.getByRole("row", { name: /待核对记录 0\s/ })).toBeVisible();
  await captureUiAudit(page, testInfo, "data-quality-list");
  await checkLayout(page, testInfo, "data-quality-list");
  const pageAxe = await new AxeBuilder({ page }).include(".workspace-view[data-feature='administration']").analyze();
  expect(pageAxe.violations.filter((issue) => issue.impact === "serious" || issue.impact === "critical")).toEqual([]);
  await page.getByRole("button", { name: "筛选问题分类", exact: true }).click();
  const category = page.getByRole("group", { name: "筛选问题分类选项" }).getByLabel("进驻接收明细关联缺失");
  await category.click();
  await expect(category).toBeChecked();
  await page.getByRole("button", { name: "应用", exact: true }).click();
  const row = page.getByRole("row", { name: /待核对记录 1\s/ });
  await expect(row).toBeVisible();
  await expect(page.getByRole("row", { name: /待核对记录 0\s/ })).toHaveCount(0);
  await row.getByRole("button", { name: "查看", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "核查留档详情", exact: true });
  await expect(dialog.getByText("证据校验通过", { exact: true })).toBeVisible();
  await dialog.getByRole("button", { name: /进驻任务快照/ }).click();
  await expect(dialog.getByText("核查负责人", { exact: true })).toBeVisible();
  await dialog.getByRole("button", { name: /审计中的接收明细快照/ }).click();
  await expect(dialog.locator("pre").filter({ hasText: "接收历史证据" })).toBeVisible();
  expect(await page.evaluate(() => "untrustedArchive" in window)).toBe(false);
  await captureUiAudit(page, testInfo, "data-quality-evidence", dialog);
  await checkLayout(page, testInfo, "data-quality-evidence", dialog);
  const axe = await new AxeBuilder({ page }).include(".data-quality-detail-modal").analyze();
  expect(axe.violations.filter((issue) => issue.impact === "serious" || issue.impact === "critical")).toEqual([]);
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(row.getByRole("button", { name: "查看", exact: true })).toBeFocused();
  await page.getByRole("button", { name: "加载更早留档", exact: true }).click();
  await expect(page.getByRole("button", { name: "加载更早留档", exact: true })).toHaveCount(0);
  await page.getByRole("combobox", { name: "核查留档", exact: true }).click();
  await page
    .locator(".ant-select-dropdown")
    .getByText(/2026\/10\/1\s/)
    .click();
  await expect(page.getByText("本次留档未发现该核查范围内的关联问题", { exact: true })).toBeVisible();
  expect(fixture.requests.some((url) => url.includes("offset=20"))).toBe(true);
});

test("data quality handles loading, empty archives and damaged evidence without exposing it", async ({ page }) => {
  await page.setViewportSize({ width: 844, height: 390 });
  await login(page);
  let release!: () => void;
  const fixture = await mockArchive(page, {
    delay: new Promise<void>((resolve) => {
      release = resolve;
    }),
    failDetail: true,
  });
  await page.goto("/app");
  await openSettingsView(page, "数据核查");
  await expect(page.locator('[aria-busy="true"]').first()).toBeVisible();
  release();
  await page.getByRole("button", { name: "查看", exact: true }).first().click();
  const dialog = page.getByRole("dialog", { name: "核查留档详情", exact: true });
  await expect(dialog.getByText("问题留档证据校验失败，无法展示", { exact: true })).toBeVisible();
  await expect(dialog.getByRole("button", { name: "重新加载", exact: true })).toHaveCSS("min-height", "44px");
  await expect(dialog.getByText("证据校验通过", { exact: true })).toHaveCount(0);
  fixture.options.failDetail = false;
  await dialog.getByRole("button", { name: "重新加载", exact: true }).click();
  await expect(dialog.getByText("证据校验通过", { exact: true })).toBeVisible();
  await dialog.getByRole("button", { name: "关闭", exact: true }).click();
  fixture.options.noArchive = true;
  await page.getByRole("button", { name: "刷新", exact: true }).click();
  await expect(page.getByText("暂无核查留档", { exact: true })).toBeVisible();
});

test("room administrators cannot open or request global archive evidence", async ({ page, playwright }) => {
  await login(page);
  const real = await page.request.get("/api/data-quality/scans");
  expect(real.status()).toBe(200);
  const data = await real.json();
  expect(data.items.length).toBeGreaterThan(0);
  expect((await page.request.post("/api/data-quality/scans", { data: {} })).status()).toBe(404);
  expect(
    (
      await page.request.post("/api/users", {
        data: {
          username: "data-quality-room",
          displayName: "核查权限验收",
          password: "e2e-password",
          role: "room_admin",
          roomIds: [],
        },
      })
    ).ok(),
  ).toBe(true);
  const context = await playwright.request.newContext({ baseURL: test.info().project.use.baseURL });
  try {
    expect(
      (
        await context.post("/api/auth/login", { data: { username: "data-quality-room", password: "e2e-password" } })
      ).ok(),
    ).toBe(true);
    expect((await context.get("/api/data-quality/scans")).status()).toBe(403);
    expect((await context.get(`/api/data-quality/scans/${data.items[0].id}/issues`)).status()).toBe(403);
  } finally {
    await context.dispose();
  }
  await page.request.post("/api/auth/logout");
  await page.request.post("/api/auth/login", { data: { username: "data-quality-room", password: "e2e-password" } });
  await page.goto("/app");
  await page.getByRole("menuitem", { name: /系统设置/ }).click();
  await expect(page.getByRole("menuitem", { name: /数据核查/ })).toHaveCount(0);
});

test("mobile administrators open the archive from system settings", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 844, height: 390 });
  await page.emulateMedia({ colorScheme: "dark" });
  await login(page);
  await mockArchive(page);
  await page.goto("/app");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await openSettingsView(page, "数据核查");
  await expect(page.getByRole("heading", { name: "数据核查", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "查看", exact: true }).first().click();
  await expect(page.getByRole("dialog", { name: "核查留档详情", exact: true })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("data-quality-dark-mobile.png"), animations: "disabled" });
  const axe = await new AxeBuilder({ page }).include(".data-quality-detail-modal").analyze();
  expect(axe.violations.filter((issue) => issue.impact === "serious" || issue.impact === "critical")).toEqual([]);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: "核查留档详情", exact: true })).toHaveCount(0);
});
