import { ensureTestInfrastructure, expect, openBillingNavigation, test } from "./fixtures";
import type { Page } from "@playwright/test";

const month = new Date().toISOString().slice(0, 7);

async function cleanupWorkflow(page: Page, pi: string) {
  const response = await page.request.get(`/api/billing-workflows?month=${month}`);
  if (!response.ok()) return;
  const data = (await response.json()) as { items?: Array<{ id: string; pi?: string }> };
  const item = (data.items || []).find((entry) => entry.pi === pi);
  if (item) await page.request.delete(`/api/billing-workflows/${item.id}`);
}
const sheetIds = [
  "sheet-e2e-settlement-1",
  "sheet-e2e-settlement-2",
  "sheet-e2e-settlement-3",
  "sheet-e2e-settlement-4",
  "sheet-e2e-settlement-5",
  "sheet-e2e-settlement-6",
  "sheet-e2e-settlement-7",
];

test.afterEach(async ({ page }) => {
  for (const id of sheetIds) await page.request.delete(`/api/quantity-sheets/${id}`);
});

test("settlement candidates merge a principal investigator's IACUC sheets", async ({ page }) => {
  await page.goto("/app");
  await page.getByLabel("用户名", { exact: true }).fill("admin");
  await page.getByLabel("密码", { exact: true }).fill("admin123");
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await expect(page.getByRole("heading", { name: "实验动物笼位管理与计费系统", exact: true })).toBeVisible();
  await ensureTestInfrastructure(page);

  for (const [index, id] of sheetIds.entries()) {
    const cageCount = index === 0 ? 6 : index === 1 ? 12 : 8;
    const pi = index < 2 ? "E2E 合表负责人" : index === 2 ? "E2E 批量负责人" : `E2E 分页负责人 ${index - 2}`;
    await page.request.post("/api/quantity-sheets", {
      data: {
        sheet: {
          id,
          month,
          roomId: "room-e2e-8014",
          roomName: "8014",
          manager: "系统管理员",
          iacuc: `E2E-SETTLEMENT-00${index + 1}`,
          project: `结算候选项目 ${index + 1}`,
          pi,
          owner: "E2E 实验负责人",
          funding: `E2E-FUND-${index + 1}`,
          fullExemption: index === 0,
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

  await page.reload();
  await openBillingNavigation(page);
  await page.getByRole("menuitem", { name: /结算管理/ }).click();
  await expect(page.getByRole("heading", { name: "结算管理", exact: true })).toBeVisible();
  const row = page.getByRole("row", { name: /E2E 合表负责人/ });
  await expect(row).toContainText("E2E-SETTLEMENT-001");
  await expect(row).toContainText("E2E-SETTLEMENT-002");
  await expect(row).toContainText("系统管理员");
  await expect(row).toContainText("¥");
  await page.getByLabel("每页显示条数").click();
  await page.getByRole("option", { name: "5 条/页", exact: true }).click();
  await page.getByLabel("全选当前筛选结果结算项").check();
  const selectionSummary = page.getByLabel("结算批量操作").getByText(/已选 \d+ 项/, { exact: true });
  await expect(selectionSummary).toBeVisible();
  const selectedCount = Number((await selectionSummary.innerText()).match(/\d+/)?.[0]);
  expect(selectedCount).toBeGreaterThan(5);
  await page.locator(".ant-pagination-next").click();
  await expect(page.locator("table tbody tr").first().getByRole("checkbox")).toBeChecked();
  await page.locator(".ant-pagination-prev").click();
  await page.getByLabel("全选当前筛选结果结算项").uncheck();
  await page.getByLabel("每页显示条数").click();
  await page.getByRole("option", { name: "10 条/页", exact: true }).click();
  await row.getByRole("checkbox", { name: `选择 E2E 合表负责人 ${month} 结算项` }).check();
  const downloadPromise = page.waitForEvent("download");
  await page.getByLabel("结算批量操作").getByRole("button", { name: "导出 PDF", exact: true }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe(
    `E2E 合表负责人课题组实验动物饲养费核算汇总表 ${month.replace("-", "年")}月.pdf`,
  );
  const xlsxDownloadPromise = page.waitForEvent("download");
  await page.getByLabel("结算批量操作").getByRole("button", { name: "导出 Excel", exact: true }).click();
  const xlsxDownload = await xlsxDownloadPromise;
  expect(xlsxDownload.suggestedFilename()).toBe(
    `E2E 合表负责人课题组实验动物饲养费核算汇总表 ${month.replace("-", "年")}月.xlsx`,
  );
  await row.getByRole("button", { name: "预览结算单", exact: true }).click();
  await expect(page.getByRole("dialog", { name: /E2E 合表负责人/ })).toBeVisible();
  await expect(page.frameLocator('iframe[title="结算单预览"]').locator("body")).toContainText(
    "E2E-SETTLEMENT-001（全额减免）",
  );
  const previewDialog = page.getByRole("dialog", { name: /E2E 合表负责人/ });
  await expect(previewDialog.getByRole("button", { name: "发起结算流程", exact: true })).toBeVisible();
  const closePdfFeedback = page.getByRole("button", { name: /关闭正在生成 PDF提示/ });
  if (await closePdfFeedback.isVisible()) await closePdfFeedback.click();
  await previewDialog.locator(".ant-modal-close").click();

  const batchRow = page.getByRole("row", { name: /E2E 批量负责人/ });
  await batchRow.getByRole("checkbox", { name: `选择 E2E 批量负责人 ${month} 结算项` }).check();
  await page.getByLabel("结算批量操作").getByRole("button", { name: "批量发起结算", exact: true }).click();
  const confirmDialog = page.getByRole("dialog", { name: "批量发起结算流程", exact: true });
  await expect(confirmDialog).toContainText("2 个项目负责人结算项");
  await confirmDialog.getByRole("button", { name: "发起 2 个流程", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "已发起 2 个结算流程" })).toBeVisible();
  await openBillingNavigation(page);
  await page.getByRole("menuitem", { name: /单据跟踪/ }).click();
  await expect(page.getByRole("heading", { name: "单据跟踪", exact: true })).toBeVisible();
  const workflowRow = page.getByRole("row", { name: /E2E 批量负责人/ });
  await expect(workflowRow).toContainText("已发起");
  await expect(workflowRow).not.toContainText("已生成");
});

test("settlement list shows 结算状态 column and filters by initiated workflow", async ({ page }) => {
  await page.goto("/app");
  await page.getByLabel("用户名", { exact: true }).fill("admin");
  await page.getByLabel("密码", { exact: true }).fill("admin123");
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await expect(page.getByRole("heading", { name: "实验动物笼位管理与计费系统", exact: true })).toBeVisible();
  await ensureTestInfrastructure(page);

  for (const [index, id] of sheetIds.entries()) {
    const pi = index === 0 ? "E2E 已发起负责人" : "E2E 未发起负责人";
    await page.request.post("/api/quantity-sheets", {
      data: {
        sheet: {
          id,
          month,
          roomId: "room-e2e-8014",
          roomName: "8014",
          manager: "系统管理员",
          iacuc: `E2E-WF-00${index + 1}`,
          project: `结算状态项目 ${index + 1}`,
          pi,
          owner: "E2E 实验负责人",
          funding: `E2E-FUND-${index + 1}`,
          billingUnit: "cage_day",
          animalDetailEnabled: false,
          initialAnimalCount: 0,
          initialCageCount: 5,
          pageCount: 1,
          rows: [{ id: `${id}-row-1`, date: `${month}-01`, cageCount: 5 }],
        },
      },
    });
  }
  const generated = await page.request.post("/api/billing-statements/generate-by-pi", {
    data: { pi: "E2E 已发起负责人", month, sourceType: "quantity_sheet", status: "draft", persist: true },
  });
  expect(generated.ok()).toBeTruthy();

  await page.reload();
  await openBillingNavigation(page);
  await page.getByRole("menuitem", { name: /结算管理/ }).click();
  await expect(page.getByRole("heading", { name: "结算管理", exact: true })).toBeVisible();

  await expect(page.getByRole("row", { name: /E2E 已发起负责人/ })).toContainText("已生成");
  await expect(page.getByRole("row", { name: /E2E 未发起负责人/ })).toContainText("未发起");

  // 已生成项可以在预览弹窗中发起结算流程
  await page
    .getByRole("row", { name: /E2E 已发起负责人/ })
    .getByRole("button", { name: "预览结算单" })
    .click();
  const initiateButton = page.locator(".settlement-preview-modal").getByRole("button", { name: "发起结算流程" });
  await expect(initiateButton).toBeVisible({ timeout: 10_000 });
  await expect(initiateButton).toBeEnabled();
  // 操作按钮位于弹窗顶部工具栏，预览 iframe 独立滚动；关闭走右上角 X
  await expect(page.locator(".settlement-preview-modal .settlement-preview-toolbar")).toBeVisible();
  await expect(page.locator(".settlement-preview-modal iframe[title='结算单预览']")).toBeVisible();
  await page.locator(".settlement-preview-modal .ant-modal-close").click();
  await expect(initiateButton).toHaveCount(0);

  await page.getByRole("button", { name: "筛选结算状态", exact: true }).click();
  const filterPanel = page.locator(".table-filter-panel:visible");
  await expect(filterPanel).toBeVisible();
  const generatedLabel = filterPanel.locator("label").filter({ hasText: /已生成/ });
  await expect(generatedLabel).toBeVisible({ timeout: 10_000 });
  await generatedLabel.click();
  await filterPanel.getByRole("button", { name: "应用", exact: true }).click();
  await expect(page.getByRole("row", { name: /E2E 已发起负责人/ })).toBeVisible();
  await expect(page.getByRole("row", { name: /E2E 未发起负责人/ })).toHaveCount(0);

  // 清空筛选后已生成的流程预览弹窗不显示撤销/撤回，通过列表批量撤回删除
  await page.getByRole("button", { name: "筛选结算状态", exact: true }).click();
  await page.locator(".table-filter-panel:visible").getByRole("button", { name: "清空", exact: true }).click();
  await page.locator(".table-filter-panel:visible").getByRole("button", { name: "应用", exact: true }).click();
  await expect(page.getByRole("row", { name: /E2E 未发起负责人/ })).toBeVisible();
  await page
    .getByRole("row", { name: /E2E 已发起负责人/ })
    .getByRole("button", { name: "预览结算单" })
    .click();
  const previewModal = page.locator(".settlement-preview-modal");
  await expect(previewModal.getByRole("button", { name: /撤销|撤回/ })).toHaveCount(0);
  await previewModal.locator(".ant-modal-close").click();
  await page
    .getByRole("row", { name: /E2E 已发起负责人/ })
    .getByRole("checkbox", { name: `选择 E2E 已发起负责人 ${month} 结算项` })
    .check();
  await page.getByLabel("结算批量操作").getByRole("button", { name: "撤回", exact: true }).click();
  await page
    .getByRole("dialog", { name: "批量撤回结算流程", exact: true })
    .getByRole("button", { name: "撤回 1 个流程", exact: true })
    .click();
  await expect(page.getByRole("row", { name: /E2E 已发起负责人/ })).toContainText("未发起", { timeout: 10_000 });
});

const overflowSheetIds = Array.from({ length: 12 }, (_, i) => `sheet-e2e-overflow-${i + 1}`);
const batchWithdrawSheetIds = ["sheet-e2e-bw-1", "sheet-e2e-bw-2"];
const revertSheetId = "sheet-e2e-revert";

test.afterEach(async ({ page }) => {
  for (const id of overflowSheetIds) await page.request.delete(`/api/quantity-sheets/${id}`);
  for (const id of batchWithdrawSheetIds) await page.request.delete(`/api/quantity-sheets/${id}`).catch(() => {});
  await page.request.delete(`/api/quantity-sheets/${revertSheetId}`).catch(() => {});
});

test("项目负责人结算列表可撤回已发起流程退回已生成", async ({ page }) => {
  await page.goto("/app");
  await page.getByLabel("用户名", { exact: true }).fill("admin");
  await page.getByLabel("密码", { exact: true }).fill("admin123");
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await expect(page.getByRole("heading", { name: "实验动物笼位管理与计费系统", exact: true })).toBeVisible();
  await ensureTestInfrastructure(page);

  const pi = "E2E 撤回已发起负责人";
  await page.request.post("/api/quantity-sheets", {
    data: {
      sheet: {
        id: revertSheetId,
        month,
        roomId: "room-e2e-8014",
        roomName: "8014",
        manager: "系统管理员",
        iacuc: "E2E-REVERT-001",
        project: "撤回已发起项目",
        pi,
        owner: "E2E 实验负责人",
        funding: "E2E-FUND-REVERT",
        billingUnit: "cage_day",
        animalDetailEnabled: false,
        initialAnimalCount: 0,
        initialCageCount: 15,
        pageCount: 1,
        rows: [{ id: `${revertSheetId}-row-1`, date: `${month}-01`, cageCount: 15 }],
      },
    },
  });
  const generated = await page.request.post("/api/billing-statements/generate-by-pi", {
    data: { pi, month, sourceType: "quantity_sheet", status: "draft", persist: true, initiate: true },
  });
  expect(generated.ok()).toBeTruthy();

  await page.reload();
  await openBillingNavigation(page);
  await page.getByRole("menuitem", { name: /结算管理/ }).click();
  await expect(page.getByRole("heading", { name: "结算管理", exact: true })).toBeVisible();

  const row = page.getByRole("row", { name: new RegExp(pi) });
  await expect(row).toContainText("已发起");
  await row.getByRole("button", { name: "预览结算单" }).click();
  const previewModal = page.locator(".settlement-preview-modal");
  await expect(previewModal.getByRole("button", { name: "撤回", exact: true })).toBeVisible();
  await previewModal.getByRole("button", { name: "撤回", exact: true }).click();
  await page.locator(".ant-popconfirm").getByRole("button", { name: "撤回", exact: true }).click();
  await expect(row).toContainText("已生成", { timeout: 10_000 });
});

test("项目负责人结算列表支持批量撤回已生成流程", async ({ page }) => {
  await page.goto("/app");
  await page.getByLabel("用户名", { exact: true }).fill("admin");
  await page.getByLabel("密码", { exact: true }).fill("admin123");
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await expect(page.getByRole("heading", { name: "实验动物笼位管理与计费系统", exact: true })).toBeVisible();
  await ensureTestInfrastructure(page);

  for (const [index, id] of batchWithdrawSheetIds.entries()) {
    const pi = `E2E 批量撤回负责人 ${index + 1}`;
    await page.request.post("/api/quantity-sheets", {
      data: {
        sheet: {
          id,
          month,
          roomId: "room-e2e-8014",
          roomName: "8014",
          manager: "系统管理员",
          iacuc: `E2E-BW-00${index + 1}`,
          project: `批量撤回项目 ${index + 1}`,
          pi,
          owner: "E2E 实验负责人",
          funding: `E2E-FUND-BW-${index + 1}`,
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
  await page.getByRole("menuitem", { name: /结算管理/ }).click();
  await expect(page.getByRole("heading", { name: "结算管理", exact: true })).toBeVisible();

  for (const pi of ["E2E 批量撤回负责人 1", "E2E 批量撤回负责人 2"]) {
    const row = page.getByRole("row", { name: new RegExp(pi) });
    await expect(row).toContainText("已生成");
    await row.getByRole("checkbox", { name: `选择 ${pi} ${month} 结算项` }).check();
  }

  await page.getByLabel("结算批量操作").getByRole("button", { name: "批量撤回" }).click();
  const confirmDialog = page.getByRole("dialog", { name: "批量撤回结算流程", exact: true });
  await expect(confirmDialog).toContainText("2 个");
  await confirmDialog.getByRole("button", { name: "撤回 2 个流程", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "已撤回 2 个结算流程" })).toBeVisible();
  await expect(page.getByRole("row", { name: /E2E 批量撤回负责人 1/ })).toContainText("未发起");
  await expect(page.getByRole("row", { name: /E2E 批量撤回负责人 2/ })).toContainText("未发起");
});

test("settlement preview toolbar keeps long IACUC lists inside the toolbar", async ({ page }) => {
  await page.goto("/app");
  await page.getByLabel("用户名", { exact: true }).fill("admin");
  await page.getByLabel("密码", { exact: true }).fill("admin123");
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await expect(page.getByRole("heading", { name: "实验动物笼位管理与计费系统", exact: true })).toBeVisible();
  await ensureTestInfrastructure(page);

  for (const [index, id] of overflowSheetIds.entries()) {
    await page.request.post("/api/quantity-sheets", {
      data: {
        sheet: {
          id,
          month,
          roomId: "room-e2e-8014",
          roomName: "8014",
          manager: "系统管理员",
          iacuc: `E2E-OVERFLOW-${String(index + 1).padStart(3, "0")}`,
          project: `溢出项目 ${index + 1}`,
          pi: "E2E 多伦理号负责人",
          owner: "E2E 实验负责人",
          funding: `E2E-FUND-${index + 1}`,
          billingUnit: "cage_day",
          animalDetailEnabled: false,
          initialAnimalCount: 0,
          initialCageCount: 5,
          pageCount: 1,
          rows: [{ id: `${id}-row-1`, date: `${month}-01`, cageCount: 5 }],
        },
      },
    });
  }

  await page.reload();
  await openBillingNavigation(page);
  await page.getByRole("menuitem", { name: /结算管理/ }).click();
  await expect(page.getByRole("heading", { name: "结算管理", exact: true })).toBeVisible();
  await page
    .getByRole("row", { name: /E2E 多伦理号负责人/ })
    .getByRole("button", { name: "预览结算单" })
    .click();
  await expect(page.locator(".settlement-preview-modal").getByRole("button", { name: "发起结算流程" })).toBeVisible({
    timeout: 20_000,
  });

  const overflow = await page.evaluate(() => {
    const toolbar = document.querySelector<HTMLElement>(".settlement-preview-modal .settlement-preview-toolbar");
    const modalBody = document.querySelector<HTMLElement>(".settlement-preview-modal .ant-modal-body");
    const context = document.querySelector<HTMLElement>(
      ".settlement-preview-modal .settlement-preview-toolbar-context",
    );
    if (!toolbar || !modalBody || !context) return { missing: true };
    const toolbarRect = toolbar.getBoundingClientRect();
    const bodyRect = modalBody.getBoundingClientRect();
    return {
      missing: false,
      toolbarOverflowsModal: toolbarRect.right > bodyRect.right + 1 || toolbarRect.left < bodyRect.left - 1,
      contextTruncated: context.scrollWidth > context.clientWidth,
    };
  });
  expect(overflow.missing).toBe(false);
  expect(overflow.toolbarOverflowsModal).toBe(false);
  expect(overflow.contextTruncated).toBe(true);
});

const noticeSheetId = "sheet-e2e-notice";

test.afterEach(async ({ page }) => {
  await page.request.delete(`/api/quantity-sheets/${noticeSheetId}`).catch(() => {});
});

test("发起结算流程 generates the notification email template", async ({ page }) => {
  await page.goto("/app");
  await page.getByLabel("用户名", { exact: true }).fill("admin");
  await page.getByLabel("密码", { exact: true }).fill("admin123");
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await expect(page.getByRole("heading", { name: "实验动物笼位管理与计费系统", exact: true })).toBeVisible();
  await ensureTestInfrastructure(page);

  await page.request.post("/api/quantity-sheets", {
    data: {
      sheet: {
        id: noticeSheetId,
        month,
        roomId: "room-e2e-8014",
        roomName: "8014",
        manager: "系统管理员",
        iacuc: "E2E-NOTICE-001",
        project: "邮件通知项目",
        pi: "E2E 邮件通知负责人",
        owner: "E2E 实验负责人",
        funding: "E2E-FUND-NOTICE",
        billingUnit: "cage_day",
        animalDetailEnabled: false,
        initialAnimalCount: 0,
        initialCageCount: 5,
        pageCount: 1,
        rows: [{ id: `${noticeSheetId}-row-1`, date: `${month}-01`, cageCount: 5 }],
      },
    },
  });

  await page.reload();
  await openBillingNavigation(page);
  await page.getByRole("menuitem", { name: /结算管理/ }).click();
  await expect(page.getByRole("heading", { name: "结算管理", exact: true })).toBeVisible();
  const noticeRow = page.getByRole("row", { name: /E2E 邮件通知负责人/ });
  await expect(noticeRow).toBeVisible();
  // 重试场景：上一次运行留下的流程已是“已发起”，通过接口清理后回到未发起
  await cleanupWorkflow(page, "E2E 邮件通知负责人");
  await page.reload();
  await openBillingNavigation(page);
  await page.getByRole("menuitem", { name: /结算管理/ }).click();
  await expect(page.getByRole("heading", { name: "结算管理", exact: true })).toBeVisible();
  await expect(page.getByRole("row", { name: /E2E 邮件通知负责人/ })).toContainText("未发起");
  await noticeRow.getByRole("button", { name: "预览结算单" }).click();
  await expect(page.locator(".settlement-preview-modal").getByRole("button", { name: "发起结算流程" })).toBeVisible({
    timeout: 20_000,
  });
  await page.locator(".settlement-preview-modal").getByRole("button", { name: "发起结算流程" }).click();

  const noticeModal = page.locator(".settlement-notice-modal");
  const noticeBody = noticeModal.locator(".settlement-notice-body");
  await expect(noticeBody).toBeVisible({ timeout: 10_000 });
  await expect(noticeModal.locator(".settlement-notice-head")).toBeVisible();
  await expect(noticeModal.locator(".ant-modal-title")).toContainText("实验动物饲养费结算的通知");
  // 无底部 footer（取消/确认），关闭仅右上角 X
  await expect(noticeModal.locator(".ant-modal-footer")).toHaveCount(0);
  // "复制并确认"按钮不与右上角关闭 X 重叠
  const overlap = await page.evaluate(() => {
    const modal = document.querySelector<HTMLElement>(".settlement-notice-modal");
    const button = modal?.querySelector<HTMLElement>(".settlement-notice-head .ant-btn");
    const close = modal?.querySelector<HTMLElement>(".ant-modal-close");
    if (!modal || !button || !close) return { missing: true };
    const b = button.getBoundingClientRect();
    const c = close.getBoundingClientRect();
    return { missing: false, buttonRight: Math.round(b.right), closeLeft: Math.round(c.left) };
  });
  expect(overlap.missing).toBe(false);
  if (overlap.missing) throw new Error("未找到按钮或关闭 X");
  expect(overlap.buttonRight!).toBeLessThanOrEqual(overlap.closeLeft!);
  const subject = await noticeModal.locator(".settlement-notice-subject").innerText();
  const body = await noticeBody.innerText();
  expect(body).toContain("应交总额为");
  expect(body).toContain("材料接收点：珠江新城办公室8009");
  expect(body).toContain("系统管理员");

  // 复制并确认：一次点击完成复制、发起、关闭弹窗
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  await noticeModal.getByRole("button", { name: "复制并确认" }).click();
  await expect(noticeModal).toHaveCount(0, { timeout: 10_000 });
  await expect(noticeRow).toContainText("已发起", { timeout: 10_000 });
  const clipboardText = await page.evaluate(() => navigator.clipboard.readText());
  expect(clipboardText).toBe(`${subject}\n\n${body}`);
  // 发起后预览弹窗按钮立即变灰，无需退出重进
  await expect(page.locator(".settlement-preview-modal").getByRole("button", { name: "已发起结算流程" })).toBeVisible();
  await expect(
    page.locator(".settlement-preview-modal").getByRole("button", { name: "已发起结算流程" }),
  ).toBeDisabled();
  await page.locator(".settlement-preview-modal .ant-modal-close").click();
});
