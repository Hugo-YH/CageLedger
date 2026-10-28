import { readFile } from "node:fs/promises";
import type { Page } from "@playwright/test";
import {
  ensureTestInfrastructure,
  expect,
  openNavigationEntry,
  openSettlementNavigation,
  openWorkflowCenter,
  test,
} from "./fixtures";

async function login(page: Page, username: string, password = "settlement-permissions") {
  await page.request.post("/api/auth/logout");
  const response = await page.request.post("/api/auth/login", { data: { username, password } });
  expect(response.ok()).toBeTruthy();
  await page.goto("/app");
  if (await page.evaluate(() => window.matchMedia("(max-width: 767px)").matches))
    await page.getByRole("tab", { name: "总览", exact: true }).click();
  else await page.getByRole("menuitem", { name: /总览/ }).click();
}

async function seed(page: Page) {
  await login(page, "admin", "admin123");
  await ensureTestInfrastructure(page);
  const suffix = `${Date.now()}-${test.info().retry}`;
  const operator = `settlement-lock-${suffix}`;
  const ordinary = `settlement-ordinary-${suffix}`;
  for (const [username, allowed] of [
    [operator, true],
    [ordinary, false],
  ] as const) {
    const created = await page.request.post("/api/users", {
      data: {
        username,
        displayName: username,
        password: "settlement-permissions",
        role: "room_admin",
        roomIds: [],
        billingLockAllowed: allowed,
      },
    });
    expect(created.ok()).toBeTruthy();
  }
  const pi = `授权测试 ${suffix}`;
  const month = "2026-11";
  const saved = await page.request.post("/api/quantity-sheets", {
    data: {
      sheet: {
        id: `lock-permission-sheet-${suffix}`,
        month,
        roomId: "room-e2e-8014",
        roomName: "8014",
        pi,
        iacuc: `LOCK-${suffix}`,
        project: "权限回归",
        owner: "测试负责人",
        funding: "TEST",
        billingUnit: "cage_day",
        animalDetailEnabled: false,
        initialAnimalCount: 0,
        initialCageCount: 1,
        pageCount: 1,
        rows: [],
      },
    },
  });
  expect(saved.ok()).toBeTruthy();
  const generated = await page.request.post("/api/billing-statements/generate-by-pi", {
    data: { pi, month, sourceType: "quantity_sheet", persist: true, initiate: true },
  });
  expect(generated.ok()).toBeTruthy();
  const workflowId = (await generated.json()).workflow.id as string;
  return { operator, ordinary, pi, month, workflowId };
}

for (const [layout, viewport] of [
  ["desktop", { width: 1440, height: 900 }],
  ["mobile", { width: 390, height: 844 }],
] as const) {
  test(`${layout}: lock operator can export monthly summary; ordinary account cannot access menu, page or API`, async ({
    page,
  }) => {
    test.setTimeout(60_000);
    await page.setViewportSize(viewport);
    const { operator, ordinary, month } = await seed(page);
    for (const [username, password] of [
      ["admin", "admin123"],
      [operator, "settlement-permissions"],
    ]) {
      await login(page, username, password);
      await openNavigationEntry(page, "结算管理", "汇总导出");
      await expect(page.getByRole("heading", { name: "汇总导出", exact: true })).toBeVisible();
      const input = page.getByRole("textbox", { name: "结算月份", exact: true });
      await input.fill(month);
      await input.press("Enter");
      const download = page.waitForEvent("download");
      await page.getByRole("button", { name: "导出月度汇总 Excel", exact: true }).click();
      const file = await download;
      expect(file.suggestedFilename()).toMatch(/\.xlsx$/);
      const path = await file.path();
      expect(path).toBeTruthy();
      if (!path) throw new Error("下载文件路径缺失");
      expect((await readFile(path)).subarray(0, 2).toString()).toBe("PK");
      await page.reload();
      await expect(page.getByRole("heading", { name: "汇总导出", exact: true })).toBeVisible();
      if (username === operator) {
        await test.info().attach(`${layout}-summary-lock-operator`, {
          body: await page.screenshot({ fullPage: true }),
          contentType: "image/png",
        });
        await openNavigationEntry(page, "技术服务费管理", "已保存技术服务明细");
        await page.getByRole("button", { name: "汇总导出", exact: true }).click();
        await expect(page.getByRole("heading", { name: "汇总导出", exact: true })).toBeVisible();
      }
    }
    await login(page, ordinary);
    const navigation = await openSettlementNavigation(page);
    await expect(navigation.getByText("汇总导出", { exact: true })).toHaveCount(0);
    const denied = await page.request.post("/api/billing-monthly-summary/export", { data: { month } });
    expect(denied.status()).toBe(403);
    await page.evaluate(() =>
      localStorage.setItem("cageledger.ui.v2", JSON.stringify({ activeView: "billing-monthly-summary" })),
    );
    await page.reload();
    await expect(page.getByRole("heading", { name: "汇总导出", exact: true })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "导出月度汇总 Excel", exact: true })).toHaveCount(0);
  });
}

test("lock operator withdraws a foreign workflow from the list with a required reason and matching API capability", async ({
  page,
}) => {
  test.setTimeout(60_000);
  const { operator, ordinary, workflowId, pi, month } = await seed(page);
  await login(page, ordinary);
  const denied = await page.request.post("/api/billing-workflows/advance", {
    data: { workflowId, toStatus: "statement_generated", note: "越权" },
  });
  expect(denied.status()).toBe(403);
  await login(page, operator);
  const detail = await page.request.get(`/api/billing-workflows/${workflowId}`);
  expect((await detail.json()).workflow.canWithdraw).toBe(true);
  await openWorkflowCenter(page);
  await page.getByRole("button", { name: "筛选结算月份", exact: true }).click();
  const filter = page.locator(".table-filter-panel:visible");
  await filter.getByRole("searchbox").fill(month);
  const option = filter.getByRole("checkbox", { name: new RegExp(`^${Number(month.slice(5))}月`) });
  await option.click();
  await expect(option).toBeChecked();
  await filter.getByRole("button", { name: "应用", exact: true }).click();
  await page.getByRole("row").filter({ hasText: pi }).getByRole("button", { name: "撤回", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "撤回结算流程", exact: true });
  await expect(dialog.getByRole("button", { name: "确认撤回", exact: true })).toBeDisabled();
  await dialog.getByLabel("撤回原因").fill("锁定授权人员核对后撤回");
  await dialog.getByRole("button", { name: "确认撤回", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  const response = await page.request.get(`/api/billing-workflows/${workflowId}`);
  const changed = await response.json();
  expect(changed.workflow.workflowStatus).toBe("statement_generated");
  expect(changed.events[0].note).toBe("锁定授权人员核对后撤回");
  expect(changed.events[0].actor.username).toBe(operator);
});
