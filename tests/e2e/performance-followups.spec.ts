import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import type { Page } from "@playwright/test";

import { ensureTestInfrastructure, expect, openSavedQuantitySheets, test } from "./fixtures";

async function login(page: Page) {
  await page.goto("/app");
  await page.getByLabel("用户名", { exact: true }).fill("admin");
  await page.getByLabel("密码", { exact: true }).fill("admin123");
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await expect(page.getByRole("heading", { name: "实验动物笼位管理与计费系统", exact: true })).toBeVisible();
}

test("dashboard revalidates unchanged data on return and keeps the legacy JSON response", async ({ page, request }) => {
  const statuses: number[] = [];
  page.on("response", (response) => {
    if (new URL(response.url()).pathname === "/api/dashboard/overview") statuses.push(response.status());
  });
  await login(page);
  await expect(page.getByRole("button", { name: /查看饲养费金额，/ })).toBeVisible();
  const first = await page.request.get("/api/dashboard/overview?month=2026-09");
  expect(first.status()).toBe(200);
  const payload = await first.json();
  expect(payload.month).toBe("2026-09");
  expect(payload).not.toHaveProperty("value");
  const cached = await page.request.get("/api/dashboard/overview?month=2026-09", {
    headers: { "If-None-Match": first.headers().etag },
  });
  expect(cached.status()).toBe(304);
  expect((await cached.body()).length).toBe(0);
  const denied = await request.get("/api/dashboard/overview", {
    headers: { "If-None-Match": first.headers().etag, Cookie: "cageledger_session=invalid" },
  });
  expect(denied.status()).toBe(401);
  await openSavedQuantitySheets(page);
  await expect(page.getByRole("heading", { name: "已保存数量统计表", exact: true })).toBeVisible();
  await page.clock.setFixedTime(new Date(Date.now() + 16_000));
  await page.getByRole("menuitem", { name: /总览$/ }).click();
  await expect.poll(() => statuses).toContain(304);
  await expect(page.getByRole("button", { name: /查看饲养费金额，/ })).toBeVisible();
  await expect(page.getByText("运营数据更新失败，暂显示上次结果", { exact: true })).toBeHidden();
});

test("saved quantity selection preserves all paginated results with at most three requests at once", async ({
  page,
}) => {
  await login(page);
  const items = Array.from({ length: 301 }, (_, index) => ({
    id: `perf-quantity-${index}`,
    month: "2026-09",
    iacuc: `E2E-PERF-${index}`,
    project: "分页验证",
    pi: "性能验证负责人",
    roomName: "8014",
    manager: "系统管理员",
    owner: "性能验证",
    funding: "E2E",
    initialCageCount: 1,
    rows: [],
    billingUnit: "cage_day",
  }));
  let active = 0;
  let maximum = 0;
  const offsets: number[] = [];
  await page.route("**/api/quantity-sheets?**", async (route) => {
    const params = new URL(route.request().url()).searchParams;
    const limit = Number(params.get("limit") || "10");
    const offset = Number(params.get("offset") || "0");
    if (limit === 100) {
      active++;
      maximum = Math.max(maximum, active);
      offsets.push(offset);
    }
    try {
      await new Promise((resolve) => setTimeout(resolve, 50));
      await route.fulfill({
        json: {
          items: items.slice(offset, offset + limit),
          page: { limit, offset, total: items.length, hasMore: offset + limit < items.length },
        },
      });
    } finally {
      if (limit === 100) active--;
    }
  });
  await openSavedQuantitySheets(page);
  await page.getByRole("checkbox", { name: "全选当前筛选结果统计表", exact: true }).check();
  const toolbar = page.getByRole("group", { name: "已保存统计表操作", exact: true });
  await expect(toolbar.getByText(`已选 ${items.length} 项`, { exact: true })).toBeVisible();
  expect(maximum).toBe(3);
  expect(offsets).toEqual([0, 100, 200, 300]);
  await page.getByRole("checkbox", { name: "全选当前筛选结果统计表", exact: true }).uncheck();
  await expect(toolbar.getByText("已选 0 项", { exact: true })).toBeVisible();
});

test("a copied quantity PDF completes and downloads after leaving its page", async ({ page }) => {
  test.setTimeout(60_000);
  await login(page);
  await ensureTestInfrastructure(page);
  const id = `pdf-perf-${randomUUID()}`;
  const iacuc = `E2E-${id}`.toUpperCase();
  const month = new Date().toISOString().slice(0, 7);
  const saved = await page.request.post("/api/quantity-sheets", {
    data: {
      sheet: {
        id,
        month,
        iacuc,
        roomId: "room-e2e-8014",
        roomName: "8014",
        manager: "系统管理员",
        project: "后台PDF验证",
        pi: "性能验证负责人",
        owner: "E2E",
        funding: "E2E",
        billingUnit: "cage_day",
        animalDetailEnabled: false,
        initialAnimalCount: 0,
        initialCageCount: 2,
        pageCount: 1,
        rows: [{ id: `${id}-row`, date: `${month}-01`, cageCount: 2 }],
      },
    },
  });
  expect(saved.ok()).toBe(true);
  // Keep this PDF fixture visible regardless of other specs' months/page order.
  await page.route("**/api/quantity-sheets?**", async (route) => {
    const url = new URL(route.request().url());
    url.searchParams.set("columnFilters", JSON.stringify({ iacuc: [iacuc] }));
    await route.fulfill({ response: await route.fetch({ url: url.toString() }) });
  });
  await openSavedQuantitySheets(page);
  await page.getByRole("checkbox", { name: `选择 ${iacuc}`, exact: true }).check();
  const download = page.waitForEvent("download", { timeout: 45_000 });
  const started = page.waitForResponse(
    (response) => response.url().endsWith("/api/pdf-exports") && response.request().method() === "POST",
  );
  await page
    .getByRole("group", { name: "已保存统计表操作", exact: true })
    .getByRole("button", { name: "导出 PDF", exact: true })
    .click();
  expect([200, 202]).toContain((await started).status());
  await page.getByRole("menuitem", { name: /总览$/ }).click();
  const file = await download;
  const content = await readFile(await file.path());
  expect(content.subarray(0, 4).toString()).toBe("%PDF");
  expect(content.length).toBeGreaterThan(1000);
  expect(file.suggestedFilename()).toContain(iacuc);
  expect((await page.request.delete(`/api/quantity-sheets/${id}`)).ok()).toBe(true);
});
