import { ensureTestInfrastructure, expect, openBillingNavigation, test } from "./fixtures";

const month = new Date().toISOString().slice(0, 7);
const zeroSheetId = "sheet-e2e-zero";
const paidSheetId = "sheet-e2e-paid";
const revertSheetIds = ["sheet-e2e-revert-1", "sheet-e2e-revert-2"];
const crossSelectSheetIds = Array.from({ length: 12 }, (_, i) => `sheet-e2e-cross-${i + 1}`);

test.afterEach(async ({ page }) => {
  await page.request.delete(`/api/quantity-sheets/${zeroSheetId}`).catch(() => {});
  await page.request.delete(`/api/quantity-sheets/${paidSheetId}`).catch(() => {});
  for (const id of revertSheetIds) await page.request.delete(`/api/quantity-sheets/${id}`).catch(() => {});
  for (const id of crossSelectSheetIds) await page.request.delete(`/api/quantity-sheets/${id}`).catch(() => {});
});

test("结算与报销台账展示以结算流程为主线的面板", async ({ page }) => {
  await page.goto("/app");
  await page.getByLabel("用户名", { exact: true }).fill("admin");
  await page.getByLabel("密码", { exact: true }).fill("admin123");
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await expect(page.getByRole("heading", { name: "实验动物笼位管理与计费系统", exact: true })).toBeVisible();

  await openBillingNavigation(page);
  await page.getByRole("menuitem", { name: /结算与报销台账/ }).click();
  await expect(page.getByRole("heading", { name: "核销工作台", exact: true })).toBeVisible();
  await expect(page.getByText("以饲养费结算单为主线")).toBeVisible();
  await expect(page.getByRole("columnheader", { name: /结算月份/ })).toBeVisible();
  await expect(page.getByRole("columnheader", { name: /IACUC/ })).toBeVisible();
  await expect(page.getByRole("columnheader", { name: /登记人员/ })).toBeVisible();
  await expect(page.getByRole("columnheader", { name: /状态/ })).toBeVisible();
});

test("核销工作台展示 IACUC/登记人员并支持筛选和撤回已发起", async ({ page }) => {
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
  await page.getByRole("menuitem", { name: /结算与报销台账/ }).click();
  await expect(page.getByRole("heading", { name: "核销工作台", exact: true })).toBeVisible();

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
  await expect(page.getByRole("row", { name: /E2E 台账负责人 1/ })).toContainText("已生成", { timeout: 10_000 });
  await expect(page.getByRole("row", { name: /E2E 台账负责人 2/ })).toContainText("已发起");
});

test("核销工作台支持跨页全选已生成流程", async ({ page }) => {
  await page.goto("/app");
  await page.getByLabel("用户名", { exact: true }).fill("admin");
  await page.getByLabel("密码", { exact: true }).fill("admin123");
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await expect(page.getByRole("heading", { name: "实验动物笼位管理与计费系统", exact: true })).toBeVisible();
  await ensureTestInfrastructure(page);

  for (const [index, id] of crossSelectSheetIds.entries()) {
    const pi = `E2E 跨页全选负责人 ${index + 1}`;
    await page.request.post("/api/quantity-sheets", {
      data: {
        sheet: {
          id,
          month,
          roomId: "room-e2e-8014",
          roomName: "8014",
          manager: "系统管理员",
          iacuc: `E2E-CROSS-${String(index + 1).padStart(3, "0")}`,
          project: `跨页全选项目 ${index + 1}`,
          pi,
          owner: "E2E 实验负责人",
          funding: `E2E-FUND-CROSS-${index + 1}`,
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
      data: { pi, month, sourceType: "quantity_sheet", status: "draft", persist: true },
    });
    expect(generated.ok()).toBeTruthy();
  }

  await page.reload();
  await openBillingNavigation(page);
  await page.getByRole("menuitem", { name: /结算与报销台账/ }).click();
  await expect(page.getByRole("heading", { name: "核销工作台", exact: true })).toBeVisible();
  await page.getByLabel("每页显示条数").click();
  await page.getByRole("option", { name: "5 条/页", exact: true }).click();

  await page.locator("thead").getByLabel("全选当前筛选结果可发起的结算流程").click();
  await expect(page.locator(".ledger-toolbar").getByText(/已选 \d+ 条可发起/)).toBeVisible({ timeout: 10_000 });
  const selectedText = await page.locator(".ledger-toolbar").innerText();
  const selectedCount = Number((selectedText.match(/已选 (\d+) 条可发起/) || [])[1] || 0);
  expect(selectedCount).toBeGreaterThanOrEqual(12);
  const checkedRows = await page
    .locator("tbody tr .ant-checkbox-input")
    .evaluateAll((els) => els.filter((el) => (el as HTMLInputElement).checked).length);
  expect(checkedRows).toBeGreaterThan(0);
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
  await page.getByRole("menuitem", { name: /结算与报销台账/ }).click();
  await expect(page.getByRole("heading", { name: "核销工作台", exact: true })).toBeVisible();

  const zeroRow = page.getByRole("row", { name: /E2E 零元结算负责人/ });
  await expect(zeroRow).toContainText("已发起");
  await zeroRow.getByRole("button", { name: "交回登记" }).click();
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
  await paidRow.getByRole("button", { name: "交回登记" }).click();
  const paidModal = page.getByRole("dialog").filter({ hasText: "E2E 正数结算负责人" });
  await expect(paidModal.locator(".ant-modal-title")).toContainText("交回登记");
  await expect(paidModal.locator(".ant-switch")).toHaveCount(2);
  await paidModal.getByRole("button", { name: "取消" }).click();
});
