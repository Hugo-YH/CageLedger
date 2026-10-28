import type { Page } from "@playwright/test";
import { ensureTestInfrastructure, expect, openBillingNavigation, openWorkflowCenter, test } from "./fixtures";

async function login(page: Page, username: string, password = "e2e-password") {
  await page.request.post("/api/auth/logout");
  expect((await page.request.post("/api/auth/login", { data: { username, password } })).ok()).toBeTruthy();
  await page.goto("/app");
}

async function openWorkflowMonth(page: Page, month: string) {
  await openWorkflowCenter(page);
  await page.getByRole("button", { name: "筛选结算月份", exact: true }).click();
  const filter = page.locator(".table-filter-panel:visible");
  await filter.getByRole("searchbox").fill(month);
  const option = filter.getByRole("checkbox", { name: new RegExp(`^${Number(month.slice(5))}月`) });
  if (!(await option.isChecked())) await option.click();
  await expect(option).toBeChecked();
  await filter.getByRole("button", { name: "应用", exact: true }).click();
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
  await page.getByRole("menuitem", { name: /结算列表/ }).click();
  await page.getByRole("button", { name: "筛选结算月份", exact: true }).click();
  const settlementMonthFilter = page.locator(".table-filter-panel:visible");
  await settlementMonthFilter.getByRole("searchbox").fill(month);
  const settlementMonthOption = settlementMonthFilter.getByRole("checkbox", {
    name: new RegExp(`^${Number(month.slice(5))}月`),
  });
  await settlementMonthOption.click();
  await expect(settlementMonthOption).toBeChecked();
  await settlementMonthFilter.getByRole("button", { name: "应用", exact: true }).click();
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
  await monthFilter.getByRole("searchbox").fill(month);
  const monthOption = monthFilter.getByRole("checkbox", { name: new RegExp(`^${Number(month.slice(5))}月`) });
  await monthOption.click();
  await expect(monthOption).toBeChecked();
  await monthFilter.getByRole("button", { name: "应用", exact: true }).click();
  const ownWorkflow = page.getByRole("row").filter({ hasText: ownPi });
  const foreignWorkflow = page.getByRole("row").filter({ hasText: foreignPi });
  await expect(ownWorkflow).toBeVisible();
  await expect(foreignWorkflow).toBeVisible();
  await expect(ownWorkflow.getByRole("button", { name: "登记", exact: true })).toBeVisible();
  await expect(foreignWorkflow.getByRole("button", { name: "登记", exact: true })).toBeVisible();
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

test("统计表录入人和交回登记人均可撤回，锁定后先解锁", async ({ page }) => {
  test.setTimeout(60_000);
  await login(page, "admin", "admin123");
  await ensureTestInfrastructure(page);
  const suffix = Date.now();
  const accounts = [`writer-${suffix}`, `registrar-${suffix}`, `stranger-${suffix}`];
  for (const username of accounts) {
    expect(
      (
        await page.request.post("/api/users", {
          data: {
            username,
            displayName: "同名经手人员",
            password: "e2e-password",
            role: "room_admin",
            roomIds: ["room-e2e-8014"],
          },
        })
      ).ok(),
    ).toBeTruthy();
  }
  const month = "2026-07";
  const pi = `E2E 多经手人 ${suffix}`;
  await login(page, accounts[0]);
  expect(
    (
      await page.request.post("/api/quantity-sheets", {
        data: {
          sheet: {
            id: `handled-sheet-${suffix}`,
            month,
            roomId: "room-e2e-8014",
            roomName: "8014",
            manager: "伪造姓名应被忽略",
            iacuc: `E2E-HANDLED-${suffix}`,
            pi,
            project: "经手人测试",
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
      })
    ).ok(),
  ).toBeTruthy();
  await login(page, "admin", "admin123");
  const generated = await page.request.post("/api/billing-statements/generate-by-pi", {
    data: { pi, month, sourceType: "quantity_sheet", persist: true, initiate: true },
  });
  expect(generated.ok()).toBeTruthy();
  const initial = await generated.json();
  const workflowId = initial.workflow.id as string;
  const initiatorId = initial.workflow.sentBy.id as string;
  await login(page, accounts[1]);
  expect(
    (
      await page.request.post("/api/billing-workflows/advance", {
        data: { workflowId, toStatus: "statement_archived", registration: { signedStatementReturned: true } },
      })
    ).ok(),
  ).toBeTruthy();
  const registrarDetail = await (await page.request.get(`/api/billing-workflows/${workflowId}`)).json();
  expect(registrarDetail.workflow.canWithdraw).toBe(true);
  await login(page, accounts[2]);
  const strangerDetail = await (await page.request.get(`/api/billing-workflows/${workflowId}`)).json();
  expect(strangerDetail.workflow.canWithdraw).toBe(false);
  expect(
    (
      await page.request.post("/api/billing-workflows/advance", {
        data: { workflowId, toStatus: "statement_sent", note: "同名账号不能越权" },
      })
    ).status(),
  ).toBe(403);
  await login(page, accounts[0]);
  await openWorkflowMonth(page, month);
  const row = page.getByRole("row").filter({ hasText: pi });
  await expect(row.getByText("未归档", { exact: true })).toBeVisible();
  await expect(row.getByRole("button", { name: "撤回", exact: true })).toBeVisible();
  await login(page, "admin", "admin123");
  expect(
    (
      await page.request.post("/api/billing-workflows/advance", {
        data: { workflowId, toStatus: "statement_locked", note: "归档核对完成的单据" },
      })
    ).ok(),
  ).toBeTruthy();
  await login(page, accounts[0]);
  await openWorkflowMonth(page, month);
  await expect(row.getByText("已归档", { exact: true })).toBeVisible();
  await expect(row.getByRole("button", { name: "撤回", exact: true })).toHaveCount(0);
  expect(
    (
      await page.request.post("/api/billing-workflows/advance", {
        data: { workflowId, toStatus: "statement_sent", note: "归档期间不可撤回" },
      })
    ).status(),
  ).toBe(403);
  await login(page, "admin", "admin123");
  expect(
    (
      await page.request.post("/api/billing-workflows/advance", {
        data: { workflowId, toStatus: "statement_archived", note: "解锁以修正单据" },
      })
    ).ok(),
  ).toBeTruthy();
  await login(page, accounts[0]);
  await openWorkflowMonth(page, month);
  await expect(row.getByText("未归档", { exact: true })).toBeVisible();
  await row.getByRole("button", { name: "撤回", exact: true }).click();
  const revoke = page.getByRole("dialog", { name: "撤回结算流程", exact: true });
  await revoke.getByLabel("撤回原因").fill("统计表录入人核对后撤回登记");
  await revoke.getByRole("button", { name: "确认撤回", exact: true }).click();
  await expect(revoke).not.toBeVisible();
  const final = await (await page.request.get(`/api/billing-workflows/${workflowId}`)).json();
  expect(final.workflow.workflowStatus).toBe("statement_sent");
  expect(final.workflow.sentBy.id).toBe(initiatorId);
  expect(final.events[0].note).toBe("统计表录入人核对后撤回登记");
});

test("房间管理员可登记他人发起的结算流程，登记信息和台账同步归档", async ({ page }) => {
  await login(page, "admin", "admin123");
  await ensureTestInfrastructure(page);
  const suffix = Date.now();
  const username = `register-room-${suffix}`;
  const account = await page.request.post("/api/users", {
    data: {
      username,
      displayName: "交回登记员",
      password: "e2e-password",
      role: "room_admin",
      roomIds: ["room-e2e-8014"],
    },
  });
  expect(account.ok()).toBeTruthy();
  const registrarId = (await account.json()).user.id as string;
  const month = "2026-07";
  const pi = `E2E 交回登记 ${suffix}`;
  const sheet = await page.request.post("/api/quantity-sheets", {
    data: {
      sheet: {
        id: `registration-sheet-${suffix}`,
        month,
        roomId: "room-e2e-8014",
        roomName: "8014",
        manager: "系统管理员",
        iacuc: `E2E-REGISTER-${suffix}`,
        pi,
        project: "交回登记测试",
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
  expect(sheet.ok()).toBeTruthy();
  const generated = await page.request.post("/api/billing-statements/generate-by-pi", {
    data: { pi, month, sourceType: "quantity_sheet", persist: true, initiate: true },
  });
  expect(generated.ok()).toBeTruthy();
  const generatedData = await generated.json();
  const workflowId = generatedData.workflow.id as string;
  const totalAmount = generatedData.workflow.totalAmount as number;

  await login(page, username);
  const invalid = await page.request.post("/api/billing-workflows/advance", {
    data: { workflowId, toStatus: "statement_archived", registration: { signedStatementReturned: false } },
  });
  expect(invalid.status()).toBe(400);
  await openWorkflowCenter(page);
  await page.getByRole("button", { name: "筛选结算月份", exact: true }).click();
  const monthFilter = page.locator(".table-filter-panel:visible");
  await monthFilter.getByRole("searchbox").fill(month);
  const monthOption = monthFilter.getByRole("checkbox", { name: new RegExp(`^${Number(month.slice(5))}月`) });
  await monthOption.click();
  await expect(monthOption).toBeChecked();
  await monthFilter.getByRole("button", { name: "应用", exact: true }).click();
  const row = page.getByRole("row").filter({ hasText: pi });
  await expect(row).toBeVisible();
  await expect(row.getByRole("button", { name: "撤回", exact: true })).toHaveCount(0);
  await row.getByRole("button", { name: "登记", exact: true }).click();
  const modal = page.getByRole("dialog").filter({ hasText: "交回登记" }).first();
  await modal.getByRole("switch", { name: "饲养费结算单", exact: true }).click();
  await modal.getByLabel("饲养费结算单备注").fill("房间管理员核对后登记");
  await modal.getByRole("button", { name: "保存登记", exact: true }).click();
  await expect(modal).not.toBeVisible();
  await expect(row).toContainText("结算单 已交回");
  await expect(row.getByRole("button", { name: "登记", exact: true })).toHaveCount(0);
  const detail = await (await page.request.get(`/api/billing-workflows/${workflowId}`)).json();
  expect(detail.workflow.workflowStatus).toBe("statement_archived");
  expect(detail.workflow.registeredBy.id).toBe(registrarId);
  expect(detail.workflow.signedStatementReturned).toBe(true);
  expect(detail.workflow.signedStatementNote).toBe("房间管理员核对后登记");
  expect(detail.workflow.totalAmount).toBe(totalAmount);
  const event = detail.events.find((item: { eventType: string }) => item.eventType === "statement_registered_archived");
  expect(event.actor.id).toBe(registrarId);
  const records = await (await page.request.get(`/api/reimbursement-records?month=${month}&limit=100`)).json();
  expect(records.items.find((item: { workflowId: string }) => item.workflowId === workflowId).workflowStatus).toBe(
    "statement_archived",
  );
  expect(
    (
      await page.request.post("/api/billing-workflows/advance", {
        data: { workflowId, toStatus: "statement_sent", note: "交回登记人撤回已登记单据" },
      })
    ).status(),
  ).toBe(200);
});
