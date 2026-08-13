import { ensureTestInfrastructure, expect, openBillingNavigation, test } from "./fixtures";

const month = new Date().toISOString().slice(0, 7);
const zeroSheetId = "sheet-e2e-zero";
const paidSheetId = "sheet-e2e-paid";
const revertSheetIds = ["sheet-e2e-revert-1", "sheet-e2e-revert-2"];
const lateSheetId = "sheet-e2e-late";
const reregisterSheetId = "sheet-e2e-reregister";

test.afterEach(async ({ page }) => {
  await page.request.delete(`/api/quantity-sheets/${zeroSheetId}`).catch(() => {});
  await page.request.delete(`/api/quantity-sheets/${paidSheetId}`).catch(() => {});
  for (const id of revertSheetIds) await page.request.delete(`/api/quantity-sheets/${id}`).catch(() => {});
  await page.request.delete(`/api/quantity-sheets/${lateSheetId}`).catch(() => {});
  await page.request.delete(`/api/quantity-sheets/${reregisterSheetId}`).catch(() => {});
});

test("单据跟踪展示以结算流程为主线的面板", async ({ page }) => {
  await page.goto("/app");
  await page.getByLabel("用户名", { exact: true }).fill("admin");
  await page.getByLabel("密码", { exact: true }).fill("admin123");
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await expect(page.getByRole("heading", { name: "实验动物笼位管理与计费系统", exact: true })).toBeVisible();

  await openBillingNavigation(page);
  await page.getByRole("menuitem", { name: /单据跟踪/ }).click();
  await expect(page.getByRole("heading", { name: "单据跟踪", exact: true })).toBeVisible();
  await expect(page.getByText("以饲养费结算单为主线")).toBeVisible();
  await expect(page.getByRole("columnheader", { name: /结算月份/ })).toBeVisible();
  await expect(page.getByRole("columnheader", { name: /IACUC/ })).toBeVisible();
  await expect(page.getByRole("columnheader", { name: /登记人员/ })).toBeVisible();
  await expect(page.getByRole("columnheader", { name: /状态/ })).toBeVisible();
});

test("单据跟踪展示 IACUC/登记人员并支持筛选和撤回已发起", async ({ page }) => {
  await page.goto("/app");
  await page.getByLabel("用户名", { exact: true }).fill("admin");
  await page.getByLabel("密码", { exact: true }).fill("admin123");
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await expect(page.getByRole("heading", { name: "实验动物笼位管理与计费系统", exact: true })).toBeVisible();
  await ensureTestInfrastructure(page);

  for (const [index, id] of revertSheetIds.entries()) {
    const pi = `E2E 台账负责人 ${index + 1}`;
    await page.request.post("/api/quantity-sheets", {
      data: {
        sheet: {
          id,
          month,
          roomId: "room-e2e-8014",
          roomName: "8014",
          manager: "系统管理员",
          iacuc: `E2E-LEDGER-00${index + 1}`,
          project: `台账项目 ${index + 1}`,
          pi,
          owner: "E2E 实验负责人",
          funding: `E2E-FUND-LEDGER-${index + 1}`,
          billingUnit: "cage_day",
          animalDetailEnabled: false,
          initialAnimalCount: 0,
          initialCageCount: 15,
          pageCount: 1,
          rows: [{ id: `${id}-row-1`, date: `${month}-01`, cageCount: 15 }],
        },
      },
    });
    const generated = await page.request.post("/api/billing-statements/generate-by-pi", {
      data: { pi, month, sourceType: "quantity_sheet", status: "draft", persist: true, initiate: true },
    });
    expect(generated.ok()).toBeTruthy();
  }

  await page.reload();
  await openBillingNavigation(page);
  await page.getByRole("menuitem", { name: /单据跟踪/ }).click();
  await expect(page.getByRole("heading", { name: "单据跟踪", exact: true })).toBeVisible();

  const row = page.getByRole("row", { name: /E2E 台账负责人 1/ });
  await expect(row).toContainText("已发起");
  await expect(row).toContainText("E2E-LEDGER-001");
  await expect(row).toContainText("系统管理员");

  await page.getByRole("button", { name: "筛选状态", exact: true }).click();
  const filterPanel = page.locator(".table-filter-panel:visible");
  await expect(filterPanel).toBeVisible();
  await filterPanel
    .locator("label")
    .filter({ hasText: /已发起/ })
    .click();
  await filterPanel.getByRole("button", { name: "应用", exact: true }).click();
  await expect(page.getByRole("row", { name: /E2E 台账负责人 1/ })).toBeVisible();
  await expect(page.getByRole("row", { name: /E2E 台账负责人 2/ })).toBeVisible();
  await page.getByRole("button", { name: "筛选状态", exact: true }).click();
  await page.locator(".table-filter-panel:visible").getByRole("button", { name: "清空", exact: true }).click();
  await page.locator(".table-filter-panel:visible").getByRole("button", { name: "应用", exact: true }).click();

  await page
    .getByRole("row", { name: /E2E 台账负责人 1/ })
    .getByRole("button", { name: "撤回", exact: true })
    .click();
  await page.locator(".ant-popconfirm").getByRole("button", { name: "撤回", exact: true }).click();
  // 退回已生成后该流程不再出现在单据跟踪（已生成阶段由结算管理处理）
  await expect(page.getByRole("row", { name: /E2E 台账负责人 1/ })).toHaveCount(0, { timeout: 10_000 });
  await expect(page.getByRole("row", { name: /E2E 台账负责人 2/ })).toContainText("已发起");
});

test("已归档流程可补录报销单并更新状态标签", async ({ page }) => {
  await page.goto("/app");
  await page.getByLabel("用户名", { exact: true }).fill("admin");
  await page.getByLabel("密码", { exact: true }).fill("admin123");
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await expect(page.getByRole("heading", { name: "实验动物笼位管理与计费系统", exact: true })).toBeVisible();
  await ensureTestInfrastructure(page);

  const pi = "E2E 补录报销单负责人";
  await page.request.post("/api/quantity-sheets", {
    data: {
      sheet: {
        id: lateSheetId,
        month,
        roomId: "room-e2e-8014",
        roomName: "8014",
        manager: "系统管理员",
        iacuc: "E2E-LATE-001",
        project: "补录报销单项目",
        pi,
        owner: "E2E 实验负责人",
        funding: "E2E-FUND-LATE",
        billingUnit: "cage_day",
        animalDetailEnabled: false,
        initialAnimalCount: 0,
        initialCageCount: 15,
        pageCount: 1,
        rows: [{ id: `${lateSheetId}-row-1`, date: `${month}-01`, cageCount: 15 }],
      },
    },
  });
  const generated = await page.request.post("/api/billing-statements/generate-by-pi", {
    data: { pi, month, sourceType: "quantity_sheet", status: "draft", persist: true, initiate: true },
  });
  expect(generated.ok()).toBeTruthy();

  await page.reload();
  await openBillingNavigation(page);
  await page.getByRole("menuitem", { name: /单据跟踪/ }).click();
  await expect(page.getByRole("heading", { name: "单据跟踪", exact: true })).toBeVisible();
  const row = page.getByRole("row", { name: new RegExp(pi) });
  await expect(row).toContainText("已发起");
  await row.getByRole("button", { name: "登记" }).click();
  const modal = page.getByRole("dialog").filter({ hasText: "交回登记" }).first();
  await modal.getByRole("switch", { name: "饲养费结算单" }).click();
  await expect(modal.locator('button:has-text("上传扫描件")')).toBeVisible();
  await modal.getByRole("button", { name: "登记并归档" }).click();
  await expect(modal).toHaveCount(0, { timeout: 10_000 });
  await expect(row).toContainText("结算单 ✅ 已交回", { timeout: 10_000 });
  await expect(row).toContainText("报销单 未交回");

  await row.getByRole("button", { name: "补录" }).click();
  const recording = page.getByRole("dialog").filter({ hasText: "补录报销单" }).first();
  await recording.locator('input[placeholder="报销单号"]').first().fill("BX-LATE-001");
  await recording.locator('input[placeholder="金额（元）"]').first().fill("120");
  await recording.getByRole("button", { name: "保存补录" }).click();
  await expect(recording).toHaveCount(0, { timeout: 10_000 });
  await expect(row).toContainText("报销单 ✅ 已交回", { timeout: 10_000 });

  await row.getByRole("button", { name: "查看归档" }).click();
  const detail = page.getByRole("dialog").filter({ hasText: "流程记录" }).first();
  await expect(detail).toContainText("报销单 ✅ 已交回");
  await expect(detail).toContainText("BX-LATE-001");
  await expect(detail).toContainText("补录报销单");
  await expect(detail).toContainText("发起结算流程");
  await detail.locator(".ant-modal-close").click();
});

test("改回已发起后重新登记，时间轴保留两次交回记录", async ({ page }) => {
  await page.goto("/app");
  await page.getByLabel("用户名", { exact: true }).fill("admin");
  await page.getByLabel("密码", { exact: true }).fill("admin123");
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await expect(page.getByRole("heading", { name: "实验动物笼位管理与计费系统", exact: true })).toBeVisible();
  await ensureTestInfrastructure(page);

  const pi = "E2E 重新登记负责人";
  await page.request.post("/api/quantity-sheets", {
    data: {
      sheet: {
        id: reregisterSheetId,
        month,
        roomId: "room-e2e-8014",
        roomName: "8014",
        manager: "系统管理员",
        iacuc: "E2E-RE-001",
        project: "重新登记项目",
        pi,
        owner: "E2E 实验负责人",
        funding: "E2E-FUND-RE",
        billingUnit: "cage_day",
        animalDetailEnabled: false,
        initialAnimalCount: 0,
        initialCageCount: 15,
        pageCount: 1,
        rows: [{ id: `${reregisterSheetId}-row-1`, date: `${month}-01`, cageCount: 15 }],
      },
    },
  });
  const generated = await page.request.post("/api/billing-statements/generate-by-pi", {
    data: { pi, month, sourceType: "quantity_sheet", status: "draft", persist: true, initiate: true },
  });
  expect(generated.ok()).toBeTruthy();

  await page.reload();
  await openBillingNavigation(page);
  await page.getByRole("menuitem", { name: /单据跟踪/ }).click();
  await expect(page.getByRole("heading", { name: "单据跟踪", exact: true })).toBeVisible();
  const row = page.getByRole("row", { name: new RegExp(pi) });
  await expect(row).toContainText("已发起");

  // 第一次交回登记：只交回结算单
  await row.getByRole("button", { name: "登记" }).click();
  let modal = page.getByRole("dialog").filter({ hasText: "交回登记" }).first();
  await modal.getByRole("switch", { name: "饲养费结算单" }).click();
  await modal.getByRole("button", { name: "登记并归档" }).click();
  await expect(modal).toHaveCount(0, { timeout: 10_000 });
  await expect(row).toContainText("结算单 ✅ 已交回", { timeout: 10_000 });

  // 撤回已归档流程
  await row.getByRole("button", { name: "撤回" }).click();
  await page.locator(".ant-popconfirm").getByRole("button", { name: "撤回", exact: true }).click();
  await expect(row).toContainText("已发起", { timeout: 10_000 });

  // 第二次交回登记：交回结算单和报销单
  await row.getByRole("button", { name: "登记" }).click();
  modal = page.getByRole("dialog").filter({ hasText: "交回登记" }).first();
  await modal.getByRole("switch", { name: "饲养费结算单" }).click();
  await modal.getByRole("switch", { name: "报销单" }).click();
  await modal.locator('input[placeholder="报销单号"]').first().fill("BX-RE-001");
  await modal.locator('input[placeholder="金额（元）"]').first().fill("60");
  await modal.getByRole("button", { name: "登记并归档" }).click();
  await expect(modal).toHaveCount(0, { timeout: 10_000 });
  await expect(row).toContainText("报销单 ✅ 已交回", { timeout: 10_000 });

  // 主时间轴只保留生效环节，历史记录默认折叠
  await row.getByRole("button", { name: "查看归档" }).click();
  const detail = page.getByRole("dialog").filter({ hasText: "流程记录" }).first();
  await expect(detail.getByText("结算单/报销单交回")).toHaveCount(1);
  await expect(detail).toContainText("BX-RE-001");
  await expect(detail.getByText("历史记录（2 条）")).toBeVisible();
  await detail.getByText("历史记录（2 条）").click();
  await expect(detail.getByText("结算单/报销单交回")).toHaveCount(2);
  await expect(detail.getByText("撤回", { exact: true })).toBeVisible();
  await detail.locator(".ant-modal-close").click();
});

test("结算金额为 0 的交回登记不显示报销单开关", async ({ page }) => {
  await page.goto("/app");
  await page.getByLabel("用户名", { exact: true }).fill("admin");
  await page.getByLabel("密码", { exact: true }).fill("admin123");
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await expect(page.getByRole("heading", { name: "实验动物笼位管理与计费系统", exact: true })).toBeVisible();
  await ensureTestInfrastructure(page);

  for (const [id, pi, cageCount] of [
    [zeroSheetId, "E2E 零元结算负责人", 0],
    [paidSheetId, "E2E 正数结算负责人", 15],
  ] as const) {
    await page.request.post("/api/quantity-sheets", {
      data: {
        sheet: {
          id,
          month,
          roomId: "room-e2e-8014",
          roomName: "8014",
          manager: "系统管理员",
          iacuc: `E2E-ZERO-${id.slice(-4)}`,
          project: `交回登记项目 ${pi}`,
          pi,
          owner: "E2E 实验负责人",
          funding: `E2E-FUND-${id.slice(-4)}`,
          billingUnit: "cage_day",
          animalDetailEnabled: false,
          initialAnimalCount: 0,
          initialCageCount: cageCount,
          pageCount: 1,
          rows: [{ id: `${id}-row-1`, date: `${month}-01`, cageCount }],
        },
      },
    });
  }

  for (const pi of ["E2E 零元结算负责人", "E2E 正数结算负责人"]) {
    const generated = await page.request.post("/api/billing-statements/generate-by-pi", {
      data: { pi, month, sourceType: "quantity_sheet", status: "draft", persist: true, initiate: true },
    });
    expect(generated.ok()).toBeTruthy();
  }

  await page.reload();
  await openBillingNavigation(page);
  await page.getByRole("menuitem", { name: /单据跟踪/ }).click();
  await expect(page.getByRole("heading", { name: "单据跟踪", exact: true })).toBeVisible();

  const zeroRow = page.getByRole("row", { name: /E2E 零元结算负责人/ });
  await expect(zeroRow).toContainText("已发起");
  await zeroRow.getByRole("button", { name: "登记" }).click();
  const zeroModal = page.getByRole("dialog").filter({ hasText: "E2E 零元结算负责人" });
  await expect(zeroModal.locator(".ant-modal-title")).toContainText("交回登记");
  await expect(zeroModal.locator(".ant-switch")).toHaveCount(1);
  await expect(zeroModal.locator(".ant-switch").first()).toHaveAttribute("aria-checked", "false");
  await expect(zeroModal.locator('input[placeholder*="无需交费"]')).toHaveCount(0);
  await expect(zeroModal.getByText("报销单", { exact: true })).toHaveCount(0);
  await zeroModal.getByRole("button", { name: "取消" }).click();
  await expect(zeroModal).toHaveCount(0);

  const paidRow = page.getByRole("row", { name: /E2E 正数结算负责人/ });
  await expect(paidRow).toContainText("已发起");
  await paidRow.getByRole("button", { name: "登记" }).click();
  const paidModal = page.getByRole("dialog").filter({ hasText: "E2E 正数结算负责人" });
  await expect(paidModal.locator(".ant-modal-title")).toContainText("交回登记");
  await expect(paidModal.locator(".ant-switch")).toHaveCount(2);
  await paidModal.getByRole("button", { name: "取消" }).click();
});
