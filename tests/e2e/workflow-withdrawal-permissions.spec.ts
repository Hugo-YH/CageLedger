import type { Page } from "@playwright/test";
import { ensureTestInfrastructure, expect, openBillingNavigation, openWorkflowCenter, test } from "./fixtures";

async function login(page: Page, username: string, password = "e2e-password") {
  await page.request.post("/api/auth/logout");
  expect((await page.request.post("/api/auth/login", { data: { username, password } })).ok()).toBeTruthy();
  await page.goto("/app");
}

test("房间管理员按账号撤回本人流程，按钮与接口权限一致，原因和台账同步", async ({ page }) => {
  test.setTimeout(60_000);
  await login(page, "admin", "admin123");
  await ensureTestInfrastructure(page);
  const suffix = Date.now();
  const username = `withdraw-owner-${suffix}`;
  const created = await page.request.post("/api/users", {
    data: {
      username,
      displayName: "同名登记员",
      password: "e2e-password",
      role: "room_admin",
      roomIds: ["room-e2e-8014"],
    },
  });
  expect(created.ok()).toBeTruthy();
  const ownerId = (await created.json()).user.id as string;
  const month = "2026-07";
  const ownPi = `E2E 本人撤回 ${suffix}`;
  const foreignPi = `E2E 他人撤回 ${suffix}`;
  for (const [index, pi] of [ownPi, foreignPi].entries()) {
    const response = await page.request.post("/api/quantity-sheets", {
      data: {
        sheet: {
          id: `withdraw-sheet-${suffix}-${index}`,
          month,
          roomId: "room-e2e-8014",
          roomName: "8014",
          manager: "同名登记员",
          iacuc: `E2E-WITHDRAW-${suffix}-${index}`,
          pi,
          project: "撤回权限测试",
          owner: "实验负责人",
          funding: "TEST",
          billingUnit: "cage_day",
          animalDetailEnabled: false,
          initialAnimalCount: 0,
          initialCageCount: 15,
          pageCount: 1,
          rows: [],
        },
      },
    });
    expect(response.ok()).toBeTruthy();
  }
  const foreignResponse = await page.request.post("/api/billing-statements/generate-by-pi", {
    data: { pi: foreignPi, month, sourceType: "quantity_sheet", persist: true, initiate: true },
  });
  expect(foreignResponse.ok()).toBeTruthy();
  const foreignId = (await foreignResponse.json()).workflow.id as string;

  await login(page, username);
  const ownResponse = await page.request.post("/api/billing-statements/generate-by-pi", {
    data: { pi: ownPi, month, sourceType: "quantity_sheet", persist: true, initiate: false },
  });
  expect(ownResponse.ok()).toBeTruthy();
  const ownDraftId = (await ownResponse.json()).workflow.id as string;
  const candidates = await page.request.get(
    `/api/billing-settlement-candidates?limit=100&columnFilters=${encodeURIComponent(JSON.stringify({ month: [month] }))}`,
  );
  const candidateItems = (await candidates.json()).items as Array<{ pi: string; canWithdraw: boolean }>;
  expect(candidateItems.find((item) => item.pi === ownPi)?.canWithdraw).toBe(true);
  expect(candidateItems.find((item) => item.pi === foreignPi)?.canWithdraw).toBe(false);

  await page.reload();
  await openBillingNavigation(page);
  await page.getByRole("menuitem", { name: /结算管理/ }).click();
  const ownRow = page.getByRole("row").filter({ hasText: ownPi });
  const foreignRow = page.getByRole("row").filter({ hasText: foreignPi });
  await foreignRow.getByRole("checkbox").check();
  await expect(
    page.getByLabel("结算批量操作", { exact: true }).getByRole("button", { name: "撤回", exact: true }),
  ).toBeDisabled();
  await foreignRow.getByRole("button", { name: "预览结算单" }).click();
  const preview = page.locator(".settlement-preview-modal");
  await expect(preview.getByRole("button", { name: "撤回", exact: true })).toHaveCount(0);
  await preview.locator(".ant-modal-close").click();
  await foreignRow.getByRole("checkbox").uncheck();
  await ownRow.getByRole("checkbox").check();
  await page.getByLabel("结算批量操作", { exact: true }).getByRole("button", { name: "撤回", exact: true }).click();
  const cancelDialog = page.getByRole("dialog", { name: "批量撤回结算流程", exact: true });
  await expect(cancelDialog.getByRole("button", { name: "撤回 1 个流程", exact: true })).toBeDisabled();
  await cancelDialog.getByLabel("撤回原因").fill("金额有误，重新核算");
  await cancelDialog.getByRole("button", { name: "撤回 1 个流程", exact: true }).click();
  await expect(ownRow).toContainText("未发起");
  expect((await page.request.get(`/api/billing-workflows/${ownDraftId}`)).status()).toBe(404);

  const initiated = await page.request.post("/api/billing-statements/generate-by-pi", {
    data: { pi: ownPi, month, sourceType: "quantity_sheet", persist: true, initiate: true },
  });
  expect(initiated.ok()).toBeTruthy();
  const ownId = (await initiated.json()).workflow.id as string;
  await page.reload();
  await openWorkflowCenter(page);
  await page.getByRole("button", { name: "筛选结算月份", exact: true }).click();
  const monthFilter = page.locator(".table-filter-panel:visible");
  const monthOption = monthFilter.getByRole("checkbox", { name: new RegExp(`^${month}`) });
  await monthOption.click();
  await expect(monthOption).toBeChecked();
  await monthFilter.getByRole("button", { name: "应用", exact: true }).click();
  const ownWorkflow = page.getByRole("row").filter({ hasText: ownPi });
  const foreignWorkflow = page.getByRole("row").filter({ hasText: foreignPi });
  await expect(ownWorkflow).toBeVisible();
  await expect(foreignWorkflow).toBeVisible();
  await expect(ownWorkflow.getByRole("button", { name: "登记", exact: true })).toHaveCount(0);
  await expect(foreignWorkflow.getByRole("button", { name: "撤回", exact: true })).toHaveCount(0);
  await ownWorkflow.getByRole("button", { name: "撤回", exact: true }).click();
  const revokeDialog = page.getByRole("dialog", { name: "撤回结算流程", exact: true });
  await revokeDialog.getByLabel("撤回原因").fill("发现金额不符，重新发起");
  await revokeDialog.getByRole("button", { name: "确认撤回", exact: true }).click();
  await expect(revokeDialog).not.toBeVisible();
  const detailResponse = await page.request.get(`/api/billing-workflows/${ownId}`);
  const detail = await detailResponse.json();
  expect(detail.workflow.workflowStatus).toBe("statement_generated");
  expect(detail.events[0].actor.id).toBe(ownerId);
  expect(detail.events[0].note).toBe("发现金额不符，重新发起");
  const records = await page.request.get(`/api/reimbursement-records?month=${month}&limit=100`);
  const ledger = (await records.json()).items.find((item: { workflowId: string }) => item.workflowId === ownId);
  expect(ledger.workflowStatus).toBe("statement_generated");
  expect(
    (await page.request.delete(`/api/billing-workflows/${foreignId}`, { data: { note: "越权测试" } })).status(),
  ).toBe(403);
  expect(
    (
      await page.request.post("/api/billing-workflows/advance", {
        data: { workflowId: foreignId, toStatus: "statement_generated", note: "越权测试" },
      })
    ).status(),
  ).toBe(403);
  expect(
    (
      await page.request.post("/api/billing-workflows/advance", {
        data: { workflowId: ownId, toStatus: "statement_archived", note: "越权归档" },
      })
    ).status(),
  ).toBe(403);

  await login(page, "admin", "admin123");
  const adminList = await page.request.get(`/api/billing-workflows?month=${month}&limit=100`);
  expect((await adminList.json()).items.find((item: { id: string }) => item.id === foreignId).canWithdraw).toBe(true);
  await login(page, username);
  const ownerList = await page.request.get(`/api/billing-workflows?month=${month}&limit=100`);
  expect((await ownerList.json()).items.find((item: { id: string }) => item.id === foreignId).canWithdraw).toBe(false);
});
